// Cliente da API. O frontend só fala com /api — nunca com o banco.
const BASE = '/api'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export const auth = {
  token: () => localStorage.getItem('token'),
  user: () => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  },
  save: (token, user) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
  },
  clear: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  },
}

export const customerSession = {
  token: () => localStorage.getItem('sessionToken'),
  qrToken: () => localStorage.getItem('qrToken'),
  save: (sessionToken, qrToken) => {
    localStorage.setItem('sessionToken', sessionToken)
    localStorage.setItem('qrToken', qrToken)
  },
  clear: () => localStorage.removeItem('sessionToken'),
}

async function raw(method, path, { body, staff, session, headers } = {}) {
  const h = { ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  if (staff && auth.token()) h.Authorization = `Bearer ${auth.token()}`
  if (session && customerSession.token()) h['X-Session-Token'] = customerSession.token()
  try {
    return await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet.', 0)
  }
}

async function request(method, path, opts = {}) {
  const res = await raw(method, path, opts)
  let json = null
  try { json = await res.json() } catch { /* corpo vazio */ }
  if (!res.ok || !json || json.success !== true) {
    if (res.status === 401 && opts.staff) {
      auth.clear()
      window.dispatchEvent(new Event('auth:expired'))
    }
    throw new ApiError(json?.error || 'Erro inesperado. Tente novamente.', res.status)
  }
  return json.data
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body: body ?? {} }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
}

// Baixa um arquivo protegido (ex.: CSV de vendas) usando o token do painel.
export async function downloadFile(path, filename) {
  const res = await raw('GET', path, { staff: true })
  if (!res.ok) throw new ApiError('Não foi possível gerar o arquivo', res.status)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
