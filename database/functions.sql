-- SABOR DIGITAL — Funções de negócio (executam dentro de UMA transação no Postgres)
-- Erros esperados são levantados como 'HTTP_<status>:<mensagem>' e convertidos pela API.

CREATE OR REPLACE FUNCTION app_fail(p_status int, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HTTP_%:%', p_status, p_msg USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION app_audit(p_restaurant int, p_actor_type text, p_actor text,
                                     p_action text, p_entity text, p_entity_id text, p_data jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_logs (restaurant_id, actor_type, actor_id, action, entity, entity_id, data)
  VALUES (p_restaurant, p_actor_type, p_actor, p_action, p_entity, p_entity_id, p_data);
$$;

-- ------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION recalc_account(p_account_id int) RETURNS numeric
LANGUAGE sql AS $$
  UPDATE accounts SET total = COALESCE((SELECT sum(total) FROM orders
                                        WHERE account_id = p_account_id AND status <> 'cancelled'), 0)
  WHERE id = p_account_id RETURNING total;
$$;

-- status da mesa a partir dos pedidos da conta ainda não encerrada
CREATE OR REPLACE FUNCTION refresh_table_status(p_table_id int) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO a FROM accounts WHERE table_id = p_table_id AND status <> 'closed';
  IF NOT FOUND THEN
    v_status := CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE table_id = p_table_id AND status = 'active')
                     THEN 'occupied' ELSE 'free' END;
  ELSIF a.status = 'awaiting_payment' THEN
    v_status := 'awaiting_payment';
  ELSIF EXISTS (SELECT 1 FROM orders WHERE account_id = a.id AND status = 'received') THEN
    v_status := 'order_received';
  ELSIF EXISTS (SELECT 1 FROM orders WHERE account_id = a.id AND status = 'preparing') THEN
    v_status := 'preparing';
  ELSIF EXISTS (SELECT 1 FROM orders WHERE account_id = a.id AND status IN ('ready','delivering')) THEN
    v_status := 'awaiting_delivery';
  ELSE
    v_status := 'occupied';
  END IF;
  UPDATE tables SET status = v_status, updated_at = now() WHERE id = p_table_id;
END $$;

CREATE OR REPLACE FUNCTION order_json(p_order_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'order', o.identifier, 'status', o.status, 'total', o.total, 'notes', o.notes,
    'createdAt', o.created_at, 'table', t.number, 'tableCode', t.identifier,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'product', oi.product_code, 'name', oi.product_name, 'quantity', oi.quantity,
        'unitPrice', oi.unit_price, 'addons', oi.addons, 'addonsTotal', oi.addons_total,
        'subtotal', oi.subtotal, 'notes', oi.notes) ORDER BY oi.id)
      FROM order_items oi WHERE oi.order_id = o.id), '[]'::jsonb))
  FROM orders o JOIN tables t ON t.id = o.table_id WHERE o.id = p_order_id;
$$;

-- ------------------------------------------------------------------ sessão do cliente
CREATE OR REPLACE FUNCTION open_session(p_restaurant_id int, p_table_id int, p_customer_id int,
                                        p_token_hash text, p_ttl_hours int) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_ident text; v_exp timestamptz;
BEGIN
  UPDATE sessions SET status = 'closed', ended_at = now()
   WHERE table_id = p_table_id AND customer_id = p_customer_id AND status = 'active';
  INSERT INTO sessions (restaurant_id, table_id, customer_id, token_hash, expires_at)
  VALUES (p_restaurant_id, p_table_id, p_customer_id, p_token_hash, now() + make_interval(hours => p_ttl_hours))
  RETURNING identifier, expires_at INTO v_ident, v_exp;
  UPDATE tables SET status = 'occupied', updated_at = now() WHERE id = p_table_id AND status = 'free';
  PERFORM app_audit(p_restaurant_id, 'customer', p_customer_id::text, 'session.open', 'session', v_ident, NULL);
  RETURN jsonb_build_object('identifier', v_ident, 'expiresAt', v_exp);
END $$;

