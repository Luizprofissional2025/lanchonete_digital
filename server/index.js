// Registra todas as rotas e exporta o despachante usado pela Vercel e pelo servidor local.
import './routes/customer.js'
import './routes/staff.js'
import './routes/accounts.js'
import './routes/setup.js'
import './routes/team.js'

export { dispatch } from './router.js'
