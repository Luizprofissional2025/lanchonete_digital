// Contas, pagamentos, compartilhamento via WhatsApp (wa.me) e relatórios de vendas.
import { decryptField } from '../../lib/crypto.js'
import { HttpError } from '../../lib/http.js'
import { query } from '../../lib/neon.js'
import { maskPhone, whatsappDigits } from '../../lib/validation.js'
import { route } from '../router.js'
import { ROLES, TZ, num, restaurantSettings, staff } from '../common.js'
import { customerStatement, tableStatement } from '../statement.js'

const ACCOUNT_STATUSES = ['open', 'awaiting_payment', 'closed']
const METHODS = ['cash', 'pix', 'debit', 'credit', 'other']

async function accountSummary(user, identifier) {
  const rows = await query(
    `SELECT account_summary($1, a.id) AS s FROM accounts a WHERE a.identifier = $2 AND a.restaurant_id = $1`,
    [user.restaurantId, identifier]
  )
  if (rows.length === 0 || !rows[0].s) throw new HttpError(404, 'Conta não encontrada')
  return rows[0].s
}

route('GET', '/accounts', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const status = ctx.query.status
  if (status && !ACCOUNT_STATUSES.includes(status)) throw new HttpError(422, 'Status inválido')
  const rows = await query(
    `SELECT a.identifier, a.status, a.total, a.opened_at, a.closed_at, t.number AS table_number,
            COALESCE((SELECT sum(p.amount) FROM payments p WHERE p.account_id = a.id AND p.status = 'confirmed'), 0) AS paid,
            (SELECT count(DISTINCT o.customer_id) FROM orders o WHERE o.account_id = a.id AND o.status <> 'cancelled') AS customers,
            COALESCE((SELECT sum(b.consumed + b.fee) FROM account_balances(a.id) b), 0) AS total_with_fee,
            COALESCE((SELECT sum(b.fee) FROM account_balances(a.id) b), 0) AS fee,
            (SELECT u.name FROM users u WHERE u.id = a.waiter_id) AS waiter_name
       FROM accounts a JOIN tables t ON t.id = a.table_id
      WHERE a.restaurant_id = $1 ${status ? 'AND a.status = $2' : ''}
      ORDER BY a.opened_at DESC LIMIT 200`,
    status ? [u.restaurantId, status] : [u.restaurantId]
  )
  return rows.map((a) => ({
    id: a.identifier, status: a.status, tableNumber: num(a.table_number), consumed: num(a.total), fee: num(a.fee),
    total: num(a.total_with_fee), paid: num(a.paid), waiter: a.waiter_name || null,
    pending: Math.round((num(a.total_with_fee) - num(a.paid)) * 100) / 100, customers: num(a.customers),
    openedAt: a.opened_at, closedAt: a.closed_at,
  }))
})

route('GET', '/accounts/:id', async (ctx) => accountSummary(await staff(ctx, ROLES.floor), ctx.params.id))

// Passo 1 do fechamento: congela a conta (sem novos pedidos) e mostra os valores por cliente.
route('POST', '/accounts/:id/close', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const [r] = await query('SELECT begin_account_close($1, $2, $3) AS r', [u.restaurantId, u.id, ctx.params.id])
  return r.r
})

// Passo 2: pagamento confirmado por funcionário. A mesa só é liberada quando todos quitarem.
route('POST', '/accounts/:id/payments', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const { customer, amount, method, reference } = ctx.body
  const value = typeof amount === 'string' ? Number(amount.replace(',', '.')) : amount
  if (typeof customer !== 'string' || !Number.isFinite(value) || value <= 0) throw new HttpError(422, 'Cliente e valor são obrigatórios')
  if (!METHODS.includes(method)) throw new HttpError(422, 'Meio de pagamento inválido')
  const [r] = await query('SELECT register_payment($1, $2, $3, $4, $5, $6, $7) AS r', [
    u.restaurantId, u.id, ctx.params.id, customer, value, method,
    typeof reference === 'string' ? reference.slice(0, 200) : null,
  ])
  ctx.status = 201
  return r.r
})

