// Aviso sonoro configurável (sem arquivos de áudio). Os navegadores só tocam após um clique do usuário.
const TONES = { suave: 660, padrao: 880, agudo: 1175 }
let ctx

export const soundPrefs = {
  enabled: () => localStorage.getItem('sound') !== 'off',
  tone: () => localStorage.getItem('soundTone') || 'padrao',
  set: (enabled, tone) => {
    localStorage.setItem('sound', enabled ? 'on' : 'off')
    localStorage.setItem('soundTone', tone)
  },
  tones: Object.keys(TONES),
}

export function beep(force = false) {
  if (!force && !soundPrefs.enabled()) return
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = TONES[soundPrefs.tone()] || 880
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)
    osc.start()
    osc.stop(ctx.currentTime + 0.7)
  } catch { /* sem áudio disponível */ }
}
