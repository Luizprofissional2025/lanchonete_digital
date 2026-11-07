import { useCallback, useEffect, useRef, useState } from 'react'

// Atualização periódica compatível com hospedagem serverless (sem WebSocket).
// O banco é a fonte da verdade: ao reconectar/voltar à aba, a tela se recupera sozinha.
export function usePolling(fn, ms = 5000, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    try {
      const data = await fnRef.current()
      setState({ data, error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }))
    }
  }, [])

  useEffect(() => {
    reload()
    const tick = () => { if (!document.hidden) reload() }
    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, reload, ...deps])

  return { ...state, reload }
}
