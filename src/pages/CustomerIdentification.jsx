import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { validateFullName, validatePhone } from '../../lib/validation.js'
import { ApiError, api, customerSession } from '../services/api.js'
import { maskPhoneInput } from '../utils/format.js'
import './CustomerIdentification.css'

// Rota: /m/:token — o QR Code contém só o token público da mesa.
function CustomerIdentification() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [table, setTable] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', consent: false })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // já existe sessão válida nesta mesa? vai direto ao cardápio
        if (customerSession.token() && customerSession.qrToken() === token) {
          try {
            await api.get('/session', { session: true })
            if (alive) return navigate('/cardapio', { replace: true })
          } catch { customerSession.clear() }
        }
        const info = await api.get(`/public/table/${encodeURIComponent(token)}`)
        if (alive) setTable(info)
      } catch (e) {
        if (alive) setInvalid(true)
        if (!(e instanceof ApiError)) console.error(e)
      }
    })()
    return () => { alive = false }
  }, [token, navigate])

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }))
    setErrors((e) => ({ ...e, [name]: '' }))
    setServerError('')
  }

  const validate = () => {
    const e = {}
    if (!validateFullName(form.name)) e.name = 'Informe seu nome completo'
    if (!validatePhone(form.phone)) e.phone = 'Informe um celular com DDD (ex.: (21) 99999-9999)'
    if (!form.consent) e.consent = 'Para continuar, aceite o uso dos dados'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const data = await api.post('/customers/identify', {
        token, name: form.name, phone: form.phone, consent: form.consent,
      })
      customerSession.save(data.sessionToken, token)
      navigate('/cardapio')
    } catch (e) {
      setServerError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (invalid) {
    return (
      <div className="customer-identification">
        <div className="identification-card">
          <h1>QR Code inválido</h1>
          <p className="subtitle">Este QR Code não está mais ativo. Peça ajuda a um funcionário.</p>
        </div>
      </div>
    )
  }
  if (!table) return <div className="customer-identification"><div className="identification-card"><p className="subtitle">Carregando…</p></div></div>

  return (
    <div className="customer-identification">
      <div className="identification-card">
        <h1>Bem-vindo!</h1>
        <p className="subtitle">{table.restaurantName} · Mesa {table.tableNumber}</p>

        <form onSubmit={submit} className="identification-form" noValidate>
          <div className="form-group">
            <label htmlFor="name">Nome completo</label>
            <input id="name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="Digite seu nome completo" className={errors.name ? 'error' : ''} maxLength={120} />
            {errors.name && <span className="error-message">{errors.name}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="phone">Celular com WhatsApp</label>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone}
              onChange={(e) => set('phone', maskPhoneInput(e.target.value))}
              placeholder="(21) 99999-9999" className={errors.phone ? 'error' : ''} />
            {errors.phone && <span className="error-message">{errors.phone}</span>}
          </div>

          <div className="privacy-notice">
            <strong>Por que pedimos esses dados?</strong> Para identificar quem fez cada pedido, dividir a conta da mesa
            e enviar o demonstrativo do seu consumo por WhatsApp. Guardamos o celular protegido (criptografado) e só
            funcionários autorizados acessam. Você pode pedir correção ou exclusão ao restaurante.
          </div>

          <label className="consent">
            <input type="checkbox" checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
            <span>Li e aceito o uso dos meus dados para essa finalidade.</span>
          </label>
          {errors.consent && <span className="error-message">{errors.consent}</span>}
          {serverError && <div className="error-message" role="alert">{serverError}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Aguarde…' : 'Continuar'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default CustomerIdentification
