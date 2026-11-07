import { useCallback, useState } from 'react'
import { api } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import Modal from '../../components/Modal.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { brl, dateTime, isoDay } from '../../utils/format.js'

const S = { staff: true }
const errMsg = (e) => e?.message || 'Erro inesperado'
const ROLE = { admin: 'Administrador', manager: 'Gerente', waiter: 'Garçom', kitchen: 'Cozinha' }

// ---------------------------------------------------------------- equipe
export function TeamPage({ toast, user }) {
  const st = usePolling(useCallback(() => api.get('/users', S), []), 30000)
  const [form, setForm] = useState(null)   // novo usuário
  const [reset, setReset] = useState(null) // usuário para redefinir senha

  const toggle = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { status: u.status === 'active' ? 'inactive' : 'active' }, S)
      toast(u.status === 'active' ? `${u.name} foi desativado e perdeu o acesso` : `${u.name} foi reativado`, 'success')
      st.reload()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  return (
    <>
      <div className="toolbar">
        <span className="muted">Garçons usam o endereço <strong>/salao</strong>; a cozinha usa <strong>/cozinha</strong>.</span>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setForm({ role: 'waiter' })}>+ CADASTRAR FUNCIONÁRIO</button>
      </div>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Último acesso</th><th /></tr></thead>
          <tbody>
            {(st.data || []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td><td>{ROLE[u.role]}</td>
                <td><StatusBadge tone={u.status === 'active' ? 'green' : 'gray'}>{u.status === 'active' ? 'Ativo' : 'Inativo'}</StatusBadge></td>
                <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'nunca'}</td>
                <td className="row-actions">
                  {u.id !== user.id && <button className="btn btn-sm btn-ghost" onClick={() => toggle(u)}>{u.status === 'active' ? 'Desativar' : 'Reativar'}</button>}
                  <button className="btn btn-sm btn-ghost" onClick={() => setReset(u)}>Nova senha</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {st.data?.length === 0 && <p className="empty">Nenhum funcionário.</p>}
        <p className="muted small">Desativar corta o acesso na hora e mantém o histórico de contas e taxas do funcionário.</p>
      </div>
      {form && <UserForm role={form.role} isAdmin={user.role === 'admin'} toast={toast} onClose={() => setForm(null)} onSaved={() => { setForm(null); st.reload() }} />}
      {reset && <ResetPassword target={reset} toast={toast} onClose={() => setReset(null)} />}
    </>
  )
}

function UserForm({ role: initialRole, isAdmin, toast, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role: initialRole })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await api.post('/users', f, S); toast(`${f.name} cadastrado`, 'success'); onSaved() } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Cadastrar funcionário" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Perfil
          <select value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="waiter">Garçom (salão e caixa)</option>
            <option value="kitchen">Cozinha (um acesso para o tablet da cozinha)</option>
            {isAdmin && <option value="manager">Gerente</option>}
          </select>
        </label>
        <label className="field">Nome<input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} /></label>
        <label className="field">E-mail (usado para entrar)<input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></label>
        <label className="field">Senha provisória (10+ caracteres)<input type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => set('password', e.target.value)} required /></label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Cadastrar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ResetPassword({ target, toast, onClose }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await api.patch(`/users/${target.id}`, { password }, S); toast('Senha alterada', 'success'); onClose() } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={`Nova senha de ${target.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Nova senha (10+ caracteres)<input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- configurações
export function SettingsPage({ toast }) {
  const st = usePolling(useCallback(() => api.get('/settings', S), []), 600000)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const cur = f || (st.data && { fee: String(st.data.serviceFeePercent).replace('.', ','), n: st.data.waitNormalMax, a: st.data.waitAttentionMax })
  if (!cur) return <p className="empty">Carregando…</p>
  const set = (k, v) => setF({ ...cur, [k]: v })
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.put('/settings', { serviceFeePercent: Number(String(cur.fee).replace(',', '.')), waitNormalMax: Number(cur.n), waitAttentionMax: Number(cur.a) }, S)
      toast('Configurações salvas', 'success'); setF(null); st.reload()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <form className="panel" onSubmit={save} style={{ maxWidth: 560 }}>
      <h3>Taxa de serviço</h3>
      <label className="field">Percentual padrão (0 a 20%)<input inputMode="decimal" value={cur.fee} onChange={(e) => set('fee', e.target.value)} required /></label>
      <p className="muted small">Entra no cálculo de cada cliente e aparece separada na conta e no WhatsApp. É opcional para o cliente: o garçom pode removê-la, e cada remoção fica registrada. Contas já abertas mantêm o percentual com que foram abertas. Use 0 para não cobrar.</p>
      <h3 style={{ marginTop: 20 }}>Tempo de espera na cozinha</h3>
      <div className="form-grid">
        <label className="field">Normal até (minutos)<input type="number" min="1" value={cur.n} onChange={(e) => set('n', e.target.value)} required /></label>
        <label className="field">Atenção até (minutos)<input type="number" min="2" value={cur.a} onChange={(e) => set('a', e.target.value)} required /></label>
      </div>
      <p className="muted small">Acima do segundo valor o pedido aparece como atrasado.</p>
      <div className="modal-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  )
}

// ---------------------------------------------------------------- taxa de serviço por garçom
export function WaitersReportPage() {
  const [range, setRange] = useState({ from: isoDay(new Date(Date.now() - 6 * 86400000)), to: isoDay(new Date()) })
  const f = useCallback(() => api.get(`/reports/waiters?from=${range.from}&to=${range.to}`, S), [range])
  const st = usePolling(f, 60000, [range.from, range.to])
  const d = st.data
  return (
    <>
      <div className="toolbar">
        <label>De <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label>Até <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      {!d ? <p className="empty">{st.error ? errMsg(st.error) : 'Carregando…'}</p> : (
        <>
          <div className="stats-grid">
            <div className="stat-card"><h4>Taxa cobrada</h4><div className="value">{brl(d.totals.feeCharged)}</div></div>
            <div className="stat-card"><h4>Taxas removidas</h4><div className="value">{d.totals.feesRemoved}</div><div className="stat-sub">{brl(d.totals.feeWaived)} deixaram de ser cobrados</div></div>
          </div>
          <div className="panel table-scroll">
            <table className="data-table">
              <thead><tr><th>Garçom</th><th>Contas encerradas</th><th>Consumo atendido</th><th>Taxa cobrada</th><th>Taxas removidas</th><th>Valor removido</th></tr></thead>
              <tbody>
                {d.waiters.map((w) => (
                  <tr key={w.id}><td>{w.name}</td><td>{w.accounts}</td><td>{brl(w.consumed)}</td><td><strong>{brl(w.feeCharged)}</strong></td><td>{w.feesRemoved}</td><td>{brl(w.feeWaived)}</td></tr>
                ))}
              </tbody>
            </table>
            {d.waiters.length === 0 && <p className="empty">Nenhuma conta encerrada no período.</p>}
            <p className="muted small">Considera contas encerradas no período, atribuídas ao garçom responsável pela mesa.</p>
          </div>
        </>
      )}
    </>
  )
}
