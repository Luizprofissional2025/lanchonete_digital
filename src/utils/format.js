export const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function maskPhoneInput(value) {
  const d = String(value).replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export const minutes = (m) => {
  if (m === null || m === undefined) return '—'
  const v = Math.floor(m)
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)}h${String(v % 60).padStart(2, '0')}`
}

export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const ORDER_STATUS = {
  received: 'Recebido', preparing: 'Em preparação', ready: 'Pronto',
  delivering: 'Saiu para entrega', delivered: 'Entregue', cancelled: 'Cancelado',
}
export const TABLE_STATUS = {
  free: 'Livre', occupied: 'Ocupada', order_received: 'Pedido recebido', preparing: 'Em preparação',
  awaiting_delivery: 'Aguardando entrega', awaiting_payment: 'Aguardando pagamento',
}
export const ALERT_STATUS = { pending: 'Pendente', in_progress: 'Em atendimento', resolved: 'Resolvido' }
export const ACCOUNT_STATUS = { open: 'Em aberto', awaiting_payment: 'Aguardando pagamento', closed: 'Paga e encerrada' }
export const METHODS = { cash: 'Dinheiro', pix: 'PIX', debit: 'Cartão de débito', credit: 'Cartão de crédito', other: 'Outros' }
export const WAIT_LEVEL = { normal: 'Normal', attention: 'Atenção', late: 'Atrasado' }

export const newKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)
