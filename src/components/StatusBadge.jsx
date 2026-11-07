export default function StatusBadge({ tone = 'gray', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export const orderTone = { received: 'blue', preparing: 'orange', ready: 'green', delivering: 'green', delivered: 'gray', cancelled: 'red' }
export const tableTone = { free: 'green', occupied: 'orange', order_received: 'blue', preparing: 'orange', awaiting_delivery: 'purple', awaiting_payment: 'red' }
export const alertTone = { pending: 'red', in_progress: 'orange', resolved: 'green' }
export const waitTone = { normal: 'green', attention: 'orange', late: 'red' }
