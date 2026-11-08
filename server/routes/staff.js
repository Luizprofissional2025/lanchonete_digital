// Painel administrativo: dashboard, mesas/QR, pedidos/cozinha, alertas, cardápio e clientes.
// Todas as consultas filtram por restaurant_id vindo do usuário autenticado (isolamento multi-tenant).
import { HttpError } from '../../lib/http.js'
import { query } from '../../lib/neon.js'
import { route } from '../router.js'
import { ROLES, TZ, num, optStr, price, qrUrl, restaurantSettings, staff, str, waitLevel } from '../common.js'

const audit = (user, action, entity, entityId, data = null) =>
  query('SELECT app_audit($1, $2, $3, $4, $5, $6, $7::jsonb)', [
    user.restaurantId, 'user', String(user.id), action, entity, entityId, data ? JSON.stringify(data) : null,
  ])

// ------------------------------------------------------------------ dashboard
route('GET', '/dashboard/stats', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const [s] = await query(
    `SELECT
       (SELECT count(*) FROM tables WHERE restaurant_id = $1 AND active) AS tables_total,
       (SELECT count(*) FROM tables WHERE restaurant_id = $1 AND active AND status = 'free') AS tables_free,
       (SELECT count(*) FROM orders WHERE restaurant_id = $1 AND status IN ('received','preparing','ready','delivering')) AS orders_active,
       (SELECT count(*) FROM orders o WHERE o.restaurant_id = $1 AND o.status IN ('received','preparing')
           AND now() - o.created_at > make_interval(mins => (SELECT wait_attention_max_min FROM restaurants WHERE id = $1))) AS orders_late,
       (SELECT COALESCE(avg(EXTRACT(EPOCH FROM now() - created_at) / 60), 0) FROM orders
           WHERE restaurant_id = $1 AND status IN ('received','preparing')) AS avg_wait,
       (SELECT count(*) FROM alerts WHERE restaurant_id = $1 AND status = 'pending') AS alerts_pending,
       (SELECT count(*) FROM alerts WHERE restaurant_id = $1 AND status = 'in_progress') AS alerts_in_progress,
       (SELECT count(*) FROM accounts WHERE restaurant_id = $1 AND status <> 'closed') AS accounts_open,
       (SELECT COALESCE(sum(total), 0) FROM orders WHERE restaurant_id = $1 AND status <> 'cancelled'
           AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS billed_today,
       (SELECT COALESCE(sum(amount), 0) FROM payments WHERE restaurant_id = $1 AND status = 'confirmed'
           AND (confirmed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS received_today`,
    [u.restaurantId, TZ]
  )
  const total = num(s.tables_total), free = num(s.tables_free)
  return {
    tables: { total, free, occupied: total - free },
    orders: { active: num(s.orders_active), late: num(s.orders_late), avgWaitMinutes: Math.round(num(s.avg_wait) * 10) / 10 },
    alerts: { pending: num(s.alerts_pending), inProgress: num(s.alerts_in_progress) },
    accounts: { open: num(s.accounts_open) },
    revenue: { today: num(s.billed_today), receivedToday: num(s.received_today) },
  }
})

