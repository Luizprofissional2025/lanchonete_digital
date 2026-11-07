import { useCallback, useState } from 'react'

export function useToast() {
  const [items, setItems] = useState([])
  const push = useCallback((text, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setItems((s) => [...s, { id, text, type }])
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 4500)
  }, [])
  const node = (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((i) => <div key={i.id} className={`toast ${i.type}`}>{i.text}</div>)}
    </div>
  )
  return [node, push]
}
