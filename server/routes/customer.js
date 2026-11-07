// Autenticação do painel + todo o fluxo do cliente na mesa.
import { signJwt, verifyPassword } from '../../lib/auth.js'
import { encryptField, hmacHash, randomToken, sha256 } from '../../lib/crypto.js'
import { HttpError } from '../../lib/http.js'
import { query } from '../../lib/neon.js'
import {
  formatPhoneE164, maskCPF, maskPhone, sanitizeInput, validateCPF, validateEmail, validateFullName,
} from '../../lib/validation.js'
import { clientIp, rateLimit, route } from '../router.js'
import { num, requireSession, sessionToken } from '../common.js'

const CONSENT_VERSION = '2026-11'
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 6)
// hash de uma senha inexistente: gasta o mesmo tempo quando o e-mail não existe
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

// ------------------------------------------------------------------ login do painel
route('POST', '/auth/login', async (ctx) => {
  const { email, password } = ctx.body
  if (!validateEmail(email) || typeof password !== 'string' || !password) {
    throw new HttpError(400, 'E-mail e senha são obrigatórios')
  }
  rateLimit(`login:${clientIp(ctx.req)}`, 20, 60_000)
  rateLimit(`login:${email.toLowerCase()}`, 8, 60_000)

  const rows = await query(
    `SELECT u.id, u.restaurant_id, u.name, u.email, u.password_hash, u.role, u.status,
            r.identifier AS restaurant_code, r.name AS restaurant_name, r.status AS restaurant_status
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id
      WHERE lower(u.email) = lower($1)`,
    [email]
  )
  const u = rows[0]
  const ok = verifyPassword(password, u ? u.password_hash : DUMMY_HASH)
  if (!u || !ok || u.status !== 'active' || u.restaurant_status !== 'active') {
    throw new HttpError(401, 'E-mail ou senha incorretos')
  }
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id])
  const token = signJwt({ sub: Number(u.id), rid: Number(u.restaurant_id), role: u.role })
  return {
    token,
    user: { id: Number(u.id), name: u.name, email: u.email, role: u.role,
            restaurantId: u.restaurant_code, restaurantName: u.restaurant_name },
  }
})

// ------------------------------------------------------------------ QR → mesa
async function tableByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) {
    throw new HttpError(404, 'QR Code inválido ou desativado')
  }
  const rows = await query(
    `SELECT t.id, t.restaurant_id, t.identifier, t.number, r.name AS restaurant_name, r.identifier AS restaurant_code
       FROM tables t JOIN restaurants r ON r.id = t.restaurant_id
      WHERE t.qr_token = $1 AND t.qr_active AND t.active AND r.status = 'active'`,
    [token]
  )
  if (rows.length === 0) throw new HttpError(404, 'QR Code inválido ou desativado')
  return rows[0]
}

route('GET', '/public/table/:token', async (ctx) => {
  const t = await tableByToken(ctx.params.token)
  return { restaurantName: t.restaurant_name, restaurantCode: t.restaurant_code, tableNumber: num(t.number), tableCode: t.identifier }
})

// ------------------------------------------------------------------ identificação (nome + CPF + celular)
route('POST', '/customers/identify', async (ctx) => {
  const { token, name, cpf, phone, consent } = ctx.body
  rateLimit(`identify:${clientIp(ctx.req)}`, 30, 60_000)

  if (consent !== true) throw new HttpError(422, 'É necessário aceitar o aviso de privacidade')
  if (!validateFullName(name)) throw new HttpError(422, 'Informe o nome completo')
  if (typeof cpf !== 'string' || !validateCPF(cpf)) throw new HttpError(422, 'CPF inválido')
  let phoneE164
  try {
    phoneE164 = formatPhoneE164(phone)
  } catch {
    throw new HttpError(422, 'Informe um celular válido com DDD')
  }

  const table = await tableByToken(token)
  const cleanName = sanitizeInput(name)
  const cpfDigits = cpf.replace(/\D/g, '')

  // Cliente existente NÃO tem nome/telefone sobrescritos por quem apenas informa o CPF
  // (evita que terceiros troquem o número que receberá a conta). Correções ficam com o restaurante.
  const [customer] = await query(
    `INSERT INTO customers (restaurant_id, name, cpf_encrypted, cpf_hash, cpf_masked,
                            phone_encrypted, phone_masked, consent_at, consent_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)
     ON CONFLICT (restaurant_id, cpf_hash) DO UPDATE SET updated_at = now()
     RETURNING id, identifier`,
    [table.restaurant_id, cleanName, encryptField(cpfDigits), hmacHash(cpfDigits), maskCPF(cpfDigits),
     encryptField(phoneE164), maskPhone(phoneE164), CONSENT_VERSION]
  )

  const sessionSecret = randomToken(32)
  const [opened] = await query('SELECT open_session($1, $2, $3, $4, $5) AS s', [
    table.restaurant_id, table.id, customer.id, sha256(sessionSecret), SESSION_TTL_HOURS,
  ])
  ctx.status = 201
  return {
    sessionToken: sessionSecret,
    session: {
      id: opened.s.identifier,
      expiresAt: opened.s.expiresAt,
      restaurantName: table.restaurant_name,
      tableNumber: num(table.number),
      customerName: cleanName,
      customerCode: customer.identifier,
    },
  }
})