// ------------------------------------------------------------------ mesas e QR Codes
route('GET', '/tables', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const rows = await query(
    `SELECT t.id, t.identifier, t.number, t.capacity, t.status, t.qr_token, t.qr_active, t.active,
            a.identifier AS account, a.status AS account_status,
            (SELECT w.name FROM users w WHERE w.id = a.waiter_id) AS waiter_name, a.waiter_id, COALESCE(a.total, 0) AS current_total,
            (SELECT count(*) FROM sessions s WHERE s.table_id = t.id AND s.status = 'active') AS active_sessions,
            (SELECT count(*) FROM alerts al WHERE al.table_id = t.id AND al.status <> 'resolved') AS open_alerts,
            (SELECT count(*) FROM orders o WHERE o.account_id = a.id AND o.status NOT IN ('delivered','cancelled')) AS open_orders,
            (SELECT min(o.created_at) FROM orders o WHERE o.account_id = a.id AND o.status <> 'cancelled') AS first_order_at,
            (SELECT max(o.created_at) FROM orders o WHERE o.account_id = a.id AND o.status <> 'cancelled') AS last_order_at,
            a.opened_at
       FROM tables t LEFT JOIN accounts a ON a.table_id = t.id AND a.status <> 'closed'
      WHERE t.restaurant_id = $1 ORDER BY t.number`,
    [u.restaurantId]
  )
  return rows.map((t) => ({
    id: num(t.id), identifier: t.identifier, number: num(t.number), capacity: num(t.capacity), status: t.status,
    active: t.active, qrActive: t.qr_active, qrUrl: qrUrl(ctx.req, t.qr_token),
    account: t.account, accountStatus: t.account_status, waiter: t.waiter_name ? { id: num(t.waiter_id), name: t.waiter_name } : null, currentTotal: num(t.current_total),
    activeSessions: num(t.active_sessions), openAlerts: num(t.open_alerts), openOrders: num(t.open_orders),
    firstOrderAt: t.first_order_at, lastOrderAt: t.last_order_at, occupiedSince: t.opened_at,
  }))
})

route('POST', '/tables', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  // sem número informado: usa o próximo da sequência (maior número existente + 1)
  let number = ctx.body.number
  if (number === undefined || number === null || number === '') {
    const [m] = await query('SELECT COALESCE(max(number), 0) + 1 AS n FROM tables WHERE restaurant_id = $1', [u.restaurantId])
    number = num(m.n)
  }
  number = Number(number)
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw new HttpError(422, 'Número de mesa inválido')
  const [t] = await query(
    `INSERT INTO tables (restaurant_id, identifier, number, capacity)
     VALUES ($1, 'MESA-' || lpad($2::text, 3, '0'), $2, $3) RETURNING id, identifier, number, qr_token`,
    [u.restaurantId, number, Number.isInteger(ctx.body.capacity) ? ctx.body.capacity : 4]
  )
  await audit(u, 'table.create', 'table', t.identifier)
  ctx.status = 201
  return { id: num(t.id), identifier: t.identifier, number: num(t.number), qrUrl: qrUrl(ctx.req, t.qr_token) }
})

// Regenera o token: o QR antigo deixa de funcionar imediatamente.
route('POST', '/tables/:id/qr/regenerate', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const rows = await query(
    `UPDATE tables SET qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
                       qr_active = true, updated_at = now()
      WHERE id = $1 AND restaurant_id = $2 RETURNING identifier, qr_token`,
    [Number(ctx.params.id), u.restaurantId]
  )
  if (rows.length === 0) throw new HttpError(404, 'Mesa não encontrada')
  await audit(u, 'qr.regenerate', 'table', rows[0].identifier)
  return { identifier: rows[0].identifier, qrUrl: qrUrl(ctx.req, rows[0].qr_token) }
})

route('PATCH', '/tables/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const { qrActive, active } = ctx.body
  if (qrActive !== undefined && typeof qrActive !== 'boolean') throw new HttpError(422, 'qrActive inválido')
  if (active !== undefined && typeof active !== 'boolean') throw new HttpError(422, 'active inválido')
  const rows = await query(
    `UPDATE tables SET qr_active = COALESCE($3, qr_active), active = COALESCE($4, active), updated_at = now()
      WHERE id = $1 AND restaurant_id = $2
        AND ($4::boolean IS NOT FALSE OR NOT EXISTS (SELECT 1 FROM accounts WHERE table_id = tables.id AND status <> 'closed'))
      RETURNING identifier, qr_active, active`,
    [Number(ctx.params.id), u.restaurantId, qrActive ?? null, active ?? null]
  )
  if (rows.length === 0) throw new HttpError(409, 'Mesa não encontrada ou com conta aberta')
  await audit(u, 'table.update', 'table', rows[0].identifier, { qrActive, active })
  return { identifier: rows[0].identifier, qrActive: rows[0].qr_active, active: rows[0].active }
})