-- ------------------------------------------------------------------ pedido
-- p_items: [{"product":"PROD-00001","quantity":2,"addons":[1,2],"notes":"sem cebola"}]
-- Preços SEMPRE lidos do banco. Repetir (sessão, chave) devolve o pedido original.
CREATE OR REPLACE FUNCTION create_order(p_token_hash text, p_idem text, p_notes text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  s sessions%ROWTYPE; t tables%ROWTYPE; a accounts%ROWTYPE; o orders%ROWTYPE; prod products%ROWTYPE;
  it jsonb; v_qty int; v_addons jsonb; v_addon_unit numeric; v_addon_total numeric; v_sub numeric;
  v_total numeric := 0; v_found int; v_wanted int;
BEGIN
  SELECT * INTO s FROM sessions WHERE token_hash = p_token_hash AND status = 'active' AND expires_at > now();
  IF NOT FOUND THEN PERFORM app_fail(401, 'Sessão inválida ou expirada'); END IF;

  IF p_idem IS NULL OR length(p_idem) < 8 OR length(p_idem) > 80 THEN
    PERFORM app_fail(400, 'Idempotency-Key inválida');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 30 THEN
    PERFORM app_fail(422, 'Pedido deve ter de 1 a 30 itens');
  END IF;

  -- trava a mesa: serializa pedidos concorrentes (e a criação da conta)
  SELECT * INTO t FROM tables WHERE id = s.table_id FOR UPDATE;
  IF NOT t.active THEN PERFORM app_fail(409, 'Mesa indisponível'); END IF;

  SELECT * INTO o FROM orders WHERE session_id = s.id AND idempotency_key = p_idem;
  IF FOUND THEN RETURN order_json(o.id) || jsonb_build_object('replayed', true); END IF;

  SELECT * INTO a FROM accounts WHERE table_id = t.id AND status <> 'closed';
  IF NOT FOUND THEN
    INSERT INTO accounts (restaurant_id, table_id, service_fee_percent)
    SELECT t.restaurant_id, t.id, r.service_fee_percent FROM restaurants r WHERE r.id = t.restaurant_id
    RETURNING * INTO a;
  ELSIF a.status <> 'open' THEN
    PERFORM app_fail(409, 'A conta da mesa está em fechamento');
  END IF;

  INSERT INTO orders (restaurant_id, table_id, account_id, session_id, customer_id, idempotency_key, notes)
  VALUES (t.restaurant_id, t.id, a.id, s.id, s.customer_id, p_idem, left(NULLIF(trim(p_notes), ''), 500))
  RETURNING * INTO o;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(it) <> 'object' OR NOT (it->>'quantity') ~ '^[0-9]{1,2}$' THEN
      PERFORM app_fail(422, 'Quantidade inválida');
    END IF;
    v_qty := (it->>'quantity')::int;
    IF v_qty < 1 OR v_qty > 50 THEN PERFORM app_fail(422, 'Quantidade deve ser de 1 a 50'); END IF;

    SELECT * INTO prod FROM products
     WHERE restaurant_id = t.restaurant_id AND identifier = it->>'product' AND active;
    IF NOT FOUND THEN PERFORM app_fail(422, 'Produto inexistente: ' || COALESCE(it->>'product', '?')); END IF;
    IF NOT prod.available THEN PERFORM app_fail(422, 'Indisponível no momento: ' || prod.name); END IF;

    v_addons := '[]'::jsonb; v_addon_unit := 0;
    IF it ? 'addons' AND jsonb_typeof(it->'addons') = 'array' AND jsonb_array_length(it->'addons') > 0 THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(it->'addons') AS e(v) WHERE v !~ '^[0-9]{1,9}$') THEN
        PERFORM app_fail(422, 'Adicional inválido');
      END IF;
      SELECT count(DISTINCT v::int) INTO v_wanted FROM jsonb_array_elements_text(it->'addons') AS e(v);
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', pa.id, 'name', pa.name, 'price', pa.price) ORDER BY pa.id),
                      '[]'::jsonb),
             COALESCE(sum(pa.price), 0), count(*)
        INTO v_addons, v_addon_unit, v_found
        FROM product_addons pa
       WHERE pa.product_id = prod.id AND pa.active
         AND pa.id IN (SELECT DISTINCT v::int FROM jsonb_array_elements_text(it->'addons') AS e(v));
      IF v_found <> v_wanted THEN PERFORM app_fail(422, 'Adicional inválido para ' || prod.name); END IF;
    END IF;

    v_addon_total := round(v_addon_unit * v_qty, 2);
    v_sub := round(prod.price * v_qty + v_addon_total, 2);
    INSERT INTO order_items (order_id, product_id, product_code, product_name, quantity, unit_price,
                             addons, addons_total, subtotal, notes)
    VALUES (o.id, prod.id, prod.identifier, prod.name, v_qty, prod.price, v_addons, v_addon_total, v_sub,
            left(NULLIF(trim(it->>'notes'), ''), 300));
    v_total := v_total + v_sub;
  END LOOP;

  UPDATE orders SET total = v_total WHERE id = o.id;
  PERFORM recalc_account(a.id);
  PERFORM refresh_table_status(t.id);
  PERFORM app_audit(t.restaurant_id, 'customer', s.customer_id::text, 'order.create', 'order', o.identifier,
                    jsonb_build_object('table', t.identifier, 'total', v_total));
  RETURN order_json(o.id) || jsonb_build_object('replayed', false);
