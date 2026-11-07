// Única função serverless da API (todas as rotas passam por server/router.js).
import { dispatch } from '../server/index.js'

export default function handler(req, res) {
  return dispatch(req, res)
}