// Liberação forçada da mesa (gerência): encerra a conta mesmo com saldo em aberto.
// Pedidos ainda na cozinha são cancelados; os que já saíram para entrega viram "entregue".
route('POST', '/tables/:id/release', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const id = Number(ctx.params.id)
  if (!Number.isInteger(id)) throw new HttpError(422, 'Mesa inválida')
  const [t] = await query('SELECT id, number, identifier FROM tables WHERE id = $1 AND restaurant_id = $2', [id, u.restaurantId])
  if (!t) throw new HttpError(404, 'Mesa não encontrada')

  const [acc] = await query(`SELECT id, identifier FROM accounts WHERE table_id = $1 AND status <> 'closed'`, [id])
  let cancelled = 0, pending = 0
  if (acc) {
    const moved = await query(
      `UPDATE orders SET
              status       = CASE WHEN status = 'delivering' THEN 'delivered' ELSE 'cancelled' END,
              delivered_at = CASE WHEN status = 'delivering' THEN now() ELSE delivered_at END,
              cancelled_at = CASE WHEN status <> 'delivering' THEN now() ELSE cancelled_at END,
              updated_at   = now()
        WHERE account_id = $1 AND status IN ('received','preparing','ready','delivering')
        RETURNING status`, [acc.id])
    cancelled = moved.filter((o) => o.status === 'cancelled').length
    await query('SELECT recalc_account($1)', [acc.id])
    const [b] = await query('SELECT COALESCE(sum(pending), 0) AS pending FROM account_balances($1)', [acc.id])
    pending = num(b.pending)
  }

  const [r] = await query(
    `WITH ac AS (
        UPDATE accounts SET status = 'closed', closed_at = now()
         WHERE table_id = $2 AND restaurant_id = $1 AND status <> 'closed' RETURNING id
      ), se AS (
        UPDATE sessions SET status = 'closed', ended_at = now() WHERE table_id = $2 AND status = 'active' RETURNING 1
      ), al AS (
        UPDATE alerts SET status = 'resolved', resolved_at = now(), attended_by = COALESCE(attended_by, $3)
         WHERE table_id = $2 AND restaurant_id = $1 AND status <> 'resolved' RETURNING 1
      ), tb AS (
        UPDATE tables SET status = 'free', updated_at = now() WHERE id = $2 AND restaurant_id = $1 RETURNING 1
      )
      SELECT (SELECT count(*) FROM ac) AS accounts, (SELECT count(*) FROM se) AS sessions, (SELECT count(*) FROM al) AS alerts`,
    [u.restaurantId, id, u.id])
  const result = {
    table: num(t.number), accountClosed: num(r.accounts) > 0, sessionsClosed: num(r.sessions),
    alertsResolved: num(r.alerts), ordersCancelled: cancelled, pendingBalance: pending,
  }
  try { await audit(u, 'table.release', 'table', t.identifier, result) } catch { /* auditoria não desfaz a liberação */ }
  return result
})

// ------------------------------------------------------------------ pedidos / cozinha
const ORDERS_SQL = `
  SELECT o.identifier, o.daily_number, to_char(o.order_day, 'YYYY-MM-DD') AS order_day,
         o.status, o.total, o.notes, o.created_at, o.preparing_at, o.ready_at, o.delivered_at,
         t.number AS table_number, t.identifier AS table_code,
         c.name AS customer_name, c.identifier AS customer_code,
         EXTRACT(EPOCH FROM (COALESCE(o.ready_at, o.cancelled_at, now()) - o.created_at)) / 60 AS since_created,
         CASE WHEN o.preparing_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (COALESCE(o.ready_at, o.cancelled_at, now()) - o.preparing_at)) / 60 END AS prep_minutes,
         CASE WHEN o.ready_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (COALESCE(o.delivered_at, o.cancelled_at, now()) - o.ready_at)) / 60 END AS awaiting_delivery,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('name', oi.product_name, 'quantity', oi.quantity,
                     'addons', oi.addons, 'notes', oi.notes, 'subtotal', oi.subtotal) ORDER BY oi.id)
                   FROM order_items oi WHERE oi.order_id = o.id), '[]'::jsonb) AS items
    FROM orders o JOIN tables t ON t.id = o.table_id JOIN customers c ON c.id = o.customer_id`

