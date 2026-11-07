import { dispatch } from '../server/index.js'

export default function handler(req, res) {
  return dispatch(req, res)
}
