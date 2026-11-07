// Demonstrativo de consumo (texto para WhatsApp). Função pura: mesmos dados alimentam a prévia na tela.
const NBSP = / /g
const brl = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n)).replace(NBSP, ' ')

export { brl }

export function itemLine(item) {
  const extras = (item.addons || []).map((a) => a.name)
  const label = extras.length ? `${item.name} (+ ${extras.join(', ')})` : item.name
  return `${item.quantity}x ${label} — ${brl(item.subtotal)}`
}

export function customerStatement(summary, customer, restaurantName) {
  const first = String(customer.name).split(' ')[0]
  const total = Number(customer.pending) > 0 ? Number(customer.pending) : Number(customer.due)
  const label = Number(customer.pending) > 0 ? 'TOTAL A PAGAR' : 'TOTAL PAGO'
  const fee = customer.feeRemoved ? 'Taxa de serviço: removida' : `Taxa de serviço (${Number(summary.serviceFeePercent)}%): ${brl(customer.fee)}`
  return [
    `Olá, ${first}!`,
    '',
    `Segue o demonstrativo do seu consumo no ${restaurantName}.`,
    '',
    `MESA: ${String(summary.table).padStart(2, '0')}`,
    ...(summary.waiter ? [`ATENDIMENTO: ${summary.waiter.name.split(' ')[0]}`] : []),
    '',
    'CONSUMO:',
    '',
    ...customer.items.map(itemLine),
    '',
    '-----------------------------',
    '',
    `Consumo: ${brl(customer.consumed)}`,
    fee,
    '',
    `${label}: ${brl(total)}`,
    '',
    'Obrigado pela preferência!',
    '',
    `${restaurantName}.`,
  ].join('\n')
}

// Somente para funcionários autorizados: todos os consumos da mesa, sem CPF.
export function tableStatement(summary, restaurantName) {
  const blocks = summary.customers.map((c) =>
    [`${c.name}:`, ...c.items.map(itemLine), `Subtotal: ${brl(c.consumed)}`, c.feeRemoved ? 'Taxa de serviço: removida' : `Taxa de serviço: ${brl(c.fee)}`].join('\n')
  )
  return [
    `${restaurantName} — MESA ${String(summary.table).padStart(2, '0')} (${summary.account})`,
    '',
    blocks.join('\n\n'),
    '',
    '-----------------------------',
    `TOTAL DA MESA: ${brl(summary.totalWithFee)}`,
  ].join('\n')
}