async function listOrders(user, where, params, order, limit = 200) {
  const cfg = await restaurantSettings(user.restaurantId)
  const rows = await query(
    `${ORDERS_SQL} WHERE o.restaurant_id = $1 ${where} ORDER BY ${order} LIMIT ${limit}`,
    [user.restaurantId, ...params]
  )
  return rows.map((o) => {
    const wait = Math.round(num(o.since_created) * 10) / 10
    return {
      id: o.identifier, number: o.daily_number, day: o.order_day, status: o.status, total: num(o.total), notes: o.notes, createdAt: o.created_at,
      tableNumber: num(o.table_number), tableCode: o.table_code, customerName: o.customer_name, customerCode: o.customer_code,
      waitMinutes: wait, prepMinutes: o.prep_minutes === null ? null : Math.round(num(o.prep_minutes) * 10) / 10,
      awaitingDeliveryMinutes: o.awaiting_delivery === null ? null : Math.round(num(o.awaiting_delivery) * 10) / 10,
      waitLevel: waitLevel(wait, cfg.normalMax, cfg.attentionMax), items: o.items,
    }
  })
}

const ORDER_STATUSES = ['received', 'preparing', 'ready', 'delivering', 'delivered', 'cancelled']

// Histórico de pedidos por período, em ordem cronológica; cada dia tem a sua numeração (Pedido 1, 2, 3...).
route('GET', '/orders/history', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const { from, to } = ctx.query
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(from || '') || !iso.test(to || '') || from > to) throw new HttpError(422, 'Período inválido')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new HttpError(422, 'Período máximo de 366 dias')
  const rows = await query(
    `SELECT o.identifier, o.daily_number, to_char(o.order_day, 'YYYY-MM-DD') AS day, o.status, o.total, o.created_at,
            t.number AS table_number, c.name AS customer_name,
            (SELECT string_agg(oi.quantity || 'x ' || oi.product_name, ', ' ORDER BY oi.id) FROM order_items oi WHERE oi.order_id = o.id) AS items
       FROM orders o JOIN tables t ON t.id = o.table_id JOIN customers c ON c.id = o.customer_id
      WHERE o.restaurant_id = $1 AND o.order_day BETWEEN $2::date AND $3::date
      ORDER BY o.order_day, o.daily_number
      LIMIT 5000`,
    [u.restaurantId, from, to])
  return rows.map((o) => ({
    id: o.identifier, number: o.daily_number, day: o.day, status: o.status, total: num(o.total), createdAt: o.created_at,
    tableNumber: num(o.table_number), customerName: o.customer_name, items: o.items || '',
  }))
})

route('GET', '/orders', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const status = ctx.query.status
  if (status && !ORDER_STATUSES.includes(status)) throw new HttpError(422, 'Status inválido')
  return listOrders(u, status ? 'AND o.status = $2' : '', status ? [status] : [], 'o.created_at DESC')
})

route('GET', '/kitchen/orders', async (ctx) => {
  const u = await staff(ctx, ROLES.kitchen)
  return listOrders(u, `AND o.status IN ('received','preparing','ready')`, [], 'o.created_at ASC')
})

