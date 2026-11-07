import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../services/api.js'
import '../CustomerIdentification.css'

// Tela de primeiro acesso: cria o administrador usando a chave SETUP_TOKEN configurada na Vercel.
export default function AdminSetup() {
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [f, setF] = useState({ token: '', name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setError('') }

  useEffect(() => { api.get('/setup/status').then(setStatus).catch((e) => setError(e.message)) }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (f.password !== f.confirm) return setError('As senhas não são iguais')
    setLoading(true)
    try {
      await api.post('/setup/admin', { token: f.token, name: f.name, email: f.email, password: f.password })
      navigate('/gerencia', { replace: true })
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return (
    <div className="customer-identification">
      <div className="identification-card">
        <h1>Primeiro acesso</h1>
        {!status && !error && <p className="subtitle">Carregando…</p>}
        {status && !status.needed && (
          <>
            <p className="subtitle">A configuração inicial não está disponível: o administrador já foi criado ou a variável SETUP_TOKEN não foi definida na Vercel.</p>
            <Link to="/gerencia" className="btn btn-primary">Ir para o login</Link>
          </>
        )}
        {status?.needed && !status.hasRestaurant && (
          <p className="error-message" role="alert">Nenhum restaurante no banco. Execute o arquivo demo-data.sql no Neon e recarregue.</p>
        )}
        {status?.needed && status.hasRestaurant && (
          <form onSubmit={submit} className="identification-form">
            <p className="subtitle">Crie o administrador do restaurante.</p>
            <div className="form-group"><label htmlFor="token">Chave de configuração (SETUP_TOKEN)</label>
              <input id="token" type="password" autoComplete="off" value={f.token} onChange={(e) => set('token', e.target.value)} required /></div>
            <div className="form-group"><label htmlFor="name">Seu nome</label>
              <input id="name" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} /></div>
            <div className="form-group"><label htmlFor="email">E-mail</label>
              <input id="email" type="email" autoComplete="username" value={f.email} onChange={(e) => set('email', e.target.value)} required /></div>
            <div className="form-group"><label htmlFor="password">Senha (10+ caracteres)</label>
              <input id="password" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => set('password', e.target.value)} required /></div>
            <div className="form-group"><label htmlFor="confirm">Repita a senha</label>
              <input id="confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} required /></div>
            {error && <div className="error-message" role="alert">{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Criando…' : 'Criar administrador'}</button>
          </form>
        )}
        {(!status || !status.needed) && error && <div className="error-message" role="alert">{error}</div>}
      </div>
    </div>
  )
}
