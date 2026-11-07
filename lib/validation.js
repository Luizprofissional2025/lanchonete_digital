// Validações compartilhadas entre frontend (UX) e backend (segurança). Sem dependências.

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '')

// Celular brasileiro (WhatsApp): DDD + 9 dígitos começando em 9. Aceita +55 opcional.
export function normalizePhone(phone) {
  let d = onlyDigits(phone)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 11) return null
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11 || ddd > 99 || d[1] === '0') return null
  if (d[2] !== '9' || /^(\d)\1+$/.test(d.slice(2))) return null
  return d
}

export function validatePhone(phone) {
  return normalizePhone(phone) !== null
}

// E.164: +5521999999999
export function formatPhoneE164(phone) {
  const d = normalizePhone(phone)
  if (!d) throw new Error('Celular inválido')
  return `+55${d}`
}

export function maskPhone(e164) {
  const d = onlyDigits(e164)
  return d.length === 13 && d.startsWith('55') ? `(${d.slice(2, 4)}) *****-${d.slice(-4)}` : '(**) *****-****'
}

// Número para o link wa.me: só dígitos, sem '+'.
export function whatsappDigits(e164) {
  return onlyDigits(e164)
}

export function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function sanitizeInput(input) {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : input
}

export function validateFullName(name) {
  const n = sanitizeInput(name)
  return typeof n === 'string' && n.length >= 3 && n.length <= 120 && n.split(' ').length >= 2
}