route('GET', '/session', async (ctx) => {
  const s = await requireSession(ctx.req)
  return {
    id: s.code, expiresAt: s.expiresAt, restaurantName: s.restaurantName, tableNumber: s.tableNumber,
    customerName: s.customerName, customerCode: s.customerCode,
  }
})

// Conta do cliente: garçom responsável, consumo, taxa de serviço (opcional) e total.
route('GET', '/account/mine', async (ctx) => {
  const s = await requireSession(ctx.req)
  const [r] = await query(
    `SELECT a.status, a.service_fee_percent, (SELECT name FROM users WHERE id = a.waiter_id) AS waiter_name,
            COALESCE(b.consumed, 0) AS consumed, COALESCE(b.fee, 0) AS fee, COALESCE(b.paid, 0) AS paid,
            EXISTS (SELECT 1 FROM account_fee_waivers w WHERE w.account_id = a.id AND w.customer_id = $1) AS fee_removed
       FROM accounts a
       LEFT JOIN LATERAL (SELECT * FROM account_balances(a.id) WHERE customer_id = $1) b ON true
      WHERE a.table_id = $2 AND a.status <> 'closed'`,
    [s.customerId, s.tableId])
  const none = { waiterName: null, feePercent: 0, consumed: 0, fee: 0, feeRemoved: false, due: 0, status: 'open' }
  if (!r) return none
  return {
    waiterName: r.waiter_name, feePercent: Number(r.service_fee_percent), consumed: num(r.consumed), fee: num(r.fee),
    feeRemoved: r.fee_removed, due: Math.round((num(r.consumed) + num(r.fee)) * 100) / 100, status: r.status,
  }
})

// ------------------------------------------------------------------ cardápio
route('GET', '/menu', async (ctx) => {
  const s = await requireSession(ctx.req)
  const [categories, products, addons] = await Promise.all([
    query(
      `SELECT id, name, description, image_url FROM categories
        WHERE restaurant_id = $1 AND status = 'active' ORDER BY display_order, name`, [s.restaurantId]),
    query(
      `SELECT id, category_id, identifier, name, description, ingredients, price, image_url, available
         FROM products WHERE restaurant_id = $1 AND active ORDER BY name`, [s.restaurantId]),
    query(
      `SELECT a.id, a.product_id, a.name, a.price FROM product_addons a
         JOIN products p ON p.id = a.product_id
        WHERE a.restaurant_id = $1 AND a.active AND p.active ORDER BY a.id`, [s.restaurantId]),
  ])
  const addonsByProduct = new Map()
  for (const a of addons) {
    const list = addonsByProduct.get(Number(a.product_id)) || []
    list.push({ id: Number(a.id), name: a.name, price: num(a.price) })
    addonsByProduct.set(Number(a.product_id), list)
  }
  return {
    session: { id: s.code, restaurantName: s.restaurantName, tableNumber: s.tableNumber, customerName: s.customerName },
    menu: categories.map((c) => ({
      id: Number(c.id), name: c.name, description: c.description, imageUrl: c.image_url,
      products: products.filter((p) => Number(p.category_id) === Number(c.id)).map((p) => ({
        id: p.identifier, name: p.name, description: p.description, ingredients: p.ingredients,
        price: num(p.price), imageUrl: p.image_url, available: p.available,
        addons: addonsByProduct.get(Number(p.id)) || [],
      })),
    })).filter((c) => c.products.length > 0),
  }
})

// ------------------------------------------------------------------ pedidos
route('POST', '/orders', async (ctx) => {
  const s = await requireSession(ctx.req)
  const key = ctx.req.headers['idempotency-key']
  if (typeof key !== 'string' || key.length < 8 || key.length > 80) throw new HttpError(400, 'Idempotency-Key obrigatória')
  const { items, notes } = ctx.body
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new HttpError(422, 'Pedido deve ter de 1 a 30 itens')

  // Só repassa product/quantity/addons/notes: preços NUNCA vêm do cliente.
  const clean = items.map((i) => {
    if (!i || typeof i.product !== 'string') throw new HttpError(422, 'Item inválido')
    return {
      product: i.product,
      quantity: i.quantity,
      addons: Array.isArray(i.addons) ? i.addons.slice(0, 20) : [],
      notes: typeof i.notes === 'string' ? i.notes.slice(0, 300) : null,
    }
  })
  const [row] = await query('SELECT create_order($1, $2, $3, $4::jsonb) AS r', [
    sha256(sessionToken(ctx.req)), key, typeof notes === 'string' ? notes : null, JSON.stringify(clean),
  ])
  ctx.status = row.r.replayed ? 200 : 201
  return row.r
})

route('GET', '/orders/mine', async (ctx) => {
  const s = await requireSession(ctx.req)
  const rows = await query(
    `SELECT order_json(o.id) AS j FROM orders o
      WHERE o.customer_id = $1 AND o.table_id = $2
        AND o.account_id = (SELECT id FROM accounts WHERE table_id = $2 AND status <> 'closed')
      ORDER BY o.created_at DESC`,
    [s.customerId, s.tableId]
  )
  return rows.map((r) => r.j)
})

// ------------------------------------------------------------------ chamar garçom (só para problemas)
route('POST', '/alerts', async (ctx) => {
  await requireSession(ctx.req)
  const [row] = await query('SELECT create_alert($1) AS r', [sha256(sessionToken(ctx.req))])
  ctx.status = row.r.created ? 201 : 200
  return { ...row.r, message: 'Nossa equipe foi notificada. Um funcionário irá verificar sua mesa.' }
})
