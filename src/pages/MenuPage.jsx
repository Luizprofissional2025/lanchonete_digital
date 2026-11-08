import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { usePolling } from '../hooks/usePolling.js'
import { ApiError, api, customerSession } from '../services/api.js'
import { ORDER_STATUS, brl, newKey, orderLabel } from '../utils/format.js'
import './MenuPage.css'

const STEPS = ['received', 'preparing', 'ready', 'delivered']

function MenuPage() {
  const navigate = useNavigate()
  const [toasts, toast] = useToast()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [category, setCategory] = useState(null)
  const [cart, setCart] = useState([])
  const [picker, setPicker] = useState(null) // produto em edição no modal
  const [sheet, setSheet] = useState(null) // 'cart' | 'orders'
  const [sending, setSending] = useState(false)
  const [orderNotes, setOrderNotes] = useState('')
  const [waiterModal, setWaiterModal] = useState(false)
  const keyRef = useRef(null)

  const backToQr = useCallback(() => {
    const qr = customerSession.qrToken()
    customerSession.clear()
    if (qr) navigate(`/m/${qr}`, { replace: true })
    else setLoadError('Sua sessão expirou. Escaneie o QR Code da mesa novamente.')
  }, [navigate])

  const handleError = useCallback((e) => {
    if (e instanceof ApiError && e.status === 401) return backToQr()
    toast(e.message, 'error')
  }, [backToQr, toast])

  const loadMenu = useCallback(async () => {
    try {
      const d = await api.get('/menu', { session: true })
      setData(d)
      setCategory((c) => c ?? d.menu[0]?.id ?? null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return backToQr()
      setLoadError(e.message)
    }
  }, [backToQr])

  // carrega agora e recarrega de tempos em tempos: preços/disponibilidade podem mudar
  usePolling(loadMenu, 60000)

  const orders = usePolling(() => api.get('/orders/mine', { session: true }).catch((e) => {
    if (e instanceof ApiError && e.status === 401) backToQr()
    throw e
  }), 8000)

  // garçom responsável e resumo da conta (consumo + taxa de serviço opcional)
  const account = usePolling(() => api.get('/account/mine', { session: true }).catch(() => null), 8000)

  // mudou o carrinho → nova chave de idempotência (uma tentativa repetida usa a mesma)
  useEffect(() => { keyRef.current = null }, [cart, orderNotes])

  const productsById = useMemo(() => {
    const m = new Map()
    data?.menu.forEach((c) => c.products.forEach((p) => m.set(p.id, p)))
    return m
  }, [data])

  const lineTotal = (line) => {
    const p = productsById.get(line.product)
    if (!p) return 0
    const extras = p.addons.filter((a) => line.addons.includes(a.id)).reduce((s, a) => s + a.price, 0)
    return (p.price + extras) * line.quantity
  }
  const cartTotal = cart.reduce((s, l) => s + lineTotal(l), 0)
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0)

  const addLine = (line) => {
    setCart((c) => [...c, { ...line, key: newKey() }])
    setPicker(null)
    toast('Adicionado ao carrinho', 'success')
  }
  const changeQty = (key, delta) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + delta) } : l)).filter((l) => l.quantity > 0))

  const submitOrder = async () => {
    if (cart.length === 0 || sending) return
    setSending(true)
    keyRef.current ||= newKey()
    try {
      const res = await api.post('/orders', {
        notes: orderNotes || undefined,
        items: cart.map((l) => ({ product: l.product, quantity: l.quantity, addons: l.addons, notes: l.notes || undefined })),
      }, { session: true, headers: { 'Idempotency-Key': keyRef.current } })
      setCart([])
      setOrderNotes('')
      keyRef.current = null
      setSheet('orders')
      orders.reload()
      toast(`${orderLabel(res)} enviado para a cozinha! Total ${brl(res.total)}`, 'success')
    } catch (e) {
      handleError(e)
      loadMenu() // o item pode ter ficado indisponível
    } finally {
      setSending(false)
    }
  }

  const callWaiter = async () => {
    try {
      const res = await api.post('/alerts', {}, { session: true })
      setWaiterModal(false)
      toast(res.message, 'success')
    } catch (e) {
      setWaiterModal(false)
      handleError(e)
    }
  }

  if (loadError) return <div className="empty-menu">{loadError}</div>
  if (!data) return <div className="loading">Carregando cardápio…</div>

  const activeOrders = (orders.data || []).filter((o) => !['delivered', 'cancelled'].includes(o.status)).length
  const visible = data.menu.filter((c) => category === null || c.id === category)

  return (
    <div className="menu-page">
      <header className="menu-header">
        <div className="menu-header-content">
          <div className="menu-info">
            <h1>{data.session.restaurantName}</h1>
            <p>Mesa {data.session.tableNumber} • {data.session.customerName}</p>
            <p className={account.data?.waiterName ? 'waiter-line' : 'waiter-line muted'}>
              {account.data?.waiterName ? <>🧑‍🍳 Seu garçom: <strong>{account.data.waiterName}</strong></> : 'Um garçom vai assumir sua mesa em instantes'}
            </p>
          </div>
          <button className="orders-link" onClick={() => setSheet('orders')}>
            Meus pedidos{activeOrders > 0 && <span className="pill">{activeOrders}</span>}
          </button>
        </div>
        <nav className="category-tabs" aria-label="Categorias">
          {data.menu.map((c) => (
            <button key={c.id} className={c.id === category ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.name}</button>
          ))}
        </nav>
      </header>

      <div className="menu-content">
        {visible.length === 0 && <div className="empty-menu">Nenhum produto disponível no momento</div>}
        {visible.map((c) => (
          <section key={c.id} className="category-section">
            <h2 className="category-title">{c.name}</h2>
            {c.description && <p className="category-desc">{c.description}</p>}
            <div className="products-grid">
              {c.products.map((p) => (
                <article key={p.id} className={`product-card ${p.available ? '' : 'unavailable'}`}
                  onClick={() => p.available && setPicker(p)} role="button" tabIndex={p.available ? 0 : -1}
                  onKeyDown={(e) => e.key === 'Enter' && p.available && setPicker(p)}>
                  {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="product-image" loading="lazy" />}
                  <div className="product-info">
                    <h3 className="product-name">{p.name}</h3>
                    {p.description && <p className="product-description">{p.description}</p>}
                    <div className="product-footer">
                      <span className="product-price">{brl(p.price)}</span>
                      {p.available
                        ? <span className="add-button">Adicionar</span>
                        : <span className="soldout">Indisponível</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="floating-actions">
        <div className="floating-actions-content">
          <button className="waiter-button" onClick={() => setWaiterModal(true)}>🔔 Chamar garçom</button>
          <button className="checkout-button" disabled={cartCount === 0} onClick={() => setSheet('cart')}>
            {cartCount === 0 ? 'Carrinho vazio' : `Ver carrinho (${cartCount}) • ${brl(cartTotal)}`}
          </button>
        </div>
      </div>

      {picker && <ProductPicker product={picker} onClose={() => setPicker(null)} onAdd={addLine} />}

      {sheet === 'cart' && (
        <Modal title="Seu pedido" onClose={() => setSheet(null)}>
          {cart.length === 0 ? <p className="muted">Seu carrinho está vazio.</p> : (
            <>
              <ul className="cart-list">
                {cart.map((l) => {
                  const p = productsById.get(l.product)
                  const extras = p?.addons.filter((a) => l.addons.includes(a.id)).map((a) => a.name) || []
                  return (
                    <li key={l.key}>
                      <div className="cart-info">
                        <strong>{p?.name ?? l.product}</strong>
                        {extras.length > 0 && <small>+ {extras.join(', ')}</small>}
                        {l.notes && <small>Obs.: {l.notes}</small>}
                      </div>
                      <div className="qty">
                        <button onClick={() => changeQty(l.key, -1)} aria-label="Diminuir">−</button>
                        <span>{l.quantity}</span>
                        <button onClick={() => changeQty(l.key, 1)} aria-label="Aumentar">+</button>
                      </div>
                      <div className="cart-price">{brl(lineTotal(l))}</div>
                    </li>
                  )
                })}
              </ul>
              <label className="field">Observações do pedido (opcional)
                <textarea rows={2} maxLength={500} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
              </label>
              <div className="cart-total"><span>Total</span><strong>{brl(cartTotal)}</strong></div>
              <p className="muted small">O valor final é confirmado pelo restaurante no momento do pedido.</p>
              <button className="btn btn-primary block" disabled={sending} onClick={submitOrder}>
                {sending ? 'Enviando…' : 'Confirmar pedido'}
              </button>
            </>
          )}
        </Modal>
      )}

      {sheet === 'orders' && (
        <Modal title="Meus pedidos" onClose={() => setSheet(null)}>
          {!orders.data?.length ? <p className="muted">Você ainda não fez pedidos nesta mesa.</p> : (
            <ul className="order-list">
              {orders.data.map((o) => (
                <li key={o.order}>
                  <div className="order-head"><strong>{orderLabel(o)}</strong><span>{brl(o.total)}</span></div>
                  {o.status === 'cancelled'
                    ? <div className="status-cancel">Pedido cancelado</div>
                    : <ol className="steps" aria-label={`Status: ${ORDER_STATUS[o.status]}`}>
                        {STEPS.map((s, i) => (
                          <li key={s} className={i <= Math.max(0, STEPS.indexOf(o.status === 'delivering' ? 'ready' : o.status)) ? 'done' : ''}>{ORDER_STATUS[s]}</li>
                        ))}
                      </ol>}
                  <ul className="order-items">
                    {o.items.map((i, idx) => (
                      <li key={idx}>{i.quantity}x {i.name}{i.addons.length > 0 && ` (+ ${i.addons.map((a) => a.name).join(', ')})`}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {account.data && account.data.consumed > 0 && (
            <div className="account-box">
              <strong>Resumo da sua conta</strong>
              <div className="row"><span>Consumo</span><span>{brl(account.data.consumed)}</span></div>
              <div className="row">
                <span>{account.data.feeRemoved ? 'Taxa de serviço' : `Taxa de serviço (${account.data.feePercent}%)`}</span>
                <span>{account.data.feeRemoved ? 'removida' : brl(account.data.fee)}</span>
              </div>
              <div className="row total"><span>Total</span><span>{brl(account.data.due)}</span></div>
              <p className="muted small">{account.data.feeRemoved
                ? 'A taxa de serviço foi retirada da sua conta pela equipe.'
                : 'A taxa de serviço é opcional. Se preferir não pagá-la, fale com o garçom.'}</p>
            </div>
          )}
          <p className="muted small">A conta é fechada no caixa/garçom. Para pagar, fale com a equipe.</p>
        </Modal>
      )}

      {waiterModal && (
        <Modal title="Chamar garçom" onClose={() => setWaiterModal(false)}>
          <p>Use este botão <strong>somente se estiver com algum problema</strong> e precisar de atendimento na mesa.</p>
          <p className="muted small">Para pedir comida ou bebida, use o cardápio. Para pedir a conta ou pagar, fale com a equipe.</p>
          <div className="modal-actions">
            <button className="btn btn-outline" onClick={() => setWaiterModal(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={callWaiter}>Chamar agora</button>
          </div>
        </Modal>
      )}

      {toasts}
    </div>
  )
}

function ProductPicker({ product, onClose, onAdd }) {
  const [quantity, setQuantity] = useState(1)
  const [addons, setAddons] = useState([])
  const [notes, setNotes] = useState('')
  const total = (product.price + product.addons.filter((a) => addons.includes(a.id)).reduce((s, a) => s + a.price, 0)) * quantity
  const toggle = (id) => setAddons((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <Modal title={product.name} onClose={onClose}>
      {product.imageUrl && <img src={product.imageUrl} alt="" className="picker-image" />}
      {product.description && <p>{product.description}</p>}
      {product.ingredients && <p className="muted small">Ingredientes: {product.ingredients}</p>}
      {product.addons.length > 0 && (
        <fieldset className="addons">
          <legend>Adicionais</legend>
          {product.addons.map((a) => (
            <label key={a.id}>
              <input type="checkbox" checked={addons.includes(a.id)} onChange={() => toggle(a.id)} />
              <span>{a.name}</span><em>+ {brl(a.price)}</em>
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">Observações (opcional)
        <input maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: sem cebola" />
      </label>
      <div className="picker-footer">
        <div className="qty">
          <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Diminuir">−</button>
          <span>{quantity}</span>
          <button onClick={() => setQuantity((q) => Math.min(50, q + 1))} aria-label="Aumentar">+</button>
        </div>
        <button className="btn btn-primary" onClick={() => onAdd({ product: product.id, quantity, addons, notes: notes.trim() })}>
          Adicionar • {brl(total)}
        </button>
      </div>
    </Modal>
  )
}

export default MenuPage
