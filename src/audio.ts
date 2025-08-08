export type ThemeKey = 'default' | 'geocities' | 'yahoo' | 'dialup'

import { ModPlayer } from 'microjazz'

export class AudioManager {
  private ctx: AudioContext | null = null
  private unlocked = false
  private player: any | null = null
  private currentUrl: string | null = null
  private pendingTheme: ThemeKey | null = null
  private sfxGain: GainNode | null = null
  private masterVolume = 0.7
  private musicVolume = 0.7
  private sfxVolume = 0.6
  private musicEl: HTMLAudioElement | null = null

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

  getMasterVolume() { return this.masterVolume }
  getMusicVolume() { return this.musicVolume }
  getSfxVolume() { return this.sfxVolume }

  private ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.sfxGain = this.ctx.createGain()
      this.applySfxGain()
    }
    return this.ctx!
  }

  private applyMusicGain() {
    const vol = Math.max(0, Math.min(1, this.masterVolume * this.musicVolume))
    if (this.musicEl) {
      this.musicEl.volume = vol
      return
    }
    if (!this.player) return
    // Try common volume APIs from different module players
    try { if ((this.player as any).setMasterVolume) (this.player as any).setMasterVolume(vol) } catch {}
    try { if ((this.player as any).setVolume) (this.player as any).setVolume(vol) } catch {}
    try { (this.player as any).volume = vol } catch {}
    try { if ((this.player as any).gainNode && (this.player as any).gainNode.gain) (this.player as any).gainNode.gain.value = vol } catch {}
    try { if ((this.player as any).context && (this.player as any).context.gain && (this.player as any).context.gain.gain) (this.player as any).context.gain.gain.value = vol } catch {}
  }

  private applySfxGain() {
    if (!this.ctx || !this.sfxGain) return
    const vol = Math.max(0, Math.min(1, this.masterVolume * this.sfxVolume))
    this.sfxGain.gain.value = vol
    this.sfxGain.connect(this.ctx.destination)
  }

  setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v))
    try { localStorage.setItem('volume.master', String(this.masterVolume)) } catch {}
    this.applyMusicGain()
    this.applySfxGain()
  }

  setMusicVolume(v: number) {
    this.musicVolume = Math.max(0, Math.min(1, v))
    try { localStorage.setItem('volume.music', String(this.musicVolume)) } catch {}
    this.applyMusicGain()
  }

  setSfxVolume(v: number) {
    this.sfxVolume = Math.max(0, Math.min(1, v))
    try { localStorage.setItem('volume.sfx', String(this.sfxVolume)) } catch {}
    this.applySfxGain()
  }

  resume() {
    const ctx = this.ensure()
    if (ctx.state !== 'running') ctx.resume()
    this.unlocked = true
    if (this.player && (this.player as any).resume) (this.player as any).resume()
    if (this.pendingTheme) {
      const theme = this.pendingTheme
      this.pendingTheme = null
      // Start requested theme now that audio is unlocked
      this.startMusic(theme)
    }
  }

  stopMusic() {
    if (this.player) {
      try { (this.player as any).stop() } catch {}
      this.player = null
    }
    if (this.musicEl) {
      try { this.musicEl.pause() } catch {}
      this.musicEl = null
    }
    this.currentUrl = null
  }

  pauseMusic() {
    if (this.musicEl) { try { this.musicEl.pause() } catch {} ; return }
    if (!this.player) return
    try { (this.player as any).pause() } catch {}
  }

  resumeMusic() {
    if (this.musicEl) { try { this.musicEl.play() } catch {} ; return }
    if (!this.player) return
    try { (this.player as any).play() } catch {}
  }

  async startMusic(theme: ThemeKey) {
    if (!this.unlocked) {
      this.pendingTheme = theme
      return
    }
    this.ensure()
    // Prefer MP3 (or OGG) for reliable volume control; fallback to XM
    const mp3 = this.moduleUrlForTheme(theme, 'mp3')
    const ogg = this.moduleUrlForTheme(theme, 'ogg')
    const xm = this.moduleUrlForTheme(theme, 'xm')

    this.stopMusic()

    // Try HTMLAudioElement first
    const el = new Audio()
    el.loop = true
    el.preload = 'auto'
    el.src = mp3
    el.oncanplay = () => {
      this.musicEl = el
      this.applyMusicGain()
      try { el.play() } catch {}
    }
    el.onerror = () => {
      // Try OGG then XM fallback
      el.onerror = null as any
      el.oncanplay = null as any
      const el2 = new Audio()
      el2.loop = true
      el2.preload = 'auto'
      el2.src = ogg
      el2.oncanplay = () => { this.musicEl = el2; this.applyMusicGain(); try { el2.play() } catch {} }
      el2.onerror = () => { this.startXM(xm) }
      el2.load()
    }
    el.load()
  }

  private async startXM(url: string) {
    const player = new ModPlayer()
    this.player = player
    this.currentUrl = url
    await new Promise<void>((resolve) => {
      ;(player as any).onReady = () => resolve()
      player.load(url)
    })
    try { if ((player as any).setLoop) (player as any).setLoop(true) } catch {}
    try { if ((player as any).setRepeat) (player as any).setRepeat(true) } catch {}
    try { (player as any).loop = true } catch {}
    try { (player as any).onEnded = () => { try { (player as any).play() } catch {} } } catch {}
    this.applyMusicGain()
    try { player.play() } catch {}
  }

  private moduleUrlForTheme(theme: ThemeKey, ext: 'xm' | 'mp3' | 'ogg' = 'xm') {
    const name = theme === 'geocities' ? 'geocities' : theme === 'yahoo' ? 'yahoo' : theme === 'dialup' ? 'dialup' : 'default'
    return `music/${name}.${ext}`
  }

  playShoot() { this.click(950, 0.05, 0.22, 'square') }
  playPickup() { this.click(1700, 0.05, 0.2, 'triangle'); setTimeout(() => this.click(2000, 0.05, 0.18, 'triangle'), 70) }
  playEnemyDown() {
    // Quick pop: short noise burst + click
    const ctx = this.ensure()
    // noise
    const noise = ctx.createBufferSource()
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    noise.buffer = buf
    const g = ctx.createGain()
    g.gain.value = Math.max(0.001, this.masterVolume * this.sfxVolume) * 0.5
    noise.connect(g).connect(this.sfxGain!)
    noise.start()
    noise.stop(ctx.currentTime + 0.03)
    // tiny blip
    this.click(300, 0.04, 0.24, 'square')
  }
  playImpact() {
    // Bright, short pop-lite: tiny noise burst + quick blip
    const ctx = this.ensure()
    // noise
    const noise = ctx.createBufferSource()
    const frames = Math.floor(ctx.sampleRate * 0.018)
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    noise.buffer = buf
    const g = ctx.createGain()
    g.gain.value = Math.max(0.001, this.masterVolume * this.sfxVolume) * 0.4
    noise.connect(g).connect(this.sfxGain!)
    noise.start()
    noise.stop(ctx.currentTime + 0.018)
    // quick blip
    this.click(520, 0.028, 0.16, 'square')
  }
  playLevelUp() {
    this.click(880, 0.1, 0.24, 'square')
    setTimeout(() => this.click(1175, 0.1, 0.24, 'square'), 90)
    setTimeout(() => this.click(1480, 0.12, 0.24, 'square'), 180)
  }
  playOuch() {
    const ctx = this.ensure()
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(700, t0)
    osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.14)
    gain.gain.setValueAtTime(0.22, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
    osc.connect(gain).connect(this.sfxGain!)
    osc.start()
    osc.stop(t0 + 0.18)
  }
  playGameOver() {
    this.click(392, 0.18, 0.22, 'sawtooth')
    setTimeout(() => this.click(466, 0.18, 0.22, 'sawtooth'), 140)
    setTimeout(() => this.click(523, 0.22, 0.22, 'sawtooth'), 280)
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
}