END $$;

-- ------------------------------------------------------------------ status do pedido
CREATE OR REPLACE FUNCTION set_order_status(p_restaurant_id int, p_user_id int, p_identifier text, p_new text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  o orders%ROWTYPE; v_ok boolean; v_acc_status text;
BEGIN
  SELECT * INTO o FROM orders WHERE restaurant_id = p_restaurant_id AND identifier = p_identifier FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Pedido não encontrado'); END IF;

  v_ok := CASE o.status
    WHEN 'received'   THEN p_new IN ('preparing','cancelled')
    WHEN 'preparing'  THEN p_new IN ('ready','cancelled')
    WHEN 'ready'      THEN p_new IN ('delivering','delivered','cancelled')
    WHEN 'delivering' THEN p_new IN ('delivered')
    ELSE false END;
  IF NOT v_ok THEN
    PERFORM app_fail(409, format('Transição inválida: %s → %s', o.status, p_new));
  END IF;

  SELECT status INTO v_acc_status FROM accounts WHERE id = o.account_id;
  IF p_new = 'cancelled' AND v_acc_status <> 'open' THEN
    PERFORM app_fail(409, 'Não é possível cancelar: conta em fechamento');
  END IF;

  UPDATE orders SET status = p_new, updated_at = now(),
    preparing_at = CASE WHEN p_new = 'preparing' THEN now() ELSE preparing_at END,
    ready_at     = CASE WHEN p_new = 'ready' THEN now() ELSE ready_at END,
    delivered_at = CASE WHEN p_new = 'delivered' THEN now() ELSE delivered_at END,
    cancelled_at = CASE WHEN p_new = 'cancelled' THEN now() ELSE cancelled_at END
  WHERE id = o.id;
  PERFORM recalc_account(o.account_id);
  PERFORM refresh_table_status(o.table_id);
  PERFORM app_audit(p_restaurant_id, 'user', p_user_id::text, 'order.status', 'order', p_identifier,
                    jsonb_build_object('from', o.status, 'to', p_new));
  RETURN order_json(o.id);
END $$;

-- ------------------------------------------------------------------ conta
-- Saldo por cliente: consumo + taxa de serviço (a menos que removida) - pagamentos.
CREATE OR REPLACE FUNCTION account_balances(p_account_id int)
RETURNS TABLE (customer_id int, consumed numeric, fee numeric, paid numeric, pending numeric)
LANGUAGE sql STABLE AS $$
  SELECT q.customer_id, q.consumed, q.fee, q.paid, q.consumed + q.fee - q.paid
  FROM (
    SELECT x.customer_id, x.consumed,
           CASE WHEN w.customer_id IS NULL THEN round(x.consumed * a.service_fee_percent / 100, 2) ELSE 0 END AS fee,
           COALESCE(p.paid, 0) AS paid
    FROM (SELECT o.customer_id, sum(o.total) AS consumed FROM orders o
           WHERE o.account_id = p_account_id AND o.status <> 'cancelled' GROUP BY o.customer_id) x
    JOIN accounts a ON a.id = p_account_id
    LEFT JOIN account_fee_waivers w ON w.account_id = p_account_id AND w.customer_id = x.customer_id
    LEFT JOIN (SELECT customer_id, sum(amount) AS paid FROM payments
                WHERE account_id = p_account_id AND status = 'confirmed' GROUP BY customer_id) p
           ON p.customer_id = x.customer_id
  ) q
$$;

CREATE OR REPLACE FUNCTION account_summary(p_restaurant_id int, p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'account', a.identifier, 'status', a.status, 'openedAt', a.opened_at, 'closedAt', a.closed_at,
    'table', t.number, 'tableCode', t.identifier,
    'total', a.total,
    'serviceFeePercent', a.service_fee_percent,
    'fee', COALESCE((SELECT sum(fee) FROM account_balances(a.id)), 0),
    'totalWithFee', COALESCE((SELECT sum(consumed + fee) FROM account_balances(a.id)), 0),
    'paid', COALESCE((SELECT sum(amount) FROM payments WHERE account_id = a.id AND status = 'confirmed'), 0),
    'waiter', CASE WHEN a.waiter_id IS NULL THEN NULL
                   ELSE (SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM users u WHERE u.id = a.waiter_id) END,
    'customers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'customer', c.identifier, 'name', c.name, 'cpfMasked', c.cpf_masked, 'phoneMasked', c.phone_masked,
        'consumed', b.consumed, 'fee', b.fee,
        'feeRemoved', CASE WHEN w.customer_id IS NULL THEN NULL
                           ELSE jsonb_build_object('by', wu.name, 'reason', w.reason, 'at', w.removed_at) END,
        'due', b.consumed + b.fee, 'paid', b.paid, 'pending', b.pending,
        'items', it.items) ORDER BY c.name)
      FROM account_balances(a.id) b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN account_fee_waivers w ON w.account_id = a.id AND w.customer_id = b.customer_id
      LEFT JOIN users wu ON wu.id = w.removed_by
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('order', o.identifier, 'name', oi.product_name,
                         'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'addons', oi.addons,
                         'subtotal', oi.subtotal) ORDER BY oi.id) AS items
          FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE o.account_id = a.id AND o.customer_id = b.customer_id AND o.status <> 'cancelled'
      ) it
    ), '[]'::jsonb))
  FROM accounts a JOIN tables t ON t.id = a.table_id
  WHERE a.id = p_account_id AND a.restaurant_id = p_restaurant_id;
