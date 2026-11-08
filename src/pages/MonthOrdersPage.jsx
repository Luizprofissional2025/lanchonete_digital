import { useCallback, useMemo, useState } from 'react'
import { api } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import StatusBadge, { orderTone } from '../../components/StatusBadge.jsx'
import { ORDER_STATUS, brl, isoDay } from '../../utils/format.js'

const S = { staff: true }

function range(kind, custom) {
  const t = new Date()
  const d = (n) => { const x = new Date(t); x.setDate(x.getDate() - n); return x }
  if (kind === 'today') return { from: isoDay(t), to: isoDay(t) }
  if (kind === 'week') return { from: isoDay(d(6)), to: isoDay(t) }
  if (kind === 'month') return { from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoDay(t) }
  return custom
}

const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-')
  const wd = new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })
  return `${d}/${m}/${y} · ${wd}`
}
const hour = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

// Gerência: todos os pedidos do período em ordem, agrupados por dia (cada dia recomeça no Pedido 1).
export default function MonthOrdersPage() {
  const [kind, setKind] = useState('month')
  const [custom, setCustom] = useState({ from: isoDay(new Date()), to: isoDay(new Date()) })
  const [newestFirst, setNewestFirst] = useState(false)
  const r = useMemo(() => range(kind, custom), [kind, custom])
  const valid = !!(r.from && r.to && r.from <= r.to)
  const f = useCallback(() => (valid ? api.get(`/orders/history?from=${r.from}&to=${r.to}`, S) : Promise.resolve(null)), [r, valid])
  const st = usePolling(f, 30000, [r.from, r.to])

  const days = useMemo(() => {
    const map = new Map()
    for (const o of st.data || []) {
      if (!map.has(o.day)) map.set(o.day, [])
      map.get(o.day).push(o)
    }
    const list = [...map.entries()].map(([day, orders]) => ({
      day,
      orders: newestFirst ? [...orders].reverse() : orders,
      count: orders.length,
      total: orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0),
    }))
    return newestFirst ? list.reverse() : list
  }, [st.data, newestFirst])

  const all = st.data || []
  const valuable = all.filter((o) => o.status !== 'cancelled')

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
        <span className="spacer" />
        <label className="small"><input type="checkbox" checked={newestFirst} onChange={(e) => setNewestFirst(e.target.checked)} /> Mais recentes primeiro</label>
      </div>
      {!valid && <p className="empty">Período inválido.</p>}
      {valid && !st.data && <p className="empty">{st.error ? st.error.message : 'Carregando…'}</p>}
      {st.data && (
        <>
          <p className="muted small">
            {r.from} a {r.to} · {all.length} pedido(s) · {brl(valuable.reduce((s, o) => s + o.total, 0))} (sem cancelados). Cada dia começa no Pedido 1.
          </p>
          {days.length === 0 && <p className="empty">Nenhum pedido no período.</p>}
          {days.map((g) => (
            <div className="panel table-scroll" key={g.day} style={{ marginBottom: 16 }}>
              <h3>{dayLabel(g.day)} <span className="muted small">— {g.count} pedido(s) · {brl(g.total)}</span></h3>
              <table className="data-table">
                <thead><tr><th>Pedido</th><th>Hora</th><th>Mesa</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {g.orders.map((o) => (
                    <tr key={o.id}>
                      <td><strong>Pedido {o.number}</strong></td>
                      <td>{hour(o.createdAt)}</td>
                      <td>{o.tableNumber}</td>
                      <td>{o.customerName}</td>
                      <td className="small">{o.items}</td>
                      <td>{brl(o.total)}</td>
                      <td><StatusBadge tone={orderTone[o.status]}>{ORDER_STATUS[o.status]}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </>
  )
}
