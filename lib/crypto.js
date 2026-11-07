// Proteção de dados pessoais (LGPD): CPF e telefone são guardados criptografados (AES-256-GCM).
// O CPF é localizado por HMAC-SHA256 com "pepper" (não reversível sem a chave).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

function need(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return v
}

function fieldKey() {
  const key = Buffer.from(need('FIELD_ENCRYPTION_KEY'), 'base64')
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY deve ter 32 bytes em base64')
  return key
}

const b64u = (buf) => Buffer.from(buf).toString('base64url')

export function encryptField(plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', fieldKey(), iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return ['v1', b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join('.')
}

export function decryptField(token) {
  const [v, iv, tag, ct] = String(token).split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Campo criptografado inválido')
  const d = createDecipheriv('aes-256-gcm', fieldKey(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

export function hmacHash(value) {
  return createHmac('sha256', need('HASH_PEPPER')).update(String(value)).digest('hex')
}

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