$$;

-- Encerra a conta: mesa só é liberada se tudo estiver entregue/cancelado e 100% pago.
CREATE OR REPLACE FUNCTION finalize_account(p_account_id int, p_user_id int) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM accounts WHERE id = p_account_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM orders WHERE account_id = a.id AND status NOT IN ('delivered','cancelled')) THEN
    PERFORM app_fail(409, 'Existem pedidos não encerrados');
  END IF;
  IF EXISTS (SELECT 1 FROM account_balances(a.id) WHERE pending > 0) THEN
    PERFORM app_fail(409, 'Há saldo pendente: a mesa não pode ser liberada');
  END IF;

  UPDATE accounts SET status = 'closed', closed_at = now() WHERE id = a.id;
  UPDATE sessions SET status = 'closed', ended_at = now() WHERE table_id = a.table_id AND status = 'active';
  UPDATE tables SET status = 'free', updated_at = now() WHERE id = a.table_id;
  PERFORM app_audit(a.restaurant_id, 'user', p_user_id::text, 'account.close', 'account', a.identifier,
                    jsonb_build_object('total', a.total));
END $$;

-- Passo 1: congela a conta para pagamento (bloqueia novos pedidos).
CREATE OR REPLACE FUNCTION begin_account_close(p_restaurant_id int, p_user_id int, p_account text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM accounts WHERE restaurant_id = p_restaurant_id AND identifier = p_account FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Conta não encontrada'); END IF;
  IF a.status = 'closed' THEN PERFORM app_fail(409, 'Conta já encerrada'); END IF;
  IF a.status = 'open' THEN
    IF a.total > 0 AND a.waiter_id IS NULL THEN
      PERFORM app_fail(409, 'Defina o garçom responsável pela mesa antes de fechar a conta');
    END IF;
    IF EXISTS (SELECT 1 FROM orders WHERE account_id = a.id AND status NOT IN ('delivered','cancelled')) THEN
      PERFORM app_fail(409, 'Há pedidos em andamento: conclua ou cancele antes de fechar a conta');
    END IF;
    UPDATE accounts SET status = 'awaiting_payment' WHERE id = a.id;
    PERFORM refresh_table_status(a.table_id);
    PERFORM app_audit(p_restaurant_id, 'user', p_user_id::text, 'account.begin_close', 'account', a.identifier, NULL);
  END IF;
  -- conta sem consumo: encerra direto
  IF a.total = 0 THEN PERFORM finalize_account(a.id, p_user_id); END IF;
  RETURN account_summary(p_restaurant_id, a.id);
END $$;

-- Passo 2: registra pagamento confirmado por funcionário; libera a mesa ao quitar tudo.
CREATE OR REPLACE FUNCTION register_payment(p_restaurant_id int, p_user_id int, p_account text,
                                            p_customer text, p_amount numeric, p_method text, p_reference text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE; c customers%ROWTYPE; v_consumed numeric; v_released boolean := false;
BEGIN
  IF p_method NOT IN ('cash','pix','debit','credit','other') THEN PERFORM app_fail(422, 'Meio de pagamento inválido'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN PERFORM app_fail(422, 'Valor inválido'); END IF;
  p_amount := round(p_amount, 2);

  SELECT * INTO a FROM accounts WHERE restaurant_id = p_restaurant_id AND identifier = p_account FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Conta não encontrada'); END IF;
  IF a.status <> 'awaiting_payment' THEN PERFORM app_fail(409, 'Feche a conta antes de registrar pagamentos'); END IF;

  SELECT * INTO c FROM customers WHERE restaurant_id = p_restaurant_id AND identifier = p_customer;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Cliente não encontrado'); END IF;

  SELECT pending INTO v_consumed FROM account_balances(a.id) WHERE customer_id = c.id;
  IF v_consumed IS NULL THEN PERFORM app_fail(422, 'Cliente sem consumo nesta conta'); END IF;
  IF p_amount > v_consumed THEN
    PERFORM app_fail(409, format('Valor excede o saldo do cliente (pendente: %s)', v_consumed));
  END IF;

  INSERT INTO payments (restaurant_id, account_id, customer_id, amount, method, status, reference,
                        registered_by, confirmed_by, confirmed_at)
  VALUES (p_restaurant_id, a.id, c.id, p_amount, p_method, 'confirmed', left(p_reference, 200),
          p_user_id, p_user_id, now());
  PERFORM app_audit(p_restaurant_id, 'user', p_user_id::text, 'payment.confirm', 'account', a.identifier,
                    jsonb_build_object('customer', c.identifier, 'amount', p_amount, 'method', p_method));

  IF NOT EXISTS (SELECT 1 FROM account_balances(a.id) WHERE pending > 0) THEN
    PERFORM finalize_account(a.id, p_user_id);
    v_released := true;
  END IF;
  RETURN jsonb_build_object('tableReleased', v_released) || account_summary(p_restaurant_id, a.id);
END $$;

-- Remove (ou restaura) a taxa de serviço de um cliente ou de toda a mesa. Só antes de qualquer pagamento do cliente.
CREATE OR REPLACE FUNCTION set_service_fee(p_restaurant_id int, p_user_id int, p_account text,
                                           p_customer text, p_remove boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE; r record; n int := 0; v_reason text := left(trim(COALESCE(p_reason, '')), 200);
BEGIN
  SELECT * INTO a FROM accounts WHERE restaurant_id = p_restaurant_id AND identifier = p_account FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Conta não encontrada'); END IF;
  IF a.status = 'closed' THEN PERFORM app_fail(409, 'Conta já encerrada'); END IF;
  IF p_remove AND length(v_reason) < 3 THEN PERFORM app_fail(422, 'Informe o motivo da remoção'); END IF;

  FOR r IN SELECT b.customer_id, c.identifier FROM account_balances(a.id) b
             JOIN customers c ON c.id = b.customer_id
            WHERE (p_customer IS NULL OR c.identifier = p_customer) AND b.paid = 0
  LOOP
    IF p_remove THEN
      INSERT INTO account_fee_waivers (account_id, customer_id, removed_by, reason)
      VALUES (a.id, r.customer_id, p_user_id, v_reason)
      ON CONFLICT (account_id, customer_id)
      DO UPDATE SET removed_by = p_user_id, reason = v_reason, removed_at = now();
    ELSE
      DELETE FROM account_fee_waivers WHERE account_id = a.id AND customer_id = r.customer_id;
    END IF;
    PERFORM app_audit(p_restaurant_id, 'user', p_user_id::text,
                      CASE WHEN p_remove THEN 'fee.remove' ELSE 'fee.restore' END, 'account', a.identifier,
                      jsonb_build_object('customer', r.identifier, 'reason', v_reason));
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    PERFORM app_fail(409, 'Nenhum cliente elegível: quem já pagou parte da conta não pode mudar a taxa');
  END IF;
  RETURN account_summary(p_restaurant_id, a.id);
END $$;

-- ------------------------------------------------------------------ alertas (chamar garçom)
CREATE OR REPLACE FUNCTION create_alert(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  s sessions%ROWTYPE; v_ident text; v_created boolean := true;
BEGIN
  SELECT * INTO s FROM sessions WHERE token_hash = p_token_hash AND status = 'active' AND expires_at > now();
  IF NOT FOUND THEN PERFORM app_fail(401, 'Sessão inválida ou expirada'); END IF;

  INSERT INTO alerts (restaurant_id, table_id, session_id, customer_id)
  VALUES (s.restaurant_id, s.table_id, s.id, s.customer_id)
  ON CONFLICT (table_id) WHERE status <> 'resolved' DO NOTHING
  RETURNING identifier INTO v_ident;

  IF v_ident IS NULL THEN
    v_created := false;
    SELECT identifier INTO v_ident FROM alerts WHERE table_id = s.table_id AND status <> 'resolved';
  ELSE
    PERFORM app_audit(s.restaurant_id, 'customer', s.customer_id::text, 'alert.create', 'alert', v_ident, NULL);
  END IF;
  RETURN jsonb_build_object('alert', v_ident, 'created', v_created);
END $$;

-- Resolver/atender um alerta NÃO mexe em conta, pedidos, pagamentos nem ocupação da mesa.
CREATE OR REPLACE FUNCTION set_alert_status(p_restaurant_id int, p_user_id int, p_identifier text, p_new text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  al alerts%ROWTYPE;
BEGIN
  SELECT * INTO al FROM alerts WHERE restaurant_id = p_restaurant_id AND identifier = p_identifier FOR UPDATE;
  IF NOT FOUND THEN PERFORM app_fail(404, 'Alerta não encontrado'); END IF;
  IF NOT (CASE al.status WHEN 'pending' THEN p_new IN ('in_progress','resolved')
                         WHEN 'in_progress' THEN p_new = 'resolved' ELSE false END) THEN
    PERFORM app_fail(409, format('Transição inválida: %s → %s', al.status, p_new));
  END IF;
  UPDATE alerts SET status = p_new, attended_by = p_user_id,
         resolved_at = CASE WHEN p_new = 'resolved' THEN now() ELSE NULL END
   WHERE id = al.id;
  PERFORM app_audit(p_restaurant_id, 'user', p_user_id::text, 'alert.' || p_new, 'alert', p_identifier, NULL);
  RETURN jsonb_build_object('alert', p_identifier, 'status', p_new);
END $$;