// Quem pode mover o pedido para cada status: cozinha prepara; salão entrega/cancela; gerência faz tudo.
const STATUS_ROLES = {
  preparing: ['admin', 'manager', 'kitchen'], ready: ['admin', 'manager', 'kitchen'],
  delivering: ['admin', 'manager', 'waiter'], delivered: ['admin', 'manager', 'waiter'],
  cancelled: ['admin', 'manager', 'waiter'],
}
route('PATCH', '/orders/:id/status', async (ctx) => {
  const u = await staff(ctx)
  const status = ctx.body.status
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(422, 'Status inválido')
  if (!STATUS_ROLES[status]?.includes(u.role)) throw new HttpError(403, 'Seu perfil não pode fazer essa mudança de status')
  const [r] = await query('SELECT set_order_status($1, $2, $3, $4) AS r', [u.restaurantId, u.id, ctx.params.id, status])

  // Garçom que leva o pedido assume a mesa automaticamente (só se a conta ainda não tiver garçom).
  let waiterAssumed = false
  if (u.role === 'waiter' && ['delivering', 'delivered'].includes(status)) {
    try {
      const rows = await query(
        `UPDATE accounts a SET waiter_id = $1
           FROM orders o
          WHERE o.identifier = $2 AND o.restaurant_id = $3 AND a.id = o.account_id AND a.restaurant_id = $3
            AND a.waiter_id IS NULL AND a.status <> 'closed'
        RETURNING a.identifier`,
        [u.id, ctx.params.id, u.restaurantId])
      waiterAssumed = rows.length > 0
      if (waiterAssumed) {
        await query(`SELECT app_audit($1, 'user', $2, 'account.waiter', 'account', $3, $4::jsonb)`,
          [u.restaurantId, String(u.id), rows[0].identifier, JSON.stringify({ waiterId: u.id, auto: true })])
      }
    } catch { /* assumir a mesa nunca deve impedir a entrega */ }
  }
  return r.r && typeof r.r === 'object' ? { ...r.r, waiterAssumed } : r.r
})

// ------------------------------------------------------------------ alertas de atendimento
async function listAlerts(user, onlyOpen) {
  const rows = await query(
    `SELECT al.identifier, al.status, al.created_at, al.resolved_at, t.number AS table_number,
            t.identifier AS table_code, r.name AS restaurant_name, u.name AS attended_by, c.name AS customer_name
       FROM alerts al JOIN tables t ON t.id = al.table_id JOIN restaurants r ON r.id = al.restaurant_id
       LEFT JOIN users u ON u.id = al.attended_by LEFT JOIN customers c ON c.id = al.customer_id
      WHERE al.restaurant_id = $1 ${onlyOpen ? `AND al.status <> 'resolved'` : ''}
      ORDER BY al.created_at DESC LIMIT 200`,
    [user.restaurantId]
  )
  return rows.map((a) => ({
    id: a.identifier, status: a.status, createdAt: a.created_at, resolvedAt: a.resolved_at,
    tableNumber: num(a.table_number), tableCode: a.table_code, restaurantName: a.restaurant_name,
    attendedBy: a.attended_by, customerName: a.customer_name,
  }))
}

route('GET', '/alerts/pending', async (ctx) => listAlerts(await staff(ctx, ROLES.floor), true))
route('GET', '/alerts', async (ctx) => listAlerts(await staff(ctx, ROLES.floor), false))
route('PATCH', '/alerts/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const status = ctx.body.status
  if (!['in_progress', 'resolved'].includes(status)) throw new HttpError(422, 'Status inválido')
  const [r] = await query('SELECT set_alert_status($1, $2, $3, $4) AS r', [u.restaurantId, u.id, ctx.params.id, status])
  return r.r
})

// ------------------------------------------------------------------ categorias
const catOut = (c) => ({
  id: num(c.id), name: c.name, description: c.description, imageUrl: c.image_url,
  displayOrder: num(c.display_order), active: c.status === 'active',
})

route('GET', '/categories', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const rows = await query(
    'SELECT * FROM categories WHERE restaurant_id = $1 ORDER BY display_order, name', [u.restaurantId])
  return rows.map(catOut)
})

