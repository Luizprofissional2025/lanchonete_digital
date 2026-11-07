// Senhas (scrypt) e JWT HS256 usando apenas node:crypto — sem dependências nativas.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { HttpError } from './http.js'

const N = 2 ** 14, R = 8, P = 1

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('A senha deve ter ao menos 8 caracteres')
  const salt = randomBytes(16)
  const dk = scryptSync(password, salt, 32, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(hash, 'base64')
    const dk = scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p })
    return timingSafeEqual(dk, expected)
  } catch {
    return false
  }
}

function secret() {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET ausente ou curto (mínimo 32 caracteres)')
  return s
}

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const sign = (data) => createHmac('sha256', secret()).update(data).digest('base64url')

export function signJwt(payload, ttlSeconds = 8 * 3600) {
  const now = Math.floor(Date.now() / 1000)
  const body = enc({ ...payload, iat: now, exp: now + ttlSeconds })
  const head = enc({ alg: 'HS256', typ: 'JWT' })
  return `${head}.${body}.${sign(`${head}.${body}`)}`
}

export function verifyJwt(token) {
  try {
    const [head, body, sig] = String(token).split('.')
    if (!head || !body || !sig) return null
    if (JSON.parse(Buffer.from(head, 'base64url')).alg !== 'HS256') return null
    const a = Buffer.from(sig), b = Buffer.from(sign(`${head}.${body}`))
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(body, 'base64url'))
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null
  } catch {
    return null
  }
}

export function bearerToken(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

// Valida o token e confere no banco que o usuário continua ativo (desativação vale na hora).
export async function authenticate(req, query, roles = null) {
  const token = bearerToken(req)
  const payload = token ? verifyJwt(token) : null
  if (!payload) throw new HttpError(401, 'Não autenticado')
  const rows = await query(
    'SELECT id, restaurant_id, role, name FROM users WHERE id = $1 AND status = $2',
    [payload.sub, 'active']
  )
  if (rows.length === 0) throw new HttpError(401, 'Não autenticado')
  const user = { id: Number(rows[0].id), restaurantId: Number(rows[0].restaurant_id), role: rows[0].role, name: rows[0].name }
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'Sem permissão')
  return user
}
