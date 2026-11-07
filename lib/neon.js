// Acesso ao Neon Postgres (driver HTTP serverless). Credenciais só por DATABASE_URL.
import { HttpError } from './http.js'

let runner = null

// Permite trocar o executor (testes/dev local) sem mexer nas rotas.
export function setQueryRunner(fn) {
  runner = fn
}

async function neonRunner() {
  const { neon } = await import('@neondatabase/serverless')
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL não configurada')
  const sql = neon(url)
  return (text, params) => (typeof sql.query === 'function' ? sql.query(text, params) : sql(text, params))
}

// Erros de negócio vindos das funções SQL: "HTTP_409:mensagem"
function translate(error) {
  const m = /HTTP_(\d{3}):(.*)/s.exec(error?.message || '')
  if (m) return new HttpError(Number(m[1]), m[2].trim())
  if (error?.code === '23505') return new HttpError(409, 'Registro duplicado')
  if (error?.code === '23503') return new HttpError(409, 'Registro referenciado por outros dados')
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22003') {
    return new HttpError(422, 'Dados inválidos')
  }
  return error
}

export async function query(text, params = []) {
  try {
    runner ||= await neonRunner()
    return await runner(text, params)
  } catch (error) {
    const translated = translate(error)
    if (!(translated instanceof HttpError)) console.error('Database error:', error?.message)
    throw translated
  }
}
