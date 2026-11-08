import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import Modal from '../../components/Modal.jsx'
import { NewTableModal } from './CatalogPages.jsx'
import { beep } from '../../utils/sound.js'
import StatusBadge, { alertTone, orderTone, tableTone, waitTone } from '../../components/StatusBadge.jsx'
import { ACCOUNT_STATUS, ALERT_STATUS, METHODS, ORDER_STATUS, TABLE_STATUS, WAIT_LEVEL, brl, dateTime, minutes, orderLabel } from '../../utils/format.js'

const S = { staff: true }
const errMsg = (e) => e?.message || 'Erro inesperado'

function useAction(toast, after) {
  const [busy, setBusy] = useState(false)
  const run = async (fn, okMsg) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fn()
      if (okMsg) toast(okMsg, 'success')
      await after?.()
      return r
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return [busy, run]
}

const Loading = ({ state }) =>
  state.loading ? <p className="empty">Carregando…</p> : state.error && !state.data ? <p className="empty">{errMsg(state.error)}</p> : null

// ---------------------------------------------------------------- visão geral
const DEST = { mesas: '/salao/mesas', cozinha: '/cozinha', alertas: '/salao/alertas', contas: '/salao/contas', vendas: '/gerencia/vendas' }
export function Overview({ go }) {
  const f = useCallback(() => api.get('/dashboard/stats', S), [])
  const st = usePolling(f, 6000)
  const d = st.data
  if (!d) return <Loading state={st} />
  const cards = [
    ['Mesas ocupadas', `${d.tables.occupied} / ${d.tables.total}`, 'mesas'],
    ['Mesas livres', d.tables.free, 'mesas'],
    ['Pedidos ativos', d.orders.active, 'cozinha'],
    ['Pedidos atrasados', d.orders.late, 'cozinha', d.orders.late > 0],
    ['Espera média (fila)', minutes(d.orders.avgWaitMinutes), 'cozinha'],
    ['Chamados pendentes', d.alerts.pending, 'alertas', d.alerts.pending > 0],
    ['Em atendimento', d.alerts.inProgress, 'alertas'],
    ['Contas abertas', d.accounts.open, 'contas'],
    ['Faturado hoje', brl(d.revenue.today), 'vendas'],
    ['Recebido hoje', brl(d.revenue.receivedToday), 'vendas'],
  ]
  return (
    <div className="stats-grid">
      {cards.map(([t, v, p, warn]) => (
        <div key={t} className={`stat-card ${warn ? 'alert' : ''}`} style={{ cursor: 'pointer' }} onClick={() => go(DEST[p])}>
          <h4>{t}</h4><div className="value">{v}</div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- mesas
export function TablesPage({ toast, user }) {
  const f = useCallback(() => api.get('/tables', S), [])
  const st = usePolling(f, 5000)
  const [account, setAccount] = useState(null)
  const [newTable, setNewTable] = useState(false)
  if (!st.data) return <Loading state={st} />
  const canManage = ['admin', 'manager'].includes(user.role)
  const tables = st.data.filter((t) => t.active)
  return (
    <>
      {canManage && (
        <div className="toolbar">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => setNewTable(true)}>+ NOVA MESA (gerar QR Code)</button>
        </div>
      )}
      <div className="tables-grid">
        {tables.map((t) => (
          <div key={t.id} className={`table-card ${t.status} ${t.openAlerts ? 'has-alert' : ''}`}
            onClick={() => (t.account ? setAccount(t.account) : toast(`Mesa ${t.number} está livre`))}>
            <h3>Mesa {t.number}</h3>
            <StatusBadge tone={tableTone[t.status]}>{TABLE_STATUS[t.status]}</StatusBadge>
            {t.account ? (
              <div className="small muted" style={{ marginTop: 8 }}>
                {t.activeSessions} cliente(s) · {t.openOrders} pedido(s) em aberto<br />
                Consumo: <strong>{brl(t.currentTotal)}</strong><br />
                {t.waiter ? <>🧑‍🍳 {t.waiter.name.split(' ')[0]}<br /></> : <><strong className="warn-text">Sem garçom</strong><br /></>}
                Ocupada desde {dateTime(t.occupiedSince)}
                {t.openAlerts > 0 && <><br /><strong style={{ color: 'var(--danger)' }}>🔔 Chamado de garçom</strong></>}
              </div>
            ) : <div className="small muted" style={{ marginTop: 8 }}>Sem conta aberta</div>}
          </div>
        ))}
        {tables.length === 0 && <p className="empty">Nenhuma mesa cadastrada.</p>}
      </div>
      {newTable && <NewTableModal user={user} toast={toast} onClose={() => setNewTable(false)} onCreated={st.reload} />}
      {account && <AccountModal id={account} toast={toast} user={user} onClose={() => { setAccount(null); st.reload() }} />}
    </>
  )
}

// ---------------------------------------------------------------- conta (garçom, taxa, fechamento, pagamento, WhatsApp)
const REASONS = ['Cliente pediu', 'Atendimento abaixo do esperado', 'Cortesia da casa', 'Outro']
const accountTone = (s) => (s === 'closed' ? 'green' : s === 'awaiting_payment' ? 'red' : 'blue')

export function AccountModal({ id, toast, user, onClose }) {
  const f = useCallback(() => api.get(`/accounts/${id}`, S), [id])
  const st = usePolling(f, 6000)
  const [busy, run] = useAction(toast, st.reload)
  const [pay, setPay] = useState({})
  const [wa, setWa] = useState(null)
  const [feeAsk, setFeeAsk] = useState(null) // código do cliente ou 'all'
  const [reason, setReason] = useState(REASONS[0])
  const [note, setNote] = useState('')
  const [team, setTeam] = useState([])
  const [askClose, setAskClose] = useState(false)
  const manager = ['admin', 'manager'].includes(user.role)
  const a = st.data
  // clientes ainda "na mesa": não encerrados
  const remaining = (a?.customers || []).filter((c) => !c.checkout)

  useEffect(() => {
    if (!manager) return
    api.get('/users', S)
      .then((list) => setTeam(list.filter((x) => x.status === 'active' && ['waiter', 'manager', 'admin'].includes(x.role))))
      .catch(() => {})
  }, [manager])

  const assume = () => run(() => api.post(`/accounts/${id}/waiter`, manager ? { userId: user.id } : {}, S), 'Você assumiu a mesa')
  const swap = (userId) => run(() => api.post(`/accounts/${id}/waiter`, { userId: Number(userId) }, S), 'Garçom da mesa alterado')
  const close = () => run(async () => { await api.post(`/accounts/${id}/close`, {}, S); setAskClose(false) }, 'Conta fechada para novos pedidos')
  // Fechar conta: com mais de um cliente na mesa, pergunta quem encerra; os outros continuam consumindo.
  // O botão nunca fecha a mesa toda sozinho: com 2+ clientes pergunta quem sai; com 1 encerra só esse cliente
  // (a mesa só é liberada se não restar mais ninguém conectado). Fechar a mesa toda é uma escolha explícita.
  const startClose = () => {
    if (remaining.length > 1) return setAskClose(true)
    if (remaining.length === 1) return checkout(remaining[0])
    return close()
  }
  const reopen = () => {
    if (!window.confirm('Reabrir a conta? Quem ainda não pagou volta a poder pedir; quem já quitou sai da mesa.')) return
    return run(() => api.post(`/accounts/${id}/reopen`, {}, S), 'Conta reaberta: os clientes ainda na mesa podem pedir')
  }
  const checkout = (c) => run(async () => {
    const r = await api.post(`/accounts/${id}/checkout`, { customer: c.customer }, S)
    setAskClose(false)
    if (r.tableReleased) toast('Mesa liberada ✅', 'success')
    else toast(c.pending > 0 ? `${c.name.split(' ')[0]} encerrado: registre o pagamento abaixo` : `${c.name.split(' ')[0]} encerrado. A mesa continua aberta`, 'success')
  })
  const cancelCheckout = (c) => run(() => api.post(`/accounts/${id}/checkout/cancel`, { customer: c.customer }, S), `Encerramento de ${c.name.split(' ')[0]} cancelado`)
  const removeFee = () => {
    const text = reason === 'Outro' ? note.trim() : reason
    return run(async () => {
      await api.post(`/accounts/${id}/fee`, { customer: feeAsk === 'all' ? undefined : feeAsk, remove: true, reason: text }, S)
      setFeeAsk(null); setNote('')
    }, 'Taxa de serviço removida (registrada no histórico)')
  }
  const restoreFee = (c) => run(() => api.post(`/accounts/${id}/fee`, { customer: c, remove: false }, S), 'Taxa de serviço restaurada')
  const payNow = (c) => {
    const p = pay[c.customer] || {}
    const amount = p.amount ?? String(c.pending).replace('.', ',')
    return run(async () => {
      const r = await api.post(`/accounts/${id}/payments`, { customer: c.customer, amount, method: p.method || 'pix' }, S)
      if (r.tableReleased) toast('Todos pagaram: mesa liberada ✅', 'success')
      setPay((x) => ({ ...x, [c.customer]: {} }))
    }, 'Pagamento registrado')
  }
  const prepare = async (customer) => { await run(async () => setWa(await api.post(`/accounts/${id}/whatsapp`, customer ? { customer } : {}, S))) }
  const mark = (status) => run(async () => { await api.patch(`/whatsapp-shares/${wa.shareId}`, { status }, S); setWa({ ...wa, status }) })
  const openWa = async () => { window.open(wa.url, '_blank', 'noopener'); await mark('share_started') }

  const feeForm = (title) => (
    <div className="fee-form" role="group" aria-label={title}>
      <strong>{title}</strong>
      <p className="muted small">O valor sai do total do cliente. A remoção fica registrada com o seu nome e o motivo.</p>
      <div className="pay-form">
        <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
        {reason === 'Outro' && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Descreva o motivo" maxLength={150} aria-label="Descreva o motivo" />}
        <button className="btn btn-sm btn-danger" disabled={busy || (reason === 'Outro' && note.trim().length < 3)} onClick={removeFee}>Confirmar remoção</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setFeeAsk(null)}>Cancelar</button>
      </div>
    </div>
  )

  return (
    <Modal title={a ? `Conta ${a.account} · Mesa ${a.table}` : 'Conta'} onClose={onClose} wide>
      {!a ? <Loading state={st} /> : (
        <>
          <div className="waiter-row">
            <span>Garçom responsável: {a.waiter ? <strong>{a.waiter.name}</strong> : <strong className="warn-text">ninguém ainda</strong>}</span>
            {a.status !== 'closed' && (!a.waiter
              ? <button className="btn btn-sm btn-primary" disabled={busy} onClick={assume}>Assumir esta mesa</button>
              : manager && team.length > 0 && (
                <select value={a.waiter.id} onChange={(e) => swap(e.target.value)} disabled={busy} aria-label="Trocar garçom da mesa">
                  {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              ))}
          </div>
          <div className="totals">
            <span>Status: <StatusBadge tone={accountTone(a.status)}>{ACCOUNT_STATUS[a.status]}</StatusBadge></span>
            <span>Consumo: <strong>{brl(a.total)}</strong></span>
            <span>Taxa de serviço ({a.serviceFeePercent}%): <strong>{brl(a.fee)}</strong></span>
            <span>Total: <strong>{brl(a.totalWithFee)}</strong></span>
            <span>Pago: <strong>{brl(a.paid)}</strong></span>
            <span>Pendente: <strong>{brl(a.totalWithFee - a.paid)}</strong></span>
          </div>
          {a.customers.map((c) => {
            const p = pay[c.customer] || {}
            return (
              <div className="consumer" key={c.customer}>
                <div className="consumer-head">
                  <strong>{c.name} <span className="muted small">{c.phoneMasked}</span>
                    {c.checkout === 'pending' && <> <StatusBadge tone="orange">Encerrando · receber pagamento</StatusBadge></>}
                    {c.checkout === 'done' && <> <StatusBadge tone="green">Atendimento encerrado</StatusBadge></>}
                    {!c.checkout && c.connected && a.status === 'open' && <> <StatusBadge tone="blue">Na mesa</StatusBadge></>}
                  </strong>
                  <span>Total {brl(c.due)} · Pago {brl(c.paid)} · <strong>Pendente {brl(c.pending)}</strong></span>
                </div>
                <ul>
                  {c.items.map((i, k) => (
                    <li key={k}><span>{i.quantity}x {i.name}{i.addons?.length ? ` (+ ${i.addons.map((x) => x.name).join(', ')})` : ''}</span><span>{brl(i.subtotal)}</span></li>
                  ))}
                  <li className="fee-line">
                    <span>{c.feeRemoved
                      ? <><StatusBadge tone="orange">Taxa removida</StatusBadge> <span className="muted small">por {c.feeRemoved.by} · {c.feeRemoved.reason}</span></>
                      : `Taxa de serviço (${a.serviceFeePercent}%)`}</span>
                    <span>{c.feeRemoved ? brl(0) : brl(c.fee)}</span>
                  </li>
                </ul>
                {a.status !== 'closed' && (
                  <div className="pay-form">
                    {c.paid === 0 && (c.feeRemoved
                      ? <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => restoreFee(c.customer)}>Restaurar taxa</button>
                      : feeAsk !== c.customer && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setFeeAsk(c.customer)}>Remover taxa de serviço</button>)}
                    {(a.status === 'awaiting_payment' || c.checkout === 'pending') && c.pending > 0 && (
                      <>
                        <select value={p.method || 'pix'} onChange={(e) => setPay({ ...pay, [c.customer]: { ...p, method: e.target.value } })} aria-label="Meio de pagamento">
                          {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input value={p.amount ?? String(c.pending).replace('.', ',')} inputMode="decimal" style={{ width: 110 }} aria-label="Valor"
                          onChange={(e) => setPay({ ...pay, [c.customer]: { ...p, amount: e.target.value } })} />
                        <button className="btn btn-sm btn-success" disabled={busy} onClick={() => payNow(c)}>Confirmar pagamento</button>
                      </>
                    )}
                    {a.status === 'open' && !c.checkout && (
                      <button className="btn btn-sm btn-primary" disabled={busy || (c.pending > 0 && !a.waiter)} onClick={() => checkout(c)}
                        title={c.pending > 0 && !a.waiter ? 'Defina o garçom responsável' : 'Só este cliente encerra; os outros continuam pedindo'}>
                        Encerrar {c.name.split(' ')[0]}
                      </button>
                    )}
                    {c.pending <= 0 && c.due > 0 && <StatusBadge tone="green">Quitado</StatusBadge>}
                    {c.pending <= 0 && c.due === 0 && <span className="muted small">Sem consumo</span>}
                    {c.checkout === 'pending' && c.paid === 0 && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => cancelCheckout(c)}>Cancelar encerramento</button>}
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => prepare(c.customer)}>📲 WhatsApp</button>
                  </div>
                )}
                {feeAsk === c.customer && feeForm(`Remover a taxa de serviço de ${c.name.split(' ')[0]}?`)}
              </div>
            )
          })}
          {feeAsk === 'all' && feeForm('Remover a taxa de serviço da mesa toda?')}
          {a.status === 'open' && (
            <div className="modal-actions">
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => prepare(null)}>Resumo da mesa</button>
              {a.fee > 0 && feeAsk !== 'all' && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setFeeAsk('all')}>Remover taxa da mesa toda</button>}
              <button className="btn btn-primary" disabled={busy || !a.waiter} onClick={startClose} title={a.waiter ? '' : 'Defina o garçom responsável'}>Fechar conta</button>
            </div>
          )}
          {a.status === 'awaiting_payment' && manager && (
            <div className="panel" style={{ marginTop: 12, borderLeft: '4px solid var(--primary)' }}>
              <p className="muted small">A mesa inteira está em fechamento e ninguém consegue pedir. Reabra para que quem ainda não pagou continue consumindo; quem já quitou sai da mesa.</p>
              <button className="btn btn-primary" disabled={busy} onClick={reopen}>Reabrir conta</button>
            </div>
          )}
          {askClose && a.status === 'open' && (
            <div className="panel" style={{ marginTop: 12, borderLeft: '4px solid var(--primary)' }} role="group" aria-label="Quem vai encerrar o atendimento">
              <h3>Quem vai encerrar o atendimento?</h3>
              <p className="muted small">Há mais de um cliente na mesa. Escolha quem vai pagar e sair: os outros continuam pedindo normalmente.</p>
              <div className="modal-actions" style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                {remaining.map((c) => (
                  <button key={c.customer} className="btn btn-primary" disabled={busy} onClick={() => checkout(c)}>
                    {c.name.split(' ')[0]} · {c.due > 0 ? brl(c.pending) : 'sem consumo'}
                  </button>
                ))}
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={close}>Fechar a mesa toda (todos saem)</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setAskClose(false)}>Voltar</button>
              </div>
            </div>
          )}
          {a.status === 'open' && !a.waiter && <p className="muted small right">Assuma a mesa para poder fechar a conta.</p>}
          {wa && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3>{wa.scope === 'table' ? 'Resumo consolidado da mesa' : `Mensagem para ${wa.customerName} (${wa.phoneMasked})`}</h3>
              <pre className="statement">{wa.message}</pre>
              {wa.scope === 'customer' ? (
                <>
                  <div className="modal-actions">
                    <button className="btn btn-success" disabled={busy} onClick={openWa}>Abrir WhatsApp</button>
                    <button className="btn btn-ghost" disabled={busy || wa.status !== 'share_started'} onClick={() => mark('confirmed_by_staff')}>Confirmar que enviei</button>
                    <button className="btn btn-ghost" disabled={busy || wa.status === 'confirmed_by_staff'} onClick={() => mark('failed')}>Falhou</button>
                  </div>
                  <p className="muted small">Abrir o WhatsApp não significa envio nem pagamento. Status: <strong>{{ prepared: 'preparado', share_started: 'iniciado', confirmed_by_staff: 'envio confirmado por funcionário', failed: 'falhou' }[wa.status]}</strong></p>
                </>
              ) : (
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(wa.message).then(() => toast('Copiado', 'success'))}>Copiar texto</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- pedidos
export function OrdersPage({ toast, user }) {
  const [status, setStatus] = useState('')
  const f = useCallback(() => api.get(`/orders${status ? `?status=${status}` : ''}`, S), [status])
  const st = usePolling(f, 6000, [status])
  const [busy, run] = useAction(toast, st.reload)
  // salão só cuida da entrega; cozinha (e gerência) faz o preparo
  const next = user.role === 'waiter'
    ? { ready: 'delivering', delivering: 'delivered' }
    : { received: 'preparing', preparing: 'ready', ready: 'delivering', delivering: 'delivered' }
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status">
          <option value="">Todos os status</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!st.data ? <Loading state={st} /> : (
        <div className="panel table-scroll">
          <table className="data-table">
            <thead><tr><th>Pedido</th><th>Mesa</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Status</th><th>Espera</th><th /></tr></thead>
            <tbody>
              {st.data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{orderLabel(o)}</strong><br /><span className="muted small">{dateTime(o.createdAt)}</span></td>
                  <td>{o.tableNumber}</td><td>{o.customerName}</td>
                  <td>{o.items.map((i, k) => <div key={k}>{i.quantity}x {i.name}</div>)}</td>
                  <td>{brl(o.total)}</td>
                  <td><StatusBadge tone={orderTone[o.status]}>{ORDER_STATUS[o.status]}</StatusBadge></td>
                  <td>{['delivered', 'cancelled'].includes(o.status) ? '—' : <StatusBadge tone={waitTone[o.waitLevel]}>{minutes(o.waitMinutes)}</StatusBadge>}</td>
                  <td className="row-actions">
                    {next[o.status] && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(async () => {
                      const r = await api.patch(`/orders/${o.id}/status`, { status: next[o.status] }, S)
                      if (r?.waiterAssumed) toast(`Você assumiu a mesa ${o.tableNumber}`, 'success')
                      return r
                    })}>→ {ORDER_STATUS[next[o.status]]}</button>}
                    {['received', 'preparing', 'ready'].includes(o.status) && <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => window.confirm(`Cancelar ${orderLabel(o)}?`) && run(() => api.patch(`/orders/${o.id}/status`, { status: 'cancelled' }, S), 'Pedido cancelado')}>Cancelar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {st.data.length === 0 && <p className="empty">Nenhum pedido.</p>}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- cozinha
export function KitchenPage({ toast }) {
  const f = useCallback(() => api.get('/kitchen/orders', S), [])
  const st = usePolling(f, 4000)
  const [busy, run] = useAction(toast, st.reload)
  const seen = useRef(null)
  useEffect(() => {
    if (!st.data) return
    const ids = st.data.filter((o) => o.status === 'received').map((o) => o.id)
    if (seen.current && ids.some((id) => !seen.current.has(id))) beep()
    seen.current = new Set(ids)
  }, [st.data])
  if (!st.data) return <Loading state={st} />
  const cols = [
    ['received', '🆕 Novos', 'preparing', 'Iniciar preparo'],
    ['preparing', '🔥 Em preparo', 'ready', 'Marcar pronto'],
    ['ready', '✅ Prontos', 'delivering', 'Saiu para entrega'],
  ]
  return (
    <div className="kitchen">
      {cols.map(([status, title, to, label]) => {
        const list = st.data.filter((o) => o.status === status)
        return (
          <div className="kitchen-col" key={status}>
            <h3>{title} <StatusBadge>{list.length}</StatusBadge></h3>
            {list.map((o) => (
              <div key={o.id} className={`kitchen-card ${o.waitLevel}`}>
                <div className="kitchen-head">
                  <span className="kitchen-table">Mesa {o.tableNumber}</span>
                  <span className={`kitchen-wait ${o.waitLevel}`}>{minutes(o.waitMinutes)} · {WAIT_LEVEL[o.waitLevel]}</span>
                </div>
                <div className="kitchen-meta">{orderLabel(o)} · {o.customerName} · {dateTime(o.createdAt)}</div>
                <ul className="kitchen-items">
                  {o.items.map((i, k) => (
                    <li key={k}><strong>{i.quantity}x {i.name}</strong>
                      {i.addons?.length > 0 && <small>+ {i.addons.map((x) => x.name).join(', ')}</small>}
                      {i.notes && <small>Obs.: {i.notes}</small>}
                    </li>
                  ))}
                </ul>
                {o.notes && <div className="kitchen-note">Obs. do pedido: {o.notes}</div>}
                <div className="kitchen-actions">
                  <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/orders/${o.id}/status`, { status: to }, S))}>{label}</button>
                </div>
              </div>
            ))}
            {list.length === 0 && <p className="empty">Nenhum pedido</p>}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- alertas
export function AlertsPage({ toast }) {
  const f = useCallback(() => api.get('/alerts', S), [])
  const st = usePolling(f, 5000)
  const [busy, run] = useAction(toast, st.reload)
  if (!st.data) return <Loading state={st} />
  return (
    <div className="panel table-scroll">
      <table className="data-table">
        <thead><tr><th>Chamado</th><th>Mesa</th><th>Cliente</th><th>Aberto em</th><th>Status</th><th>Atendido por</th><th /></tr></thead>
        <tbody>
          {st.data.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td><td>{a.tableNumber}</td><td>{a.customerName || '—'}</td><td>{dateTime(a.createdAt)}</td>
              <td><StatusBadge tone={alertTone[a.status]}>{ALERT_STATUS[a.status]}</StatusBadge></td>
              <td>{a.attendedBy || '—'}</td>
              <td className="row-actions">
                {a.status === 'pending' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/alerts/${a.id}`, { status: 'in_progress' }, S))}>Atender</button>}
                {a.status !== 'resolved' && <button className="btn btn-sm btn-success" disabled={busy} onClick={() => run(() => api.patch(`/alerts/${a.id}`, { status: 'resolved' }, S), 'Chamado resolvido')}>Resolver</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.data.length === 0 && <p className="empty">Nenhum chamado.</p>}
      <p className="muted small">Resolver um chamado não altera conta, pedidos, pagamentos nem a mesa.</p>
    </div>
  )
}

// ---------------------------------------------------------------- contas
export function AccountsPage({ toast, user }) {
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const f = useCallback(() => api.get(`/accounts${status ? `?status=${status}` : ''}`, S), [status])
  const st = usePolling(f, 8000, [status])
  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por status">
          <option value="">Todas</option>
          {Object.entries(ACCOUNT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {!st.data ? <Loading state={st} /> : (
        <div className="panel table-scroll">
          <table className="data-table">
            <thead><tr><th>Conta</th><th>Mesa</th><th>Garçom</th><th>Clientes</th><th>Total c/ taxa</th><th>Pago</th><th>Pendente</th><th>Status</th><th>Abertura</th><th /></tr></thead>
            <tbody>
              {st.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td><td>{a.tableNumber}</td><td>{a.waiter || '—'}</td><td>{a.customers}</td><td>{brl(a.total)}</td><td>{brl(a.paid)}</td><td>{brl(a.pending)}</td>
                  <td><StatusBadge tone={a.status === 'closed' ? 'green' : a.status === 'awaiting_payment' ? 'red' : 'blue'}>{ACCOUNT_STATUS[a.status]}</StatusBadge></td>
                  <td>{dateTime(a.openedAt)}</td>
                  <td><button className="btn btn-sm btn-ghost" onClick={() => setOpen(a.id)}>Detalhes</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {st.data.length === 0 && <p className="empty">Nenhuma conta.</p>}
        </div>
      )}
      {open && <AccountModal id={open} toast={toast} user={user} onClose={() => { setOpen(null); st.reload() }} />}
    </>
  )
}

// ---------------------------------------------------------------- liberar mesa (gerência)
export function ReleaseTablePage({ toast }) {
  const f = useCallback(() => api.get('/tables', S), [])
  const st = usePolling(f, 5000)
  const [sel, setSel] = useState('')
  const [busy, run] = useAction(toast, st.reload)
  if (!st.data) return <Loading state={st} />
  const busyTables = st.data.filter((t) => t.active && (t.status !== 'free' || t.account || t.activeSessions > 0))
  const t = busyTables.find((x) => String(x.id) === sel)
  const release = async () => {
    if (!t) return
    const warn = t.currentTotal > 0 ? ` Consumo atual: ${brl(t.currentTotal)}; o que não estiver pago ficará sem cobrança.` : ''
    if (!window.confirm(`Liberar a Mesa ${t.number}? A conta será encerrada e os clientes desconectados.${warn}`)) return
    const r = await run(() => api.post(`/tables/${t.id}/release`, {}, S))
    if (r) {
      toast(`Mesa ${r.table} liberada` + (r.pendingBalance > 0 ? ` · saldo não pago: ${brl(r.pendingBalance)}` : ''), 'success')
      setSel('')
    }
  }
  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <h3>🔓 Liberar mesa</h3>
      <p className="muted small">
        Use quando a mesa ficou ocupada por engano, o cliente foi embora ou é um teste. A conta é encerrada, os clientes são
        desconectados, os chamados são resolvidos e a mesa volta a ficar livre. Pedidos que ainda não saíram da cozinha são cancelados.
      </p>
      {busyTables.length === 0 ? <p className="empty">Todas as mesas já estão livres.</p> : (
        <>
          <label className="field">Mesa que deseja liberar
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">Selecione a mesa…</option>
              {busyTables.map((x) => (
                <option key={x.id} value={x.id}>Mesa {x.number} — {TABLE_STATUS[x.status]}{x.currentTotal > 0 ? ` · ${brl(x.currentTotal)}` : ''}</option>
              ))}
            </select>
          </label>
          {t && (
            <div className="small muted" style={{ margin: '4px 0 12px' }}>
              <StatusBadge tone={tableTone[t.status]}>{TABLE_STATUS[t.status]}</StatusBadge><br />
              {t.activeSessions} cliente(s) conectado(s) · {t.openOrders} pedido(s) em aberto<br />
              Consumo: <strong>{brl(t.currentTotal)}</strong> · {t.waiter ? `Garçom: ${t.waiter.name}` : 'Sem garçom'}
              {t.occupiedSince && <><br />Ocupada desde {dateTime(t.occupiedSince)}</>}
            </div>
          )}
          <button className="btn btn-danger" disabled={!t || busy} onClick={release}>{busy ? 'Liberando…' : 'Liberar mesa'}</button>
        </>
      )}
    </div>
  )
}
