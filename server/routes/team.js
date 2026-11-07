// Equipe (garçons, cozinha, gerentes), configurações do restaurante e relatório da taxa por garçom.
import { hashPassword } from '../../lib/auth.js'
import { HttpError } from '../../lib/http.js'
import { query } from '../../lib/neon.js'
import { validateEmail } from '../../lib/validation.js'
import { route } from '../router.js'
import { ROLES, TZ, num, staff } from '../common.js'

const audit = (user, action, entity, entityId, data = null) =>
  query('SELECT app_audit($1, $2, $3, $4, $5, $6, $7::jsonb)', [
    user.restaurantId, 'user', String(user.id), action, entity, entityId, data ? JSON.stringify(data) : null,
  ])

const present = (u) => ({
  id: num(u.id), name: u.name, email: u.email, role: u.role, status: u.status, lastLoginAt: u.last_login_at, createdAt: u.created_at,
})

// ------------------------------------------------------------------ equipe
route('GET', '/users', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  const rows = await query(
    `SELECT id, name, email, role, status, last_login_at, created_at FROM users
      WHERE restaurant_id = $1 AND ($2 OR role <> 'admin') ORDER BY role, name`,
    [me.restaurantId, me.role === 'admin'])
  return rows.map(present)
})

// Gerente cria garçom e cozinha; só o administrador cria gerentes.
route('POST', '/users', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  const { name, email, password, role } = ctx.body
  const allowed = me.role === 'admin' ? ['waiter', 'kitchen', 'manager'] : ['waiter', 'kitchen']
  if (!allowed.includes(role)) throw new HttpError(422, 'Perfil inválido')
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw new HttpError(422, 'Informe o nome')
  if (!validateEmail(email)) throw new HttpError(422, 'E-mail inválido')
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new HttpError(422, 'A senha precisa ter 10 ou mais caracteres')
  const [u] = await query(
    `INSERT INTO users (restaurant_id, name, email, password_hash, role) VALUES ($1, $2, lower($3), $4, $5)
     RETURNING id, name, email, role, status, last_login_at, created_at`,
    [me.restaurantId, name.trim(), email, hashPassword(password), role])
  await audit(me, 'user.create', 'user', String(u.id), { role })
  ctx.status = 201
  return present(u)
})

// Ativar/desativar, renomear e redefinir senha. Desativar corta o acesso na hora (o usuário é checado no banco a cada chamada).
route('PATCH', '/users/:id', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  const id = Number(ctx.params.id)
  const [target] = await query('SELECT id, role FROM users WHERE id = $1 AND restaurant_id = $2', [id, me.restaurantId])
  if (!target) throw new HttpError(404, 'Usuário não encontrado')
  if (target.role === 'admin' && me.role !== 'admin') throw new HttpError(403, 'Apenas o administrador altera este usuário')
  if (target.role === 'manager' && me.role !== 'admin' && Number(target.id) !== me.id) throw new HttpError(403, 'Apenas o administrador altera gerentes')
  const { name, status, password } = ctx.body
  if (status !== undefined) {
    if (!['active', 'inactive'].includes(status)) throw new HttpError(422, 'Status inválido')
    if (id === me.id && status === 'inactive') throw new HttpError(409, 'Você não pode desativar o próprio acesso')
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) throw new HttpError(422, 'Nome inválido')
  if (password !== undefined && (typeof password !== 'string' || password.length < 10)) throw new HttpError(422, 'A senha precisa ter 10 ou mais caracteres')
  const [u] = await query(
    `UPDATE users SET name = COALESCE($3, name), status = COALESCE($4, status),
            password_hash = COALESCE($5, password_hash), updated_at = now()
      WHERE id = $1 AND restaurant_id = $2 RETURNING id, name, email, role, status, last_login_at, created_at`,
    [id, me.restaurantId, name?.trim() ?? null, status ?? null, password ? hashPassword(password) : null])
  await audit(me, 'user.update', 'user', String(id), { status: status ?? null, passwordReset: Boolean(password) })
  return present(u)
})