function categoryBody(b) {
  return {
    name: str(b.name, { min: 1, max: 100, field: 'Nome' }),
    description: optStr(b.description, 500),
    imageUrl: optStr(b.imageUrl, 500),
    order: Number.isInteger(b.displayOrder) ? b.displayOrder : 0,
    status: b.active === false ? 'inactive' : 'active',
  }
}

route('POST', '/categories', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const c = categoryBody(ctx.body)
  const [row] = await query(
    `INSERT INTO categories (restaurant_id, name, description, image_url, display_order, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [u.restaurantId, c.name, c.description, c.imageUrl, c.order, c.status]
  )
  ctx.status = 201
  return catOut(row)
})

route('PUT', '/categories/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const c = categoryBody(ctx.body)
  const rows = await query(
    `UPDATE categories SET name = $3, description = $4, image_url = $5, display_order = $6, status = $7, updated_at = now()
      WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
    [Number(ctx.params.id), u.restaurantId, c.name, c.description, c.imageUrl, c.order, c.status]
  )
  if (rows.length === 0) throw new HttpError(404, 'Categoria não encontrada')
  return catOut(rows[0])
})

route('DELETE', '/categories/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const rows = await query(
    `DELETE FROM categories WHERE id = $1 AND restaurant_id = $2
        AND NOT EXISTS (SELECT 1 FROM products WHERE category_id = categories.id) RETURNING id`,
    [Number(ctx.params.id), u.restaurantId]
  )
  if (rows.length === 0) throw new HttpError(409, 'Categoria não encontrada ou em uso por produtos')
  return { deleted: true }
})

// ------------------------------------------------------------------ produtos
const PRODUCTS_SQL = `
  SELECT p.id, p.identifier, p.name, p.description, p.ingredients, p.price, p.image_url, p.available, p.active,
         p.is_demo, p.category_id, c.name AS category_name, p.created_at, p.updated_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) ORDER BY a.id)
                   FROM product_addons a WHERE a.product_id = p.id AND a.active), '[]'::jsonb) AS addons
    FROM products p JOIN categories c ON c.id = p.category_id`

const productOut = (p) => ({
  id: p.identifier, name: p.name, description: p.description, ingredients: p.ingredients, price: num(p.price),
  imageUrl: p.image_url, available: p.available, active: p.active, isDemo: p.is_demo,
  categoryId: num(p.category_id), category: p.category_name, addons: p.addons.map((a) => ({ ...a, price: num(a.price) })),
  createdAt: p.created_at, updatedAt: p.updated_at,
})

route('GET', '/products', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const params = [u.restaurantId]
  let where = 'WHERE p.restaurant_id = $1 AND p.active'
  if (ctx.query.categoryId) { params.push(Number(ctx.query.categoryId)); where += ` AND p.category_id = $${params.length}` }
  if (ctx.query.q) { params.push(`%${ctx.query.q.slice(0, 80)}%`); where += ` AND p.name ILIKE $${params.length}` }
  return (await query(`${PRODUCTS_SQL} ${where} ORDER BY c.display_order, p.name`, params)).map(productOut)
})

function productBody(b) {
  const addons = Array.isArray(b.addons) ? b.addons : []
  if (addons.length > 30) throw new HttpError(422, 'Adicionais demais')
  return {
    name: str(b.name, { min: 1, max: 200, field: 'Nome' }),
    description: optStr(b.description, 1000),
    ingredients: optStr(b.ingredients, 1000),
    price: price(b.price),
    imageUrl: optStr(b.imageUrl, 500),
    categoryId: Number(b.categoryId),
    available: b.available !== false,
    addons: addons.map((a) => ({ name: str(a.name, { min: 1, max: 100, field: 'Adicional' }), price: price(a.price, 'preço do adicional') })),
  }
}

