// Servidor local da API (desenvolvimento): `npm run api`  →  http://localhost:3001
// O Vite faz proxy de /api para cá (ver vite.config.js).
import { createServer } from 'node:http'
import { dispatch } from './index.js'

const port = Number(process.env.API_PORT || 3001)
createServer((req, res) => dispatch(req, res)).listen(port, () => {
  console.log(`API local em http://localhost:${port}/api`)
})