// ------------------------------------------------------------------ configurações
route('GET', '/settings', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  const [r] = await query(
    'SELECT name, service_fee_percent, wait_normal_max_min, wait_attention_max_min FROM restaurants WHERE id = $1', [me.restaurantId])
  return { name: r.name, serviceFeePercent: Number(r.service_fee_percent), waitNormalMax: num(r.wait_normal_max_min), waitAttentionMax: num(r.wait_attention_max_min) }
})

// O novo percentual vale para contas abertas daqui em diante (contas em andamento mantêm o percentual com que foram abertas).
route('PUT', '/settings', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  const fee = Number(ctx.body.serviceFeePercent), n = Number(ctx.body.waitNormalMax), a = Number(ctx.body.waitAttentionMax)
  if (!Number.isFinite(fee) || fee < 0 || fee > 20) throw new HttpError(422, 'A taxa de serviço deve ficar entre 0% e 20%')
  if (!Number.isInteger(n) || !Number.isInteger(a) || n < 1 || a <= n || a > 240) throw new HttpError(422, 'Tempos de espera inválidos (atenção deve ser maior que normal)')
  await query(
    `UPDATE restaurants SET service_fee_percent = $2, wait_normal_max_min = $3, wait_attention_max_min = $4, updated_at = now() WHERE id = $1`,
    [me.restaurantId, Math.round(fee * 100) / 100, n, a])
  await audit(me, 'settings.update', 'restaurant', String(me.restaurantId), { fee, n, a })
  return { serviceFeePercent: Math.round(fee * 100) / 100, waitNormalMax: n, waitAttentionMax: a }
})

// ------------------------------------------------------------------ taxa de serviço por garçom (contas encerradas no período)
const isoDate = /^\d{4}-\d{2}-\d{2}$/
route('GET', '/reports/waiters', async (ctx) => {
  const me = await staff(ctx, ROLES.management)
  let { from, to } = ctx.query
  const [today] = await query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`, [TZ])
  from ||= today.d
  to ||= from
  if (!isoDate.test(from) || !isoDate.test(to) || from > to) throw new HttpError(422, 'Período inválido')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new HttpError(422, 'Período máximo de 366 dias')
  const rows = await query(
    `SELECT u.id, u.name,
            count(DISTINCT a.id) AS accounts,
            COALESCE(sum(b.consumed), 0) AS consumed,
            COALESCE(sum(b.fee), 0) AS fee_charged,
            count(*) FILTER (WHERE w.customer_id IS NOT NULL) AS fees_removed,
            COALESCE(sum(round(b.consumed * a.service_fee_percent / 100, 2)) FILTER (WHERE w.customer_id IS NOT NULL), 0) AS fee_waived
       FROM accounts a
       JOIN users u ON u.id = a.waiter_id
       CROSS JOIN LATERAL account_balances(a.id) b
       LEFT JOIN account_fee_waivers w ON w.account_id = a.id AND w.customer_id = b.customer_id
      WHERE a.restaurant_id = $1 AND a.status = 'closed'
        AND a.closed_at >= ($2::date)::timestamp AT TIME ZONE $4
        AND a.closed_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
      GROUP BY u.id, u.name ORDER BY fee_charged DESC, u.name`,
    [me.restaurantId, from, to, TZ])
  const list = rows.map((r) => ({
    id: num(r.id), name: r.name, accounts: num(r.accounts), consumed: num(r.consumed),
    feeCharged: num(r.fee_charged), feesRemoved: num(r.fees_removed), feeWaived: num(r.fee_waived),
  }))
  return {
    from, to, waiters: list,
    totals: list.reduce((t, w) => ({ feeCharged: t.feeCharged + w.feeCharged, feeWaived: t.feeWaived + w.feeWaived, feesRemoved: t.feesRemoved + w.feesRemoved }),
      { feeCharged: 0, feeWaived: 0, feesRemoved: 0 }),
  }
})
