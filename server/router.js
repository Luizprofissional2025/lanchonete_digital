// Roteador único: toda a API roda em UMA função serverless (limite de 12 do plano Hobby da Vercel).
import { HttpError } from '../lib/http.js'

const routes = []

export function route(method, pattern, handler) {
  const keys = []
  const re = new RegExp(
    '^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
  )
  routes.push({ method, re, keys, handler })
}

// --- limitador simples em memória (por instância; proteção básica contra força bruta) ---
const hits = new Map()
export function rateLimit(key, max, windowMs) {
  const now = Date.now()
  const rec = hits.get(key)
  if (!rec || rec.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs })
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
    return
  }
  if (++rec.n > max) throw new HttpError(429, 'Muitas tentativas. Aguarde um instante e tente novamente.')
}

export const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return parseJson(req.body)
    return req.body
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, 'Corpo da requisição muito grande')
    chunks.push(chunk)
  }
  return chunks.length ? parseJson(Buffer.concat(chunks).toString('utf8')) : {}
}

function parseJson(text) {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

function cors(req, res) {
  const allowed = process.env.APP_BASE_URL
  const origin = req.headers.origin
  if (allowed && origin === allowed.replace(/\/$/, '')) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token, Idempotency-Key')
  }
}

function send(res, status, payload, headers = {}) {
  res.statusCode = status
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(payload)
}

export async function dispatch(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  cors(req, res)
  if (req.method === 'OPTIONS') return send(res, 204, '')

  const url = new URL(req.url, 'http://local')
  const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  const json = (status, body) =>
    send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' })

  try {
    let match = null
    let pathExists = false
    for (const r of routes) {
      const m = r.re.exec(path)
      if (!m) continue
      pathExists = true
      if (r.method === req.method) {
        match = { r, m }
        break
      }
    }
    if (!match) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Método não permitido' : 'Rota não encontrada')

    const params = {}
    match.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m[i + 1])))
    const ctx = {
      req,
      params,
      query: Object.fromEntries(url.searchParams),
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {},
      status: 200,
      raw: null,
    }
    const data = await match.r.handler(ctx)
    if (ctx.raw) return send(res, ctx.status, ctx.raw.body, { 'Content-Type': ctx.raw.type, ...ctx.raw.headers })
    return json(ctx.status, { success: true, data, timestamp: new Date().toISOString() })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('API error:', error)
    return json(status, {
      success: false,
      error: status === 500 ? 'Erro interno do servidor' : error.message,
      details: error.details ?? null,
      status,
      timestamp: new Date().toISOString(),
    })
  }
}
