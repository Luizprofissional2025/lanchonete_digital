import { useCallback, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, downloadFile } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import { METHODS, brl, isoDay } from '../../utils/format.js'

const S = { staff: true }
const COLORS = ['#F97316', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EAB308']

function range(kind, custom) {
  const t = new Date()
  const d = (n) => { const x = new Date(t); x.setDate(x.getDate() - n); return x }
  if (kind === 'today') return { from: isoDay(t), to: isoDay(t) }
  if (kind === 'week') return { from: isoDay(d(6)), to: isoDay(t) }
  if (kind === 'month') return { from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoDay(t) }
  return custom
}

function previous({ from, to }) {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`)
  const days = Math.round((b - a) / 86400000) + 1
  const pTo = new Date(a); pTo.setDate(pTo.getDate() - 1)
  const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - days + 1)
  return { from: isoDay(pFrom), to: isoDay(pTo) }
}

function group(series, gran) {
  if (gran === 'day') return series.map((d) => ({ ...d, label: d.day.slice(5).split('-').reverse().join('/') }))
  const map = new Map()
  for (const d of series) {
    let key
    if (gran === 'month') key = d.day.slice(0, 7)
    else { const x = new Date(`${d.day}T12:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); key = isoDay(x) }
    const cur = map.get(key) || { label: gran === 'month' ? key.split('-').reverse().join('/') : `sem. ${key.slice(5).split('-').reverse().join('/')}`, billed: 0, received: 0, orders: 0 }
    cur.billed += d.billed; cur.received += d.received; cur.orders += d.orders
    map.set(key, cur)
  }
  return [...map.values()]
}

const delta = (cur, prev) => {
  if (!prev) return cur ? <span className="delta-up">novo</span> : null
  const p = ((cur - prev) / prev) * 100
  return <span className={p >= 0 ? 'delta-up' : 'delta-down'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p).toFixed(0)}% vs período anterior</span>
}

