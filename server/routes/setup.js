// Configuração inicial: cria o PRIMEIRO administrador direto pelo site publicado (sem rodar nada no computador).
// Só funciona enquanto não existir nenhum usuário e exige a chave SETUP_TOKEN definida na Vercel.
import { timingSafeEqual } from 'node:crypto'
import { hashPassword } from '../../lib/auth.js'
import { HttpError } from '../../lib/http.js'
import { query } from '../../lib/neon.js'
import { validateEmail } from '../../lib/validation.js'
import { clientIp, rateLimit, route } from '../router.js'

const setupToken = () => process.env.SETUP_TOKEN || ''
const sameToken = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

// A tela só precisa saber se a configuração inicial está disponível.
route('GET', '/setup/status', async () => {
  const [r] = await query(
    `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM restaurants) AS restaurants`)
  return {
    needed: Number(r.users) === 0 && setupToken().length >= 16,
    hasRestaurant: Number(r.restaurants) > 0,
  }
})

route('POST', '/setup/admin', async (ctx) => {
  rateLimit(`setup:${clientIp(ctx.req)}`, 10, 60_000)
  const { token, name, email, password } = ctx.body
  if (setupToken().length < 16) throw new HttpError(403, 'Configuração inicial desativada: defina SETUP_TOKEN (16+ caracteres) na Vercel')
  if (!sameToken(token ?? '', setupToken())) throw new HttpError(403, 'Chave de configuração incorreta')
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 120) throw new HttpError(422, 'Informe o nome')
  if (!validateEmail(email)) throw new HttpError(422, 'E-mail inválido')
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new HttpError(422, 'A senha precisa ter 10 ou mais caracteres')

  // Atômico: só insere se ainda não houver nenhum usuário. Fica no primeiro restaurante cadastrado.
  const rows = await query(
    `INSERT INTO users (restaurant_id, name, email, password_hash, role)
     SELECT r.id, $1, lower($2), $3, 'admin' FROM restaurants r
      WHERE NOT EXISTS (SELECT 1 FROM users) ORDER BY r.id LIMIT 1
     RETURNING id`,
    [name.trim(), email, hashPassword(password)]
  )
  if (rows.length === 0) {
    const [r] = await query('SELECT (SELECT count(*) FROM users) AS u, (SELECT count(*) FROM restaurants) AS r')
    if (Number(r.u) > 0) throw new HttpError(403, 'A configuração inicial já foi feita')
    throw new HttpError(409, 'Nenhum restaurante encontrado. Execute o arquivo demo-data.sql no Neon primeiro')
  }
  ctx.status = 201
  return { created: true }
})
