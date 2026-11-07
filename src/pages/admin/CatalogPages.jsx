import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../../services/api.js'
import { usePolling } from '../../hooks/usePolling.js'
import Modal from '../../components/Modal.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { brl, dateTime } from '../../utils/format.js'

const S = { staff: true }
const errMsg = (e) => e?.message || 'Erro inesperado'

// ---------------------------------------------------------------- cardápio
export function MenuAdminPage({ toast }) {
  const [tab, setTab] = useState('products')
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [editing, setEditing] = useState(null)   // produto | {} (novo)
  const [editingCat, setEditingCat] = useState(null)
  const cats = usePolling(useCallback(() => api.get('/categories', S), []), 30000)
  const prods = usePolling(useCallback(() => api.get(`/products?q=${encodeURIComponent(q)}${catFilter ? `&categoryId=${catFilter}` : ''}`, S), [q, catFilter]), 30000, [q, catFilter])
  const reload = () => { cats.reload(); prods.reload() }

  const toggle = async (p) => {
    try {
      await api.put(`/products/${p.id}`, { ...p, available: !p.available }, S)
      reload()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const delProduct = async (p) => {
    if (!window.confirm(`Excluir "${p.name}"? Pedidos antigos continuam no histórico.`)) return
    try { await api.del(`/products/${p.id}`, S); toast('Produto excluído', 'success'); reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  const delCat = async (c) => {
    if (!window.confirm(`Excluir a categoria "${c.name}"?`)) return
    try { await api.del(`/categories/${c.id}`, S); toast('Categoria excluída', 'success'); reload() } catch (e) { toast(errMsg(e), 'error') }
  }

  return (
    <>
      <div className="tabs">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Produtos</button>
        <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Categorias</button>
      </div>

      {tab === 'products' && (
        <>
          <div className="toolbar">
            <input placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Categoria">
              <option value="">Todas as categorias</option>
              {(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setEditing({})}>+ ADICIONAR PRODUTO</button>
          </div>
          <div className="panel table-scroll">
            <table className="data-table">
              <thead><tr><th>Código</th><th>Produto</th><th>Categoria</th><th>Preço</th><th>Disponível</th><th /></tr></thead>
              <tbody>
                {(prods.data || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.name} {p.isDemo && <StatusBadge tone="purple">demo</StatusBadge>}<br /><span className="muted small">{p.addons.length} adicional(is)</span></td>
                    <td>{p.category}</td><td>{brl(p.price)}</td>
                    <td><button className={`btn btn-sm ${p.available ? 'btn-success' : 'btn-ghost'}`} onClick={() => toggle(p)}>{p.available ? 'Sim' : 'Esgotado'}</button></td>
                    <td className="row-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>Editar</button>
                      <button className="btn btn-sm btn-danger" onClick={() => delProduct(p)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {prods.data?.length === 0 && <p className="empty">Nenhum produto.</p>}
          </div>
        </>
      )}

      {tab === 'categories' && (
        <>
          <div className="toolbar"><span className="spacer" /><button className="btn btn-primary" onClick={() => setEditingCat({})}>+ NOVA CATEGORIA</button></div>
          <div className="panel table-scroll">
            <table className="data-table">
              <thead><tr><th>Ordem</th><th>Nome</th><th>Descrição</th><th>Ativa</th><th /></tr></thead>
              <tbody>
                {(cats.data || []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.displayOrder}</td><td>{c.name}</td><td>{c.description || '—'}</td><td>{c.active ? 'Sim' : 'Não'}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditingCat(c)}>Editar</button>
                      <button className="btn btn-sm btn-danger" onClick={() => delCat(c)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && <ProductForm product={editing} cats={cats.data || []} toast={toast} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {editingCat && <CategoryForm cat={editingCat} toast={toast} onClose={() => setEditingCat(null)} onSaved={() => { setEditingCat(null); reload() }} />}
    </>
  )
}

function ProductForm({ product, cats, toast, onClose, onSaved }) {
  const isNew = !product.id
  const [f, setF] = useState({
    name: product.name || '', description: product.description || '', ingredients: product.ingredients || '',
    price: product.price !== undefined ? String(product.price).replace('.', ',') : '', imageUrl: product.imageUrl || '',
    categoryId: product.categoryId || cats[0]?.id || '', available: product.available !== false,
    addons: (product.addons || []).map((a) => ({ name: a.name, price: String(a.price).replace('.', ',') })),
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const setAddon = (i, k, v) => set('addons', f.addons.map((a, j) => (j === i ? { ...a, [k]: v } : a)))

  const submit = async (e) => {
    e.preventDefault()
    const toNum = (v) => Number(String(v).replace(',', '.'))
    const body = {
      ...f, categoryId: Number(f.categoryId), price: toNum(f.price),
      addons: f.addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), price: toNum(a.price || 0) })),
    }
    if (!Number.isFinite(body.price) || body.price < 0) return toast('Preço inválido', 'error')
    setBusy(true)
    try {
      if (isNew) await api.post('/products', body, S)
      else await api.put(`/products/${product.id}`, body, S)
      toast('Produto salvo', 'success')
      onSaved()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'Novo produto' : `Editar ${product.id}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field full">Nome<input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} /></label>
          <label className="field">Preço (R$)<input value={f.price} inputMode="decimal" onChange={(e) => set('price', e.target.value)} required /></label>
          <label className="field">Categoria
            <select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} required>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field full">Descrição<textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="field full">Ingredientes<input value={f.ingredients} onChange={(e) => set('ingredients', e.target.value)} /></label>
          <label className="field full">URL da imagem<input value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => set('available', e.target.checked)} /> Disponível no cardápio</label>
        <h4>Adicionais</h4>
        {f.addons.map((a, i) => (
          <div className="addon-row" key={i}>
            <input placeholder="Nome" value={a.name} onChange={(e) => setAddon(i, 'name', e.target.value)} />
            <input placeholder="Preço" inputMode="decimal" value={a.price} onChange={(e) => setAddon(i, 'price', e.target.value)} />
            <button type="button" className="icon-btn" onClick={() => set('addons', f.addons.filter((_, j) => j !== i))} aria-label="Remover">🗑</button>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('addons', [...f.addons, { name: '', price: '' }])}>+ Adicional</button>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}

function CategoryForm({ cat, toast, onClose, onSaved }) {
  const isNew = !cat.id
  const [f, setF] = useState({ name: cat.name || '', description: cat.description || '', displayOrder: cat.displayOrder ?? 0, active: cat.active !== false })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { ...f, displayOrder: Number(f.displayOrder) || 0 }
      if (isNew) await api.post('/categories', body, S)
      else await api.put(`/categories/${cat.id}`, body, S)
      toast('Categoria salva', 'success')
      onSaved()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={isNew ? 'Nova categoria' : 'Editar categoria'} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Nome<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} /></label>
        <label className="field">Descrição<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="field">Ordem de exibição<input type="number" value={f.displayOrder} onChange={(e) => setF({ ...f, displayOrder: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativa</label>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>Salvar</button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------- QR Codes
// O QR contém apenas a URL com o token público da mesa — nunca CPF, nome ou dados do cliente.
export async function renderQr(table, restaurantLabel) {
  const qr = await QRCode.toDataURL(table.qrUrl, { width: 600, margin: 2, errorCorrectionLevel: 'M' })
  const img = new Image()
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = qr })
  const c = document.createElement('canvas')
  c.width = 640; c.height = 760
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#111'; g.textAlign = 'center'
  g.font = 'bold 40px sans-serif'; g.fillText(`MESA ${String(table.number).padStart(2, '0')}`, 320, 56)
  g.drawImage(img, 20, 80, 600, 600)
  g.font = '24px sans-serif'; g.fillText(restaurantLabel, 320, 720)
  return c.toDataURL('image/png')
}

export function QrPage({ toast, user }) {
  const st = usePolling(useCallback(() => api.get('/tables', S), []), 30000)
  const [images, setImages] = useState({})
  const [newNumber, setNewNumber] = useState('')
  const tables = (st.data || [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const out = {}
      for (const t of tables) out[t.id] = await renderQr(t, user.restaurantName).catch(() => null)
      if (alive) setImages(out)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tables.map((t) => [t.id, t.qrUrl]))])

  const download = (t) => {
    const a = document.createElement('a')
    a.href = images[t.id]; a.download = `qr-mesa-${String(t.number).padStart(2, '0')}.png`; a.click()
  }
  const downloadAll = () => tables.filter((t) => images[t.id]).forEach((t, i) => setTimeout(() => download(t), i * 250))
  const act = async (fn, msg) => { try { await fn(); toast(msg, 'success'); st.reload() } catch (e) { toast(errMsg(e), 'error') } }
  const regenerate = (t) => window.confirm(`Gerar novo QR da mesa ${t.number}? O QR impresso atual deixará de funcionar.`) &&
    act(() => api.post(`/tables/${t.id}/qr/regenerate`, {}, S), 'QR regenerado')
  const addTable = (e) => {
    e.preventDefault()
    act(() => api.post('/tables', { number: Number(newNumber) }, S), 'Mesa criada').then(() => setNewNumber(''))
  }

  return (
    <>
      <div className="toolbar">
        <form onSubmit={addTable} style={{ display: 'flex', gap: 8 }}>
          <input type="number" min="1" placeholder="Nº da nova mesa" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} required />
          <button className="btn btn-sm btn-primary">+ Mesa</button>
        </form>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={downloadAll}>Baixar todos (PNG)</button>
        <button className="btn btn-primary" onClick={() => window.print()}>Imprimir / salvar PDF</button>
      </div>
      <div className="qr-grid qr-print-area">
        {tables.filter((t) => t.active).map((t) => (
          <div key={t.id} className={`qr-card ${t.qrActive ? '' : 'inactive'}`}>
            {images[t.id] ? <img src={images[t.id]} alt={`QR Code da mesa ${t.number}`} /> : <p className="muted">Gerando…</p>}
            <div className="row-actions no-print">
              <button className="btn btn-sm btn-ghost" onClick={() => download(t)} disabled={!images[t.id]}>PNG</button>
              <button className="btn btn-sm btn-ghost" onClick={() => regenerate(t)}>Regenerar</button>
              <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.patch(`/tables/${t.id}`, { qrActive: !t.qrActive }, S), t.qrActive ? 'QR desativado' : 'QR ativado')}>{t.qrActive ? 'Desativar' : 'Ativar'}</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- clientes (sempre mascarados)
export function CustomersPage() {
  const [q, setQ] = useState('')
  const st = usePolling(useCallback(() => api.get(`/customers?q=${encodeURIComponent(q)}`, S), [q]), 30000, [q])
  return (
    <>
      <div className="toolbar"><input placeholder="Buscar por nome ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" /></div>
      <div className="panel table-scroll">
        <table className="data-table">
          <thead><tr><th>Código</th><th>Nome</th><th>Celular</th><th>Visitas</th><th>Pedidos</th><th>Consumo</th><th>Última visita</th></tr></thead>
          <tbody>
            {(st.data || []).map((c) => (
              <tr key={c.id}><td>{c.id}</td><td>{c.name}</td><td>{c.phone}</td><td>{c.visits}</td><td>{c.orders}</td><td>{brl(c.consumed)}</td><td>{dateTime(c.lastVisit)}</td></tr>
            ))}
          </tbody>
        </table>
        {st.data?.length === 0 && <p className="empty">Nenhum cliente.</p>}
        <p className="muted small">O celular é exibido mascarado (LGPD).</p>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- nova mesa (usada na aba Salão)
// Cria a próxima mesa da sequência, gera o QR Code dela e oferece o download na hora.
export function NewTableModal({ user, toast, onClose, onCreated }) {
  const [table, setTable] = useState(null)
  const [image, setImage] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [number, setNumber] = useState('')

  const create = async (e) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const t = await api.post('/tables', number ? { number: Number(number) } : {}, S)
      setTable(t)
      setImage(await renderQr(t, user.restaurantName))
      onCreated?.()
    } catch (err) { setError(errMsg(err)); toast?.(errMsg(err), 'error') } finally { setBusy(false) }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = image; a.download = `qr-mesa-${String(table.number).padStart(2, '0')}.png`; a.click()
  }

  return (
    <Modal title={table ? `Mesa ${table.number} criada` : 'Nova mesa'} onClose={onClose}>
      {!table ? (
        <form onSubmit={create}>
          <p className="muted">Cria uma mesa nova e gera o QR Code para colar nela. Deixe o número em branco para usar o próximo da sequência.</p>
          <label className="field">Número da mesa (opcional)
            <input type="number" min="1" max="9999" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Próximo número" />
          </label>
          {error && <p style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Gerando…' : 'Gerar QR Code'}</button>
          </div>
        </form>
      ) : (
        <div style={{ textAlign: 'center' }}>
          {image ? <img src={image} alt={`QR Code da mesa ${table.number}`} style={{ maxWidth: 280, width: '100%' }} /> : <p className="muted">Gerando imagem…</p>}
          <p className="muted small">Baixe, imprima e cole na mesa {table.number}. O QR leva só o endereço do cardápio dessa mesa.</p>
          <div className="modal-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
            <button className="btn btn-primary" onClick={download} disabled={!image}>Baixar PNG</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