// ------------------------------------------------------------------ WhatsApp (wa.me)
// Abrir o link NÃO é envio nem pagamento: só registramos "iniciado"; o funcionário confirma manualmente.
route('POST', '/accounts/:id/whatsapp', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const summary = await accountSummary(u, ctx.params.id)
  const cfg = await restaurantSettings(u.restaurantId)

  if (!ctx.body.customer) {
    return { scope: 'table', message: tableStatement(summary, cfg.name), customers: summary.customers.length }
  }
  const customer = summary.customers.find((c) => c.customer === ctx.body.customer)
  if (!customer) throw new HttpError(404, 'Cliente não encontrado nesta conta')
  const [row] = await query(
    'SELECT id, phone_encrypted FROM customers WHERE identifier = $1 AND restaurant_id = $2',
    [customer.customer, u.restaurantId]
  )
  const e164 = decryptField(row.phone_encrypted)
  const message = customerStatement(summary, customer, cfg.name)
  const url = `https://wa.me/${whatsappDigits(e164)}?text=${encodeURIComponent(message)}`
  const [share] = await query(
    `INSERT INTO whatsapp_shares (restaurant_id, account_id, customer_id, phone_masked, user_id, status)
     SELECT $1, a.id, $2, $3, $4, 'prepared' FROM accounts a WHERE a.identifier = $5 AND a.restaurant_id = $1
     RETURNING id`,
    [u.restaurantId, row.id, maskPhone(e164), u.id, ctx.params.id]
  )
  ctx.status = 201
  return {
    scope: 'customer', shareId: num(share.id), message, url, customerName: customer.name,
    phoneMasked: maskPhone(e164), status: 'prepared',
  }
})

const SHARE_ORDER = { prepared: 0, share_started: 1, confirmed_by_staff: 2, failed: 2 }
route('PATCH', '/whatsapp-shares/:id', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const status = ctx.body.status
  if (!['share_started', 'confirmed_by_staff', 'failed'].includes(status)) throw new HttpError(422, 'Status inválido')
  const rows = await query(
    'SELECT status FROM whatsapp_shares WHERE id = $1 AND restaurant_id = $2', [Number(ctx.params.id), u.restaurantId])
  if (rows.length === 0) throw new HttpError(404, 'Compartilhamento não encontrado')
  if (SHARE_ORDER[status] <= SHARE_ORDER[rows[0].status]) throw new HttpError(409, 'Transição inválida')
  await query('UPDATE whatsapp_shares SET status = $3, updated_at = now() WHERE id = $1 AND restaurant_id = $2',
    [Number(ctx.params.id), u.restaurantId, status])
  return { shareId: Number(ctx.params.id), status }
})

route('GET', '/whatsapp-shares', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const rows = await query(
    `SELECT w.id, a.identifier AS account, c.identifier AS customer, w.phone_masked, us.name AS staff, w.status, w.created_at
       FROM whatsapp_shares w JOIN accounts a ON a.id = w.account_id
       LEFT JOIN customers c ON c.id = w.customer_id LEFT JOIN users us ON us.id = w.user_id
      WHERE w.restaurant_id = $1 ${ctx.query.account ? 'AND a.identifier = $2' : ''}
      ORDER BY w.created_at DESC LIMIT 200`,
    ctx.query.account ? [u.restaurantId, ctx.query.account] : [u.restaurantId]
  )
  return rows.map((w) => ({ id: num(w.id), account: w.account, customer: w.customer, phone: w.phone_masked, staff: w.staff, status: w.status, createdAt: w.created_at }))
})

// ------------------------------------------------------------------ relatórios de vendas
const isoDate = /^\d{4}-\d{2}-\d{2}$/
const RANGE = `>= ($2::date)::timestamp AT TIME ZONE $4 AND {col} < (($3::date + 1)::timestamp AT TIME ZONE $4)`
const inRange = (col) => `${col} ${RANGE.replace('{col}', col)}`

