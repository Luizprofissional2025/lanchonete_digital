import { authenticate } from '../lib/auth.js'
import { sha256 } from '../lib/crypto.js'
import { HttpError } from '../lib/http.js'
import { query } from '../lib/neon.js'

export const TZ = process.env.APP_TIMEZONE || 'America/Sao_Paulo'

export const ROLES = {
  all: ['admin', 'manager', 'waiter', 'kitchen'],
  floor: ['admin', 'manager', 'waiter'],
  management: ['admin', 'manager'],
  kitchen: ['admin', 'manager', 'kitchen'],
}

export const staff = (ctx, roles = ROLES.all) => authenticate(ctx.req, query, roles)

export const num = (v) => (v === null || v === undefined ? 0 : Number(v))
export const money = (v) => Math.round(num(v) * 100) / 100

// Sessão do cliente: token secreto no header; só o hash fica no banco.
export async function requireSession(req) {
  const token = req.headers['x-session-token']
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 100) {
    throw new HttpError(401, 'Sessão ausente')
  }
  const rows = await query(
    `SELECT s.id, s.identifier, s.restaurant_id, s.table_id, s.customer_id, s.expires_at,
            t.number AS table_number, t.identifier AS table_code, r.name AS restaurant_name,
            r.identifier AS restaurant_code, c.name AS customer_name, c.identifier AS customer_code
       FROM sessions s
       JOIN tables t ON t.id = s.table_id
       JOIN restaurants r ON r.id = s.restaurant_id
       JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = $1 AND s.status = 'active' AND s.expires_at > now()
        AND t.active AND r.status = 'active'`,
    [sha256(token)]
  )
  if (rows.length === 0) throw new HttpError(401, 'Sessão inválida ou expirada')
  const r = rows[0]
  return {
    id: Number(r.id), code: r.identifier, restaurantId: Number(r.restaurant_id), tableId: Number(r.table_id),
    customerId: Number(r.customer_id), tableNumber: Number(r.table_number), tableCode: r.table_code,
    restaurantName: r.restaurant_name, restaurantCode: r.restaurant_code,
    customerName: r.customer_name, customerCode: r.customer_code, expiresAt: r.expires_at,
  }
}

export function sessionToken(req) {
  return String(req.headers['x-session-token'])
}

// normal / attention / late conforme limites do restaurante
export const waitLevel = (minutes, normalMax = 15, attentionMax = 25) =>
  minutes <= normalMax ? 'normal' : minutes <= attentionMax ? 'attention' : 'late'

export async function restaurantSettings(restaurantId) {
  const [r] = await query(
    'SELECT name, identifier, wait_normal_max_min, wait_attention_max_min FROM restaurants WHERE id = $1',
    [restaurantId]
  )
  return { name: r.name, code: r.identifier, normalMax: Number(r.wait_normal_max_min), attentionMax: Number(r.wait_attention_max_min) }
}

export function baseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '')
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${host}`
}

// A URL do QR leva apenas o token público da mesa (nunca CPF, nome ou ids internos).
export const qrUrl = (req, token) => `${baseUrl(req)}/m/${token}`

export function str(v, { min = 0, max = 500, field = 'campo' } = {}) {
  if (typeof v !== 'string') throw new HttpError(422, `${field} inválido`)
  const s = v.trim()
  if (s.length < min || s.length > max) throw new HttpError(422, `${field} deve ter entre ${min} e ${max} caracteres`)
  return s
}

export function optStr(v, max = 1000, field = 'campo') {
  if (v === undefined || v === null || v === '') return null
  return str(v, { max, field })
}

export function price(v, field = 'preço') {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 99999.99) throw new HttpError(422, `${field} inválido`)
  return Math.round(n * 100) / 100
}
