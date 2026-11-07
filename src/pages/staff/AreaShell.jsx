import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, auth } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import { beep, soundPrefs } from '../../utils/sound.js'
import { useToast } from '../../components/Toast.jsx'
import '../admin/Dashboard.css'
import '../CustomerIdentification.css'

export const HOME_BY_ROLE = { waiter: '/salao', kitchen: '/cozinha', manager: '/gerencia', admin: '/gerencia' }

// Cada área (garçom, cozinha, gerente) tem o próprio endereço e a própria entrada.
// A decisão final de acesso é sempre da API (perfil checado no banco a cada chamada); aqui só guiamos a pessoa.
export default function AreaShell({ area }) {
  const [, bump] = useState(0)
  useEffect(() => {
    const h = () => bump((n) => n + 1)
    window.addEventListener('auth:expired', h)
    return () => window.removeEventListener('auth:expired', h)
  }, [])
  const user = auth.user()
  if (!auth.token() || !user) return <AreaLogin area={area} onDone={() => bump((n) => n + 1)} />
  if (!area.roles.includes(user.role)) return <Denied area={area} user={user} onLogout={() => { auth.clear(); bump((n) => n + 1) }} />
  return <Frame area={area} user={user} onLogout={() => { auth.clear(); bump((n) => n + 1) }} />
}

function AreaLogin({ area, onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [first, setFirst] = useState(false)
  useEffect(() => {
    if (area.key !== 'gerencia') return
    api.get('/setup/status').then((s) => setFirst(s.needed && s.hasRestaurant)).catch(() => {})
  }, [area.key])

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await api.post('/auth/login', { email, password })
      auth.save(data.token, data.user)
      onDone()
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return (
    <div className="customer-identification">
      <div className="identification-card">
        <h1>{area.title}</h1>
        <p className="subtitle">{area.subtitle}</p>
        <form onSubmit={submit} className="identification-form">
          <div className="form-group"><label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="form-group"><label htmlFor="password">Senha</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="error-message" role="alert">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
        </form>
        {first && <p className="subtitle" style={{ marginTop: 16 }}>Primeiro acesso? <Link to="/setup">Criar o administrador</Link></p>}
      </div>
    </div>
  )
}

function Denied({ area, user, onLogout }) {
  const navigate = useNavigate()
  return (
    <div className="customer-identification">
      <div className="identification-card">
        <h1>Acesso restrito</h1>
        <p className="subtitle">Esta página é de <strong>{area.title}</strong>. Você entrou como {user.name}, que tem outro perfil.</p>
        <button className="btn btn-primary" onClick={() => navigate(HOME_BY_ROLE[user.role] || '/')}>Ir para a minha área</button>
        <button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={onLogout}>Entrar com outra conta</button>
      </div>
    </div>
  )
}

function Frame({ area, user, onLogout }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [toasts, toast] = useToast()
  const [open, setOpen] = useState(false)
  const [sound, setSound] = useState({ on: soundPrefs.enabled(), tone: soundPrefs.tone() })
  const seen = useRef(null)

  const alertsState = usePolling(() => (area.alerts ? api.get('/alerts/pending', { staff: true }) : Promise.resolve([])), 5000)
  const alerts = alertsState.data || []
  const pendingIds = alerts.filter((a) => a.status === 'pending').map((a) => a.id)
  useEffect(() => {
    if (!area.alerts || !alertsState.data) return
    if (seen.current && pendingIds.some((id) => !seen.current.has(id))) { beep(); toast('🔔 Novo chamado de garçom', 'error') }
    seen.current = new Set(pendingIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertsState.data])

  const seg = pathname.split('/')[2] || ''
  const page = area.nav.find((n) => n.path === seg)
  if (!page) return <Navigate to={`${area.base}/${area.nav[0].path}`} replace />

  const changeSound = (on, tone) => { setSound({ on, tone }); soundPrefs.set(on, tone); if (on) beep(true) }
  const props = { user, toast, alerts, go: (p) => navigate(p) }
  const soundBox = area.sound && (
    <div className="sound-box">
      <label><input type="checkbox" checked={sound.on} onChange={(e) => changeSound(e.target.checked, sound.tone)} /> Som de alerta</label>
      <select value={sound.tone} onChange={(e) => changeSound(sound.on, e.target.value)} aria-label="Tom do alerta">
        {soundPrefs.tones.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  )
  const canSee = (roles) => !roles || roles.includes(user.role)

  return (
    <div className={`admin ${area.bare ? 'bare' : ''}`}>
      {toasts}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-header"><h2>🍽️ {user.restaurantName}</h2><p>{area.title} · {user.name}</p></div>
        <button className="menu-toggle" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
        <nav className="sidebar-nav">
          {area.nav.map((n) => (
            <button key={n.path} className={`sidebar-item ${page.path === n.path ? 'active' : ''}`} onClick={() => { navigate(`${area.base}/${n.path}`); setOpen(false) }}>
              {n.label}{n.badge && pendingIds.length > 0 && <span className="count">{pendingIds.length}</span>}
            </button>
          ))}
          {(area.links || []).filter((l) => canSee(l.roles)).map((l) => (
            <button key={l.to} className="sidebar-item link-out" onClick={() => navigate(l.to)}>{l.label}</button>
          ))}
          {soundBox}
        </nav>
        <div className="sidebar-footer"><button className="btn btn-sm btn-ghost block" onClick={onLogout}>Sair</button></div>
      </aside>
      <main className="admin-main">
        <h1 className="admin-title">{page.label}</h1>
        {area.alerts && pendingIds.length > 0 && page.path !== 'alertas' && (
          <div className="alert-banner" role="alert">🔔 {pendingIds.length} chamado(s) de garçom pendente(s)</div>
        )}
        {area.bare && soundBox && <div className="bare-sound">{soundBox}</div>}
        {page.render(props)}
      </main>
    </div>
  )
}
