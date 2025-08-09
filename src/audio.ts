export type ThemeKey = 'default' | 'geocities' | 'yahoo' | 'dialup'

export class AudioManager {
  private ctx: AudioContext | null = null
  private sfxGain: GainNode | null = null
  private unlocked = false
  private currentTheme: ThemeKey = 'default'

  private masterVolume = 0.9
  private musicVolume = 0.5
  private sfxVolume = 0.9

  private musicEl: HTMLAudioElement | null = null
  private musicReqId = 0

  constructor() {
    // Load saved volumes
    try {
      const mv = localStorage.getItem('volume.master'); if (mv != null) this.masterVolume = Number(mv)
      const mu = localStorage.getItem('volume.music'); if (mu != null) this.musicVolume = Number(mu)
      const sv = localStorage.getItem('volume.sfx'); if (sv != null) this.sfxVolume = Number(sv)
    } catch {}

    const unlock = () => this.resume()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    window.addEventListener('gamepadconnected', unlock, { once: true })
  }

  private ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.sfxGain = this.ctx.createGain()
      this.sfxGain.connect(this.ctx.destination)
      this.sfxGain.gain.value = this.sfxVolume * this.masterVolume
    }
    return this.ctx!
  }

  getMasterVolume() { return this.masterVolume }
  getMusicVolume() { return this.musicVolume }
  getSfxVolume() { return this.sfxVolume }

  resume() {
    const ctx = this.ensure()
    if (ctx.state !== 'running') ctx.resume()
    this.unlocked = true
    if (!this.musicEl && this.currentTheme) this.startMusic(this.currentTheme)
    if (this.musicEl && this.musicEl.paused) this.musicEl.play().catch(() => {})
    // Re-apply current volume settings to ensure UI and playback match
    this.setMasterVolume(this.masterVolume)
    this.setMusicVolume(this.musicVolume)
    this.setSfxVolume(this.sfxVolume)
  }

  stopMusic() {
    if (this.musicEl) {
      try { this.musicEl.pause() } catch {}
      this.musicEl.oncanplay = null
      this.musicEl.onerror = null
    }
    this.musicEl = null
  }

  pauseMusic() { if (this.musicEl) { try { this.musicEl.pause() } catch {} } }
  resumeMusic() { if (this.musicEl) { try { this.musicEl.play() } catch {} } }

  startMusic(theme: ThemeKey) {
    this.currentTheme = theme
    if (!this.unlocked) return

    // Invalidate any in-flight loads
    const reqId = ++this.musicReqId

    // Stop current element
    this.stopMusic()

    const base = `music/${theme}`
    const tryFormats = [`${base}.mp3`, `${base}.ogg`]

    const el = new Audio()
    el.loop = true
    el.preload = 'auto'
    el.volume = this.musicVolume * this.masterVolume

    let idx = 0
    const tryNext = () => {
      if (reqId !== this.musicReqId) return // stale
      if (idx >= tryFormats.length) return
      el.src = tryFormats[idx++]
      el.oncanplay = () => {
        if (reqId !== this.musicReqId) { try { el.pause() } catch {}; return }
        this.musicEl = el
        el.volume = this.musicVolume * this.masterVolume
        el.play().catch(() => {})
      }
      el.onerror = () => { if (reqId === this.musicReqId) tryNext() }
      el.load()
    }
    tryNext()
  }

  setMasterVolume(v: number) {
    this.masterVolume = clamp01(v)
    try { localStorage.setItem('volume.master', String(this.masterVolume)) } catch {}
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume * this.masterVolume
    if (this.musicEl) this.musicEl.volume = this.musicVolume * this.masterVolume
  }

  setMusicVolume(v: number) {
    this.musicVolume = clamp01(v)
    try { localStorage.setItem('volume.music', String(this.musicVolume)) } catch {}
    if (this.musicEl) this.musicEl.volume = this.musicVolume * this.masterVolume
  }

  setSfxVolume(v: number) {
    this.sfxVolume = clamp01(v)
    try { localStorage.setItem('volume.sfx', String(this.sfxVolume)) } catch {}
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume * this.masterVolume
  }

  private click(freq: number, duration: number, gainLevel: number, type: OscillatorType = 'square') {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = 0
    osc.connect(gain).connect(this.sfxGain!)
    osc.start()
    gain.gain.linearRampToValueAtTime(gainLevel, t0 + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
    osc.stop(t0 + duration + 0.02)
  }

  private noiseBurst(duration: number, gainLevel: number) {
    const ctx = this.ensure()
    const frames = Math.floor(ctx.sampleRate * duration)
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    g.gain.value = gainLevel
    src.connect(g).connect(this.sfxGain!)
    src.start()
    src.stop(ctx.currentTime + duration)
  }

  // Louder, punchier defaults
  playShoot() { this.click(950, 0.045, 0.22, 'square') }
  playPickup() { this.click(1700, 0.06, 0.20, 'triangle'); setTimeout(() => this.click(2000, 0.06, 0.18, 'triangle'), 70) }
  playEnemyDown() { this.noiseBurst(0.03, 0.16); this.click(300, 0.05, 0.24, 'square') }
  playImpact() { this.noiseBurst(0.02, 0.12); this.click(520, 0.035, 0.18, 'square') }
  playLevelUp() { this.click(880, 0.1, 0.16, 'square'); setTimeout(() => this.click(1175, 0.1, 0.16, 'square'), 90); setTimeout(() => this.click(1480, 0.12, 0.16, 'square'), 180) }
  playOuch() {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(700, t0)
    osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.14)
    gain.gain.setValueAtTime(0.4, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
    osc.connect(gain).connect(this.sfxGain!)
    osc.start()
    osc.stop(t0 + 0.18)
  }
  playGameOver() { this.click(392, 0.2, 0.12, 'sawtooth'); setTimeout(() => this.click(466, 0.2, 0.12, 'sawtooth'), 140); setTimeout(() => this.click(523, 0.24, 0.12, 'sawtooth'), 280) }
  playDeathMoan() {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(320, t0)
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.6)
    gain.gain.setValueAtTime(0.6, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65)
    osc.connect(gain).connect(this.sfxGain!)
    osc.start()
    osc.stop(t0 + 0.7)
  }
}

function clamp01(n: number) { return Math.max(0, Math.min(1, n)) }
