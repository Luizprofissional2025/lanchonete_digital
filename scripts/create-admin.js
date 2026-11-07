// Cria (ou redefine a senha de) um usuário do painel. A senha vem do ambiente, nunca do código.
//   ADMIN_EMAIL=dono@exemplo.com ADMIN_PASSWORD='senha-forte-aqui' node scripts/create-admin.js [REST-001] [admin]
import { hashPassword } from '../lib/auth.js'
import { query } from '../lib/neon.js'
import { validateEmail } from '../lib/validation.js'

const [restaurant = 'REST-001', role = 'admin'] = process.argv.slice(2)
const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_NAME: name = 'Administrador' } = process.env

if (!validateEmail(email)) throw new Error('Defina ADMIN_EMAIL com um e-mail válido')
if (!password || password.length < 10) throw new Error('Defina ADMIN_PASSWORD com ao menos 10 caracteres')
if (!['admin', 'manager', 'waiter', 'kitchen'].includes(role)) throw new Error('Perfil inválido')
if (process.env.NODE_ENV === 'production' && /^(admin|senha|password|123)/i.test(password)) {
  throw new Error('Senha fraca demais para produção')
}

const rows = await query(
  `INSERT INTO users (restaurant_id, name, email, password_hash, role)
   SELECT id, $2, lower($3), $4, $5 FROM restaurants WHERE identifier = $1
   ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
                                            status = 'active', updated_at = now()
   RETURNING id`,
  [restaurant, name, email, hashPassword(password), role]
)
if (rows.length === 0) throw new Error(`Restaurante ${restaurant} não encontrado`)
console.log(`Usuário ${email.toLowerCase()} (${role}) pronto em ${restaurant}.`)