export default function SalesPage({ toast, user }) {
  const [kind, setKind] = useState('today')
  const [custom, setCustom] = useState({ from: isoDay(new Date()), to: isoDay(new Date()) })
  const [gran, setGran] = useState('day')
  const r = useMemo(() => range(kind, custom), [kind, custom])
  const valid = r.from && r.to && r.from <= r.to
  const prevR = useMemo(() => (valid ? previous(r) : null), [r, valid])
  const f = useCallback(async () => {
    if (!valid) return null
    const [cur, prev] = await Promise.all([
      api.get(`/reports/sales?from=${r.from}&to=${r.to}`, S),
      api.get(`/reports/sales?from=${prevR.from}&to=${prevR.to}`, S),
    ])
    return { cur, prev }
  }, [r, prevR, valid])
  const st = usePolling(f, 30000, [r.from, r.to])
  const d = st.data?.cur, p = st.data?.prev

  const csv = () => downloadFile(`/reports/sales?from=${r.from}&to=${r.to}&format=csv`, `vendas-${r.from}_${r.to}.csv`).catch((e) => toast(e.message, 'error'))
  const series = d ? group(d.byDay, gran) : []
  const ind = d?.indicators, pi = p?.indicators
  const cards = ind && [
    ['Faturamento', brl(ind.billed), delta(ind.billed, pi.billed)],
    ['Recebido', brl(ind.received), delta(ind.received, pi.received)],
    ['Pedidos realizados', ind.ordersPlaced, delta(ind.ordersPlaced, pi.ordersPlaced)],
    ['Pedidos cancelados', ind.ordersCancelled],
    ['Contas fechadas', ind.accountsClosed],
    ['Ticket médio', brl(ind.averageTicket), delta(ind.averageTicket, pi.averageTicket)],
    ['Produtos vendidos', ind.productsSold],
    ['Mesas atendidas', ind.tablesServed],
    ['Pagamentos pendentes', brl(ind.pendingPayments)],
  ]

  return (
    <>
      <div className="toolbar">
        <div className="tabs" style={{ margin: 0 }}>
          {[['today', 'Hoje'], ['week', 'Semana'], ['month', 'Mês'], ['custom', 'Personalizado']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {kind === 'custom' && (
          <>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="De" />
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Até" />
          </>
        )}
        <select value={gran} onChange={(e) => setGran(e.target.value)} aria-label="Agrupar por">
          <option value="day">Por dia</option><option value="week">Por semana</option><option value="month">Por mês</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={csv} disabled={!valid}>Exportar CSV</button>
      </div>
      {!valid && <p className="empty">Período inválido.</p>}
      {valid && !d && <p className="empty">{st.error ? st.error.message : 'Carregando…'}</p>}
      {d && (
        <>
          <p className="muted small">Período {r.from} a {r.to} · comparação com {prevR.from} a {prevR.to}. Dados reais do banco.</p>
          <div className="stats-grid">
            {cards.map(([t, v, dl]) => <div className="stat-card" key={t}><h4>{t}</h4><div className="value">{v}</div><div className="stat-sub">{dl}</div></div>)}
          </div>
          <div className="chart-grid">
            <div className="panel"><h3>Faturamento e recebimentos</h3>
              {series.length === 0 ? <p className="empty">Sem vendas no período.</p> : (
                <ResponsiveContainer width="100%" height={260}><LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(v) => brl(v)} /><Legend />
                  <Line type="monotone" dataKey="billed" name="Faturado" stroke="#F97316" strokeWidth={2} />
                  <Line type="monotone" dataKey="received" name="Recebido" stroke="#10B981" strokeWidth={2} />
                </LineChart></ResponsiveContainer>)}
            </div>
            <div className="panel"><h3>Vendas por horário</h3>
              {d.byHour.length === 0 ? <p className="empty">Sem dados.</p> : (
                <ResponsiveContainer width="100%" height={260}><BarChart data={d.byHour.map((h) => ({ ...h, label: `${h.hour}h` }))}>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis /><Tooltip formatter={(v) => brl(v)} />
                  <Bar dataKey="billed" name="Faturado" fill="#3B82F6" />
                </BarChart></ResponsiveContainer>)}
            </div>
            <div className="panel"><h3>Produtos mais vendidos</h3>
              {d.topProducts.length === 0 ? <p className="empty">Sem dados.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(220, d.topProducts.length * 34)}><BarChart data={d.topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" width={130} /><Tooltip />
                  <Bar dataKey="quantity" name="Quantidade" fill="#F97316" />
                </BarChart></ResponsiveContainer>)}
            </div>
            <div className="panel"><h3>Vendas por categoria</h3>
              {d.byCategory.length === 0 ? <p className="empty">Sem dados.</p> : (
                <ResponsiveContainer width="100%" height={260}><PieChart>
                  <Pie data={d.byCategory} dataKey="revenue" nameKey="name" outerRadius={90} label>
                    {d.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie><Tooltip formatter={(v) => brl(v)} /><Legend />
                </PieChart></ResponsiveContainer>)}
            </div>
            <div className="panel"><h3>Formas de pagamento</h3>
              {d.byMethod.length === 0 ? <p className="empty">Nenhum pagamento no período.</p> : (
                <table className="data-table"><tbody>
                  {d.byMethod.map((m) => <tr key={m.method}><td>{METHODS[m.method] || m.method}</td><td>{m.payments} pgto(s)</td><td className="right">{brl(m.amount)}</td></tr>)}
                </tbody></table>)}
            </div>
          </div>
        </>
      )}
      {user?.role === 'admin' && valid && <PurgePanel r={r} toast={toast} onDone={st.reload} />}
    </>
  )
}

// Limpeza de dados de teste: apaga pedidos (e opcionalmente pagamentos) do período selecionado acima.
function PurgePanel({ r, toast, onDone }) {
  const [text, setText] = useState('')
  const [withPayments, setWithPayments] = useState(true)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!window.confirm(`Apagar TODOS os pedidos de ${r.from} a ${r.to}? Isso não pode ser desfeito.`)) return
    setBusy(true)
    try {
      const x = await api.post('/reports/purge-orders', { from: r.from, to: r.to, confirm: text, includePayments: withPayments }, S)
      toast(`Apagados: ${x.orders} pedido(s), ${x.items} item(ns), ${x.payments} pagamento(s)`, 'success')
      setText('')
      onDone()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="panel" style={{ marginTop: 24, borderLeft: '4px solid var(--danger)' }}>
      <h3>🧪 Limpeza de dados de teste</h3>
      <p className="muted small">
        Apaga todos os pedidos criados de <strong>{r.from}</strong> a <strong>{r.to}</strong> (o período escolhido acima:
        Hoje, Semana, Mês ou Personalizado). Não dá para desfazer. Mesas e contas não são removidas.
      </p>
      <label className="consent" style={{ margin: '8px 0' }}>
        <input type="checkbox" checked={withPayments} onChange={(e) => setWithPayments(e.target.checked)} />
        <span>Apagar também os pagamentos confirmados no período</span>
      </label>
      <div className="toolbar">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite APAGAR para confirmar" aria-label="Confirmação" />
        <button className="btn btn-danger" disabled={busy || text !== 'APAGAR'} onClick={run}>
          {busy ? 'Apagando…' : 'Apagar pedidos do período'}
        </button>
      </div>
    </div>
  )
}