route('GET', '/reports/sales', async (ctx) => {
  const u = await staff(ctx, ROLES.management)
  let { from, to } = ctx.query
  const [today] = await query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`, [TZ])
  from ||= today.d
  to ||= from
  if (!isoDate.test(from) || !isoDate.test(to) || from > to) throw new HttpError(422, 'Período inválido')
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (days > 366) throw new HttpError(422, 'Período máximo de 366 dias')
  const p = [u.restaurantId, from, to, TZ]
  const o = (extra = '') => `o.restaurant_id = $1 AND ${inRange('o.created_at')} ${extra}`

  const [ind, rec, closed, pend, sold, byDay, byRecDay, byHour, top, byCat, byMethod] = await Promise.all([
    query(`SELECT COALESCE(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS billed,
                  count(*) FILTER (WHERE o.status <> 'cancelled') AS placed,
                  count(*) FILTER (WHERE o.status = 'cancelled') AS cancelled,
                  count(DISTINCT o.table_id) FILTER (WHERE o.status <> 'cancelled') AS tables_served,
                  count(DISTINCT o.account_id) FILTER (WHERE o.status <> 'cancelled') AS accounts_with_orders
             FROM orders o WHERE ${o()}`, p),
    query(`SELECT COALESCE(sum(amount), 0) AS received FROM payments x
            WHERE x.restaurant_id = $1 AND x.status = 'confirmed' AND ${inRange('x.confirmed_at')}`, p),
    query(`SELECT count(*) AS n FROM accounts x WHERE x.restaurant_id = $1 AND x.status = 'closed' AND ${inRange('x.closed_at')}`, p),
    query(`SELECT COALESCE(sum((SELECT COALESCE(sum(pending), 0) FROM account_balances(a.id))), 0) AS pending
             FROM accounts a WHERE a.restaurant_id = $1 AND a.status = 'awaiting_payment'`, [u.restaurantId]),
    query(`SELECT COALESCE(sum(oi.quantity), 0) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE ${o(`AND o.status <> 'cancelled'`)}`, p),
    query(`SELECT to_char((o.created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day,
                  sum(o.total) AS billed, count(*) AS orders
             FROM orders o WHERE ${o(`AND o.status <> 'cancelled'`)} GROUP BY 1 ORDER BY 1`, p),
    query(`SELECT to_char((x.confirmed_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day, sum(x.amount) AS received
             FROM payments x WHERE x.restaurant_id = $1 AND x.status = 'confirmed' AND ${inRange('x.confirmed_at')} GROUP BY 1`, p),
    query(`SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE $4)::int AS hour, sum(o.total) AS billed, count(*) AS orders
             FROM orders o WHERE ${o(`AND o.status <> 'cancelled'`)} GROUP BY 1 ORDER BY 1`, p),
    query(`SELECT oi.product_name AS name, sum(oi.quantity) AS qty, sum(oi.subtotal) AS revenue
             FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${o(`AND o.status <> 'cancelled'`)}
            GROUP BY 1 ORDER BY qty DESC, revenue DESC LIMIT 10`, p),
    query(`SELECT c.name, sum(oi.quantity) AS qty, sum(oi.subtotal) AS revenue
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
             JOIN products pr ON pr.id = oi.product_id JOIN categories c ON c.id = pr.category_id
            WHERE ${o(`AND o.status <> 'cancelled'`)} GROUP BY 1 ORDER BY revenue DESC`, p),
    query(`SELECT x.method, sum(x.amount) AS amount, count(*) AS n FROM payments x
            WHERE x.restaurant_id = $1 AND x.status = 'confirmed' AND ${inRange('x.confirmed_at')} GROUP BY 1 ORDER BY amount DESC`, p),
  ])

  const billed = num(ind[0].billed)
  const accountsWithOrders = num(ind[0].accounts_with_orders)
  const recByDay = new Map(byRecDay.map((r) => [r.day, num(r.received)]))
  const dayMap = new Map(byDay.map((r) => [r.day, { day: r.day, billed: num(r.billed), orders: num(r.orders), received: 0 }]))
  for (const [day, received] of recByDay) {
    dayMap.set(day, { ...(dayMap.get(day) || { day, billed: 0, orders: 0 }), received })
  }
  const series = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day))

  const result = {
    period: { from, to },
    indicators: {
      billed,                                             // faturamento bruto (pedidos não cancelados)
      received: num(rec[0].received),                     // pagamentos efetivamente recebidos
      ordersPlaced: num(ind[0].placed),
      ordersCancelled: num(ind[0].cancelled),
      accountsClosed: num(closed[0].n),
      accountsWithOrders,
      averageTicket: accountsWithOrders ? Math.round((billed / accountsWithOrders) * 100) / 100 : 0,
      productsSold: num(sold[0].qty),
      tablesServed: num(ind[0].tables_served),
      pendingPayments: num(pend[0].pending),
    },
    byDay: series,
    byHour: byHour.map((h) => ({ hour: num(h.hour), billed: num(h.billed), orders: num(h.orders) })),
    topProducts: top.map((r) => ({ name: r.name, quantity: num(r.qty), revenue: num(r.revenue) })),
    byCategory: byCat.map((r) => ({ name: r.name, quantity: num(r.qty), revenue: num(r.revenue) })),
    byMethod: byMethod.map((r) => ({ method: r.method, amount: num(r.amount), payments: num(r.n) })),
  }

  if (ctx.query.format === 'csv') {
    const lines = ['dia,faturamento,recebido,pedidos', ...series.map((d) => `${d.day},${d.billed.toFixed(2)},${d.received.toFixed(2)},${d.orders}`)]
    ctx.raw = {
      type: 'text/csv; charset=utf-8',
      body: '﻿' + lines.join('\n') + '\n',
      headers: { 'Content-Disposition': `attachment; filename="vendas-${from}_${to}.csv"` },
    }
  }
  return result
})

// ------------------------------------------------------------------ garçom responsável e taxa de serviço
// Garçom assume a própria mesa (só se estiver sem garçom); gerência pode atribuir/trocar.
route('POST', '/accounts/:id/waiter', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const target = u.role === 'waiter' ? u.id : Number(ctx.body.userId)
  if (!Number.isInteger(target)) throw new HttpError(422, 'Informe o garçom')
  const [acc] = await query(
    `SELECT a.id, a.status, a.waiter_id, (SELECT name FROM users WHERE id = a.waiter_id) AS waiter_name
       FROM accounts a WHERE a.identifier = $1 AND a.restaurant_id = $2`, [ctx.params.id, u.restaurantId])
  if (!acc) throw new HttpError(404, 'Conta não encontrada')
  if (acc.status === 'closed') throw new HttpError(409, 'Conta já encerrada')
  if (u.role === 'waiter' && acc.waiter_id && Number(acc.waiter_id) !== u.id) {
    throw new HttpError(409, `Mesa já atendida por ${acc.waiter_name}. Peça ao gerente para trocar.`)
  }
  const ok = await query(
    `SELECT 1 FROM users WHERE id = $1 AND restaurant_id = $2 AND status = 'active' AND role IN ('waiter','manager','admin')`,
    [target, u.restaurantId])
  if (ok.length === 0) throw new HttpError(422, 'Garçom inválido ou inativo')
  await query('UPDATE accounts SET waiter_id = $1 WHERE id = $2', [target, acc.id])
  await query(`SELECT app_audit($1, 'user', $2, 'account.waiter', 'account', $3, $4::jsonb)`,
    [u.restaurantId, String(u.id), ctx.params.id, JSON.stringify({ waiterId: target })])
  return accountSummary(u, ctx.params.id)
})

// Remove/restaura a taxa de serviço de um cliente (campo "customer") ou da mesa toda (sem "customer").
route('POST', '/accounts/:id/fee', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const remove = ctx.body.remove !== false
  const customer = ctx.body.customer ? String(ctx.body.customer) : null
  const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason : ''
  const [r] = await query('SELECT set_service_fee($1, $2, $3, $4, $5, $6) AS r',
    [u.restaurantId, u.id, ctx.params.id, customer, remove, reason])
  return r.r
})

// ------------------------------------------------------------------ limpeza de dados de teste (somente administrador)
// Apaga o que foi consumido no período: pedidos e itens, pagamentos e as contas FECHADAS do período
// (com compartilhamentos de WhatsApp e isenções de taxa delas). Contas abertas e mesas ficam.
// Não é possível desfazer. Tudo ou nada: se algo falhar, nada é apagado.
route('POST', '/reports/purge-orders', async (ctx) => {
  const u = await staff(ctx, ['admin'])
  const { from, to, confirm, includePayments } = ctx.body
  if (confirm !== 'APAGAR') throw new HttpError(422, 'Digite APAGAR para confirmar')
  if (typeof from !== 'string' || typeof to !== 'string' || !isoDate.test(from) || !isoDate.test(to) || from > to) {
    throw new HttpError(422, 'Período inválido')
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new HttpError(422, 'Período máximo de 366 dias')
  const withPayments = includePayments !== false

  const [r] = await query(
    `WITH rng AS (
        SELECT ($2::date)::timestamp AT TIME ZONE $4 AS a, (($3::date + 1)::timestamp AT TIME ZONE $4) AS b
      ), o AS (
        SELECT o.id FROM orders o, rng
         WHERE o.restaurant_id = $1 AND o.created_at >= rng.a AND o.created_at < rng.b
      ), da AS (
        SELECT ac.id FROM accounts ac, rng
         WHERE ac.restaurant_id = $1 AND ac.status = 'closed'
           AND ((ac.closed_at >= rng.a AND ac.closed_at < rng.b) OR (ac.opened_at >= rng.a AND ac.opened_at < rng.b))
           AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.account_id = ac.id AND x.id NOT IN (SELECT id FROM o))
      ), di AS (
        DELETE FROM order_items WHERE order_id IN (SELECT id FROM o) RETURNING 1
      ), dord AS (
        DELETE FROM orders WHERE id IN (SELECT id FROM o) AND restaurant_id = $1 RETURNING 1
      ), dp AS (
        DELETE FROM payments x
         WHERE x.restaurant_id = $1
           AND (x.account_id IN (SELECT id FROM da)
                OR ($5::boolean AND x.confirmed_at >= (SELECT a FROM rng) AND x.confirmed_at < (SELECT b FROM rng)))
        RETURNING 1
      ), dws AS (
        DELETE FROM whatsapp_shares WHERE account_id IN (SELECT id FROM da) RETURNING 1
      ), dfw AS (
        DELETE FROM account_fee_waivers WHERE account_id IN (SELECT id FROM da) RETURNING 1
      ), dacc AS (
        DELETE FROM accounts WHERE id IN (SELECT id FROM da) AND restaurant_id = $1 RETURNING 1
      )
      SELECT (SELECT count(*) FROM dord) AS orders, (SELECT count(*) FROM di) AS items,
             (SELECT count(*) FROM dp) AS payments, (SELECT count(*) FROM dacc) AS accounts,
             (SELECT count(*) FROM dws) + (SELECT count(*) FROM dfw) AS extras`,
    [u.restaurantId, from, to, TZ, withPayments]
  )
  const result = { orders: num(r.orders), items: num(r.items), payments: num(r.payments), accounts: num(r.accounts), from, to }
  try {
    await query('SELECT app_audit($1, $2, $3, $4, $5, $6, $7::jsonb)', [
      u.restaurantId, 'user', String(u.id), 'orders.purge', 'restaurant', String(u.restaurantId), JSON.stringify(result),
    ])
  } catch { /* o registro de auditoria não deve desfazer a limpeza */ }
  return result
})

// ------------------------------------------------------------------ garçom responsável e taxa de serviço
// Garçom assume a própria mesa (só se estiver sem garçom); gerência pode atribuir/trocar.
route('POST', '/accounts/:id/waiter', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const target = u.role === 'waiter' ? u.id : Number(ctx.body.userId)
  if (!Number.isInteger(target)) throw new HttpError(422, 'Informe o garçom')
  const [acc] = await query(
    `SELECT a.id, a.status, a.waiter_id, (SELECT name FROM users WHERE id = a.waiter_id) AS waiter_name
       FROM accounts a WHERE a.identifier = $1 AND a.restaurant_id = $2`, [ctx.params.id, u.restaurantId])
  if (!acc) throw new HttpError(404, 'Conta não encontrada')
  if (acc.status === 'closed') throw new HttpError(409, 'Conta já encerrada')
  if (u.role === 'waiter' && acc.waiter_id && Number(acc.waiter_id) !== u.id) {
    throw new HttpError(409, `Mesa já atendida por ${acc.waiter_name}. Peça ao gerente para trocar.`)
  }
  const ok = await query(
    `SELECT 1 FROM users WHERE id = $1 AND restaurant_id = $2 AND status = 'active' AND role IN ('waiter','manager','admin')`,
    [target, u.restaurantId])
  if (ok.length === 0) throw new HttpError(422, 'Garçom inválido ou inativo')
  await query('UPDATE accounts SET waiter_id = $1 WHERE id = $2', [target, acc.id])
  await query(`SELECT app_audit($1, 'user', $2, 'account.waiter', 'account', $3, $4::jsonb)`,
    [u.restaurantId, String(u.id), ctx.params.id, JSON.stringify({ waiterId: target })])
  return accountSummary(u, ctx.params.id)
})

// Remove/restaura a taxa de serviço de um cliente (campo "customer") ou da mesa toda (sem "customer").
route('POST', '/accounts/:id/fee', async (ctx) => {
  const u = await staff(ctx, ROLES.floor)
  const remove = ctx.body.remove !== false
  const customer = ctx.body.customer ? String(ctx.body.customer) : null
  const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason : ''
  const [r] = await query('SELECT set_service_fee($1, $2, $3, $4, $5, $6) AS r',
    [u.restaurantId, u.id, ctx.params.id, customer, remove, reason])
  return r.r
})

// ------------------------------------------------------------------ limpeza de dados de teste (somente administrador)
// Apaga os pedidos (e seus itens) criados no período e, se pedido, os pagamentos confirmados no período.
// Não é possível desfazer. Contas e mesas não são removidas.
route('POST', '/reports/purge-orders', async (ctx) => {
  const u = await staff(ctx, ['admin'])
  const { from, to, confirm, includePayments } = ctx.body
  if (confirm !== 'APAGAR') throw new HttpError(422, 'Digite APAGAR para confirmar')
  if (typeof from !== 'string' || typeof to !== 'string' || !isoDate.test(from) || !isoDate.test(to) || from > to) {
    throw new HttpError(422, 'Período inválido')
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new HttpError(422, 'Período máximo de 366 dias')
  const withPayments = includePayments === true

  const [r] = await query(
    `WITH rng AS (
        SELECT ($2::date)::timestamp AT TIME ZONE $4 AS a, (($3::date + 1)::timestamp AT TIME ZONE $4) AS b
      ), o AS (
        SELECT o.id FROM orders o, rng
         WHERE o.restaurant_id = $1 AND o.created_at >= rng.a AND o.created_at < rng.b
      ), di AS (
        DELETE FROM order_items WHERE order_id IN (SELECT id FROM o) RETURNING 1
      ), dord AS (
        DELETE FROM orders WHERE id IN (SELECT id FROM o) AND restaurant_id = $1 RETURNING 1
      ), dp AS (
        DELETE FROM payments x USING rng
         WHERE $5::boolean AND x.restaurant_id = $1 AND x.confirmed_at >= rng.a AND x.confirmed_at < rng.b RETURNING 1
      )
      SELECT (SELECT count(*) FROM dord) AS orders, (SELECT count(*) FROM di) AS items, (SELECT count(*) FROM dp) AS payments`,
    [u.restaurantId, from, to, TZ, withPayments]
  )
  const result = { orders: num(r.orders), items: num(r.items), payments: num(r.payments), from, to }
  try {
    await query('SELECT app_audit($1, $2, $3, $4, $5, $6, $7::jsonb)', [
      u.restaurantId, 'user', String(u.id), 'orders.purge', 'restaurant', String(u.restaurantId), JSON.stringify(result),
    ])
  } catch { /* o registro de auditoria não deve desfazer a limpeza */ }
  return result
})