const saveAddons = (restaurantId, productId, addons) =>
  query(
    `WITH del AS (DELETE FROM product_addons WHERE product_id = $1 AND restaurant_id = $2)
     INSERT INTO product_addons (restaurant_id, product_id, name, price)
     SELECT $2, $1, a->>'name', (a->>'price')::numeric FROM jsonb_array_elements($3::jsonb) a`,
    [productId, restaurantId, JSON.stringify(addons)]
  )

async function ownCategory(u, id) {
  const rows = await query('SELECT id FROM categories WHERE id = $1 AND restaurant_id = $2', [id, u.restaurantId])
  if (rows.length === 0) throw new HttpError(422, 'Categoria inválida')
}

route('POST', '/products', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const p = productBody(ctx.body)
  await ownCategory(u, p.categoryId)
  const [row] = await query(
    `INSERT INTO products (restaurant_id, category_id, name, description, ingredients, price, image_url, available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, identifier`,
    [u.restaurantId, p.categoryId, p.name, p.description, p.ingredients, p.price, p.imageUrl, p.available]
  )
  await saveAddons(u.restaurantId, row.id, p.addons)
  await audit(u, 'product.create', 'product', row.identifier, { price: p.price })
  ctx.status = 201
  const [out] = await query(`${PRODUCTS_SQL} WHERE p.id = $1`, [row.id])
  return productOut(out)
})

route('PUT', '/products/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const p = productBody(ctx.body)
  const [old] = await query('SELECT id, price FROM products WHERE identifier = $1 AND restaurant_id = $2 AND active', [ctx.params.id, u.restaurantId])
  if (!old) throw new HttpError(404, 'Produto não encontrado')
  await ownCategory(u, p.categoryId)
  // Pedidos já feitos guardam o preço da época (snapshot em order_items): editar aqui não os altera.
  await query(
    `UPDATE products SET category_id = $2, name = $3, description = $4, ingredients = $5, price = $6,
            image_url = $7, available = $8, updated_at = now() WHERE id = $1`,
    [old.id, p.categoryId, p.name, p.description, p.ingredients, p.price, p.imageUrl, p.available]
  )
  await saveAddons(u.restaurantId, old.id, p.addons)
  await audit(u, 'product.update', 'product', ctx.params.id, { oldPrice: num(old.price), price: p.price })
  const [out] = await query(`${PRODUCTS_SQL} WHERE p.id = $1`, [old.id])
  return productOut(out)
})

// Exclusão lógica: histórico de pedidos continua referenciando o produto.
route('DELETE', '/products/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const rows = await query(
    'UPDATE products SET active = false, updated_at = now() WHERE identifier = $1 AND restaurant_id = $2 AND active RETURNING id',
    [ctx.params.id, u.restaurantId]
  )
  if (rows.length === 0) throw new HttpError(404, 'Produto não encontrado')
  await audit(u, 'product.delete', 'product', ctx.params.id)
  return { deleted: true }
})

// ------------------------------------------------------------------ clientes (dados pessoais sempre mascarados)
route('GET', '/customers', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  const q = ctx.query.q ? `%${ctx.query.q.slice(0, 80)}%` : null
  const rows = await query(
    `SELECT c.identifier, c.name, c.phone_masked, c.created_at,
            (SELECT count(*) FROM sessions s WHERE s.customer_id = c.id) AS visits,
            (SELECT count(*) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS orders,
            (SELECT COALESCE(sum(o.total), 0) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS consumed,
            (SELECT max(s.started_at) FROM sessions s WHERE s.customer_id = c.id) AS last_visit
       FROM customers c
      WHERE c.restaurant_id = $1 AND ($2::text IS NULL OR c.name ILIKE $2 OR c.identifier ILIKE $2)
      ORDER BY last_visit DESC NULLS LAST LIMIT 200`,
    [u.restaurantId, q]
  )
  return rows.map((c) => ({
    id: c.identifier, name: c.name, phone: c.phone_masked, visits: num(c.visits),
    orders: num(c.orders), consumed: num(c.consumed), lastVisit: c.last_visit, createdAt: c.created_at,
  }))
})
