import * as THREE from 'three'
import { AudioManager } from './audio'
import type { ThemeKey } from './audio'

type Vector2 = { x: number; y: number }

type EnemyType = 'slime' | 'runner' | 'zigzag' | 'tank' | 'shooter' | 'giant'

class InputManager {
  axesLeft: Vector2 = { x: 0, y: 0 }
  axesRight: Vector2 = { x: 0, y: 0 }
  keys: Record<string, boolean> = {}
  mouse: Vector2 = { x: 0, y: 0 }
  mouseDown = false
  private gamepadIndex: number | null = null

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => (this.keys[e.key.toLowerCase()] = true))
    window.addEventListener('keyup', (e) => (this.keys[e.key.toLowerCase()] = false))
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.gamepadIndex = e.gamepad.index
    })
    window.addEventListener('gamepaddisconnected', () => (this.gamepadIndex = null))

    const rect = () => this.canvas.getBoundingClientRect()
    window.addEventListener('mousemove', (e) => {
      const r = rect()
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
      this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1)
    })
    window.addEventListener('mousedown', () => (this.mouseDown = true))
    window.addEventListener('mouseup', () => (this.mouseDown = false))
  }

  updateGamepad() {
    // Try to find a connected gamepad if we don't have one yet
    if (this.gamepadIndex == null) {
      const pads = navigator.getGamepads?.() || []
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) { this.gamepadIndex = i; break }
      }
    }
    if (this.gamepadIndex == null) return
    const gp = navigator.getGamepads()?.[this.gamepadIndex]
    if (!gp) return
    const deadZone = 0.15
    const dz = (v: number) => (Math.abs(v) < deadZone ? 0 : v)
    this.axesLeft.x = dz(gp.axes[0] ?? 0)
    this.axesLeft.y = dz(gp.axes[1] ?? 0)
    this.axesRight.x = dz(gp.axes[2] ?? 0)
    this.axesRight.y = dz(gp.axes[3] ?? 0)
  }

  getActiveGamepad(): Gamepad | null {
    if (this.gamepadIndex != null) {
      const gp = navigator.getGamepads?.()?.[this.gamepadIndex]
      if (gp) return gp
    }
    const pads = navigator.getGamepads?.() || []
    for (let i = 0; i < pads.length; i++) if (pads[i]) return pads[i]!
    return null
  }

  getMoveVector(): Vector2 {
    let x = 0
    let y = 0
    if (this.keys['a'] || this.keys['arrowleft']) x -= 1
    if (this.keys['d'] || this.keys['arrowright']) x += 1
    if (this.keys['w'] || this.keys['arrowup']) y -= 1
    if (this.keys['s'] || this.keys['arrowdown']) y += 1

    const gx = this.axesLeft.x
    const gy = this.axesLeft.y
    if (gx !== 0 || gy !== 0) {
      return { x: gx, y: gy }
    }
    const len = Math.hypot(x, y) || 1
    return { x: x / len, y: y / len }
  }
}

class FloppyPlayer {
  group: THREE.Group
  weaponAnchor: THREE.Object3D
  radius = 0.6
  speed = 7
  maxHp = 5
  hp = 5
  facing = 0
  constructor() {
    this.group = new THREE.Group()

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x66ccff })
    )
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    label.position.set(0, 0.2, 0.11)
    const shutter = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.25, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x333333 })
    )
    shutter.position.set(0, -0.35, 0.1)

    const limbMat = new THREE.MeshBasicMaterial({ color: 0x222222 })
    const mkLimb = (h: number) => new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 8), limbMat)
    const legL = mkLimb(0.8)
    const legR = mkLimb(0.8)
    legL.position.set(-0.35, -1.0, 0)
    legR.position.set(0.35, -1.0, 0)

    // Arms forward
    const armL = mkLimb(0.6)
    const armR = mkLimb(0.6)
    armL.rotation.x = Math.PI / 2
    armR.rotation.x = Math.PI / 2
    armL.position.set(-0.25, 0.1, 0.45)
    armR.position.set(0.25, 0.1, 0.45)

    // Simple weapon block at front center
    this.weaponAnchor = new THREE.Object3D()
    this.weaponAnchor.position.set(0, 0.1, 0.62)
    const weapon = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.2, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x222244 })
    )
    weapon.position.set(0, 0, 0)
    this.weaponAnchor.add(weapon)

    this.group.add(body, label, shutter, legL, legR, armL, armR, this.weaponAnchor)
  }
}

type Projectile = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  alive: boolean
  ttl: number
  damage: number
  pierce: number
  last: THREE.Vector3
}

type Enemy = {
  mesh: THREE.Mesh
  alive: boolean
  speed: number
  hp: number
  type: EnemyType
  timeAlive: number
  face?: THREE.Mesh
  faceTex?: THREE.CanvasTexture
  faceCanvas?: HTMLCanvasElement
  nextFaceUpdate?: number
}

type Pickup = {
  mesh: THREE.Mesh
  kind: 'heal' | 'xp' | 'vacuum'
  alive: boolean
  xpValue?: number
}

type XPOrb = {
  mesh: THREE.Mesh
  value: number
  alive: boolean
}

type Theme = 'default' | 'geocities' | 'yahoo' | 'dialup'

class Game {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  isoPivot: THREE.Group
  raycaster = new THREE.Raycaster()
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  input: InputManager
  player = new FloppyPlayer()
  projectiles: Projectile[] = []
  enemies: Enemy[] = []
  pickups: Pickup[] = []
  xpOrbs: XPOrb[] = []
  spawnTimer = 0
  fireTimer = 0
  fireInterval = 0.5
  multishot = 1
  projectileDamage = 1
  projectilePierce = 0
  burstCount = 1
  burstDelay = 0.05
  sideBullets = false
  modemWaveInterval = 3
  modemWaveTimer = 0
  modemWaveRadius = 3.2
  rocketInterval = 1.8
  rocketTimer = 0
  rocketSpeed = 10
  rocketTurn = 0.2
  rocketDamage = 3
  xpMagnetRadius = 2.0
  modemWaveDamage = 5
  // CRT Beam
  crtBeam?: THREE.Mesh
  crtBeamGlow?: THREE.Mesh
  crtBeamLength = 6
  crtBeamDps = 6
  crtBeamOn = true
  crtBeamOnDuration = 1.2
  crtBeamOffDuration = 0.8
  crtBeamTimer = 0
  // Tape Whirl
  whirlSaws: THREE.Mesh[] = []
  whirlRadius = 2.0
  whirlSpeed = 2.8
  whirlDamage = 16
  // Magic Lasso
  hasLasso = false
  lassoPoints: { p: THREE.Vector3; t: number }[] = []
  lassoMesh?: THREE.Mesh
  lassoLastPoint = new THREE.Vector3()
  lassoPointGap = 0.4
  lassoMaxPoints = 200
  lassoCloseDist = 0.6
  lassoMinLoopPoints = 12
  lassoDamage = 8
  lassoDuration = 5
  lassoFlashThreshold = 1
  lassoLevel = 0
  score = 0
  lastTime = performance.now()
  gameTime = 0
  spawnAccumulator = 0
  hud: HTMLDivElement
  hpBar!: HTMLDivElement
  inventory!: HTMLDivElement
  overlay: HTMLDivElement
  pauseOverlay: HTMLDivElement
  titleOverlay: HTMLDivElement
  showTitle = true
  xpBar: HTMLDivElement
  currentTheme: Theme = 'default'
  themeObstacles: THREE.Object3D[] = []
  themeLocked = false
  themeChosen = false
  // Controller UI state
  uiSelectIndex = 0
  uiNavCooldown = 0
  uiConfirmPrev = false
  uiDpadPrevLeft = false
  uiDpadPrevRight = false
  uiStartPrev = false
  isPaused = false
  pausePrev = false
  audio = new AudioManager()
  groundMesh!: THREE.Mesh
  billboardGeocities!: THREE.Object3D
  billboardYahoo!: THREE.Object3D
  billboardDialup!: THREE.Object3D
  ownedWeapons = new Set<string>()
  ownedUpgrades = new Map<string, number>()
  maxWeapons = 5
  maxUpgrades = 5
  // XP/Level
  xp = 0
  xpToLevel = 5
  level = 1
  isPausedForLevelUp = false
  // Giant spawns
  giantTimer = 0
  giantInterval = 25
  // Shield Wall
  hasShield = false
  shieldMesh?: THREE.Mesh
  shieldLength = 4
  shieldWidth = 1.2
  shieldOn = true
  shieldOnDuration = 1.0
  shieldOffDuration = 1.2
  shieldTimer = 0
  shieldLevel = 0
  // Dot Matrix side bullets level
  sideBulletDamageMultiplier = 1
  invulnTimer = 0
  invulnDuration = 1.0
  xpGainMultiplier = 1.0

  constructor(private root: HTMLElement) {
    const canvas = document.createElement('canvas')
    canvas.id = 'game-canvas'
    this.root.appendChild(canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x0d0f1a, 1)

    this.scene = new THREE.Scene()

    const viewSize = 12
    const aspect = window.innerWidth / window.innerHeight
    this.camera = new THREE.OrthographicCamera(-viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 100)
    this.isoPivot = new THREE.Group()
    this.isoPivot.rotation.order = 'YXZ'
    this.isoPivot.rotation.y = Math.PI / 4
    this.isoPivot.rotation.x = Math.atan(Math.SQRT2)
    this.camera.position.set(0, 20, 0)
    this.camera.lookAt(0, 0, 0)
    this.isoPivot.add(this.camera)
    this.scene.add(this.isoPivot)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)

    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x111522 }))
    this.groundMesh.rotation.x = -Math.PI / 2
    this.scene.add(this.groundMesh)

    const grid = new THREE.GridHelper(200, 200, 0x334455, 0x223344)
    ;(grid.material as THREE.LineBasicMaterial).transparent = true
    ;(grid.material as THREE.LineBasicMaterial).opacity = 0.35
    this.scene.add(grid)

    this.billboardGeocities = this.makeBillboard('GEOCITIES', new THREE.Vector3(-6, 0.01, -6))
    this.billboardYahoo = this.makeBillboard('YAHOO DIR', new THREE.Vector3(8, 0.01, 4))
    this.billboardDialup = this.makeBillboard('DIAL-UP 56K', new THREE.Vector3(-10, 0.01, 10))
    this.scene.add(this.billboardGeocities, this.billboardYahoo, this.billboardDialup)

    this.player.group.position.set(0, 0.6, 0)
    this.scene.add(this.player.group)

    this.hud = document.createElement('div') as HTMLDivElement
    this.hud.id = 'hud'
    this.root.appendChild(this.hud)

    // HP bar
    this.hpBar = document.createElement('div')
    this.hpBar.id = 'hpbar'
    this.hpBar.innerHTML = '<div id="hpfill"></div><div id="hplabel" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); font: 12px ui-monospace, monospace; color:#fff; text-shadow:0 0 6px rgba(0,0,0,0.6)"></div>'
    this.root.appendChild(this.hpBar)

    // Inventory UI
    this.inventory = document.createElement('div') as HTMLDivElement
    this.inventory.id = 'inventory'
    this.inventory.innerHTML = '<div class="slotgroup"><strong>Weapons</strong><div class="slots" id="wslots"></div></div><div class="slotgroup"><strong>Upgrades</strong><div class="slots" id="uslots"></div></div>'
    this.root.appendChild(this.inventory)

    // XP bar UI
    this.xpBar = document.createElement('div') as HTMLDivElement
    this.xpBar.id = 'xpbar'
    this.xpBar.innerHTML = '<div id="xpfill"></div><div id="xplabel" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); font: 12px ui-monospace, monospace; color:#0b0; text-shadow:0 0 6px rgba(0,0,0,0.6)"></div>'
    this.root.appendChild(this.xpBar)

    // Level-up overlay
    this.overlay = document.createElement('div') as HTMLDivElement
    this.overlay.id = 'overlay'
    this.root.appendChild(this.overlay)

    // Pause overlay
    this.pauseOverlay = document.createElement('div') as HTMLDivElement
    this.pauseOverlay.id = 'overlay'
    this.pauseOverlay.style.display = 'none'
    this.pauseOverlay.innerHTML = `
      <div class="card" style="min-width:320px;">
        <strong>Paused</strong>
        <div class="carddesc">Start / P / Esc to resume</div>
        <div style="margin-top:8px; text-align:left; width:100%; display:flex; flex-direction:column; gap:6px;">
          <label style="display:flex; align-items:center; gap:8px;">Master
            <input id="vol-master" type="range" min="0" max="1" step="0.01" value="${this.audio.getMasterVolume().toFixed(2)}" style="flex:1;" />
            <span id="vol-master-val">${this.audio.getMasterVolume().toFixed(2)}</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px;">Music
            <input id="vol-music" type="range" min="0" max="1" step="0.01" value="${this.audio.getMusicVolume().toFixed(2)}" style="flex:1;" />
            <span id="vol-music-val">${this.audio.getMusicVolume().toFixed(2)}</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px;">SFX
            <input id="vol-sfx" type="range" min="0" max="1" step="0.01" value="${this.audio.getSfxVolume().toFixed(2)}" style="flex:1;" />
            <span id="vol-sfx-val">${this.audio.getSfxVolume().toFixed(2)}</span>
          </label>
        </div>
      </div>
      <button class="card selected"><strong>Resume</strong></button>
    `
    this.root.appendChild(this.pauseOverlay)
    const hookSliders = () => {
      const vm = this.pauseOverlay.querySelector('#vol-master') as HTMLInputElement
      const vmu = this.pauseOverlay.querySelector('#vol-music') as HTMLInputElement
      const vs = this.pauseOverlay.querySelector('#vol-sfx') as HTMLInputElement
      const vmVal = this.pauseOverlay.querySelector('#vol-master-val') as HTMLSpanElement
      const vmuVal = this.pauseOverlay.querySelector('#vol-music-val') as HTMLSpanElement
      const vsVal = this.pauseOverlay.querySelector('#vol-sfx-val') as HTMLSpanElement
      const syncVals = () => {
        if (vm && vmVal) vmVal.textContent = Number(vm.value).toFixed(2)
        if (vmu && vmuVal) vmuVal.textContent = Number(vmu.value).toFixed(2)
        if (vs && vsVal) vsVal.textContent = Number(vs.value).toFixed(2)
      }
      if (vm) vm.oninput = () => { this.audio.setMasterVolume(Number(vm.value)); syncVals() }
      if (vmu) vmu.oninput = () => { this.audio.setMusicVolume(Number(vmu.value)); syncVals() }
      if (vs) vs.oninput = () => { this.audio.setSfxVolume(Number(vs.value)); syncVals() }
      // Initialize slider positions from current defaults
      if (vm) vm.value = this.audio.getMasterVolume().toFixed(2)
      if (vmu) vmu.value = this.audio.getMusicVolume().toFixed(2)
      if (vs) vs.value = this.audio.getSfxVolume().toFixed(2)
      syncVals()
    }
    hookSliders()

    // Title overlay
    this.titleOverlay = document.createElement('div') as HTMLDivElement
    this.titleOverlay.id = 'overlay'
    this.titleOverlay.style.display = 'flex'
    this.titleOverlay.style.flexDirection = 'column'
    this.titleOverlay.style.gap = '18px'
    const titleWrap = document.createElement('div')
    titleWrap.style.display = 'flex'
    titleWrap.style.flexDirection = 'column'
    titleWrap.style.alignItems = 'center'
    titleWrap.style.gap = '10px'
    const img = document.createElement('img')
    img.src = 'title.png'
    img.alt = 'Disk Survivor'
    img.style.width = '256px'
    img.style.height = '256px'
    ;(img.style as any).imageRendering = 'pixelated'
    const fallbackText = document.createElement('div')
    fallbackText.style.color = '#9be3ff'
    fallbackText.style.fontFamily = 'ui-monospace, monospace'
    fallbackText.style.fontSize = '32px'
    fallbackText.style.textShadow = '0 0 12px rgba(102,204,255,0.6)'
    fallbackText.textContent = 'Disk Survivor'
    fallbackText.style.display = 'none'
    img.onerror = () => { fallbackText.style.display = 'block' }
    titleWrap.appendChild(img)
    titleWrap.appendChild(fallbackText)
    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.gap = '14px'
    const startBtn = document.createElement('button') as HTMLButtonElement
    startBtn.className = 'card selected'
    startBtn.innerHTML = '<strong>Start</strong>'
    const optBtn = document.createElement('button') as HTMLButtonElement
    optBtn.className = 'card'
    optBtn.innerHTML = '<strong>Options</strong>'
    btnRow.appendChild(startBtn)
    btnRow.appendChild(optBtn)
    this.titleOverlay.appendChild(titleWrap)
    this.titleOverlay.appendChild(btnRow)
    this.root.appendChild(this.titleOverlay)

    const begin = () => {
      this.titleOverlay.style.display = 'none'
      this.showTitle = false
      // start default music; theme selection will switch later
      this.audio.startMusic('default' as ThemeKey)
    }
    startBtn.onclick = begin
    optBtn.onclick = () => {
      optBtn.innerHTML = '<strong>Options</strong><div class="carddesc">Coming soon</div>'
      setTimeout(() => (optBtn.innerHTML = '<strong>Options</strong>'), 1200)
    }

    this.updateHud()
    this.updateHPBar()
    this.updateInventoryUI()
    this.updateXPBar()

    this.input = new InputManager(canvas)

    window.addEventListener('resize', () => this.onResize())
    this.onResize()

    requestAnimationFrame(() => this.loop())
  }

  makeBillboard(text: string, pos: THREE.Vector3): THREE.Object3D {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#2c3e50'
    ctx.strokeRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#66ccff'
    ctx.font = 'bold 36px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), mat)
    mesh.position.copy(pos)
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.z = Math.PI / 2
    return mesh
  }

  onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    const aspect = w / h
    const viewSize = 12
    this.camera.left = -viewSize * aspect
    this.camera.right = viewSize * aspect
    this.camera.top = viewSize
    this.camera.bottom = -viewSize
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  spawnEnemy() {
    const angle = Math.random() * Math.PI * 2
    const dist = 14 + Math.random() * 8
    const x = this.player.group.position.x + Math.cos(angle) * dist
    const z = this.player.group.position.z + Math.sin(angle) * dist
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff55aa }))
    mesh.position.set(x, 0.5, z)
    this.scene.add(mesh)
    this.enemies.push({ mesh, alive: true, speed: 2 + Math.random() * 1.5, hp: 2, type: 'slime', timeAlive: 0 })
  }

  shoot() {
    // Spawn from weapon anchor and use player's forward (+Z) in world space
    const start = new THREE.Vector3()
    this.player.weaponAnchor.getWorldPosition(start)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0).normalize()
    const spread = 0.12
    const count = this.multishot
    for (let i = 0; i < count; i++) {
      const angleOffset = (i - (count - 1) / 2) * spread
      const dir = forward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffff66 }))
      mesh.position.copy(start).add(dir.clone().multiplyScalar(0.12))
      mesh.position.y = 0.5
      this.scene.add(mesh)
      this.projectiles.push({ mesh, velocity: dir.multiplyScalar(14), alive: true, ttl: 1.6, damage: this.projectileDamage, pierce: 0, last: mesh.position.clone() })
    }
    this.audio.playShoot()
  }

  dropPickup(position: THREE.Vector3, forceKind?: 'heal' | 'xp') {
    // Only drops: Heal (rare) or XP bundles
    const roll = Math.random()
    let kind: Pickup['kind']
    if (forceKind) kind = forceKind
    else {
      if (roll < 0.06) kind = 'vacuum' // rarer than chicken
      else if (roll < 0.36) kind = 'heal'
      else kind = 'xp'
    }
    let mesh: THREE.Mesh
    if (kind === 'heal') {
      // Billboard quad with a simple chicken/pie emoji
      const canvas = document.createElement('canvas')
      canvas.width = 64; canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,64,64)
      ctx.font = '48px serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('🍗', 32, 36)
      const tex = new THREE.CanvasTexture(canvas)
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    } else if (kind === 'vacuum') {
      // Glowing blue cube
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x66ccff }))
    } else {
      // XP bundle cube (purple)
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshBasicMaterial({ color: 0xb388ff }))
    }
    mesh.position.copy(position)
    mesh.position.y = kind === 'heal' ? 0.7 : 0.4
    this.scene.add(mesh)
    const xpValue = kind === 'xp' ? (Math.random() < 0.5 ? 3 : 5) : undefined
    this.pickups.push({ mesh, kind, alive: true, xpValue })
  }

  applyPickup(p: Pickup) {
    if (p.kind === 'heal') {
      const heal = Math.ceil(this.player.maxHp * 0.25)
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal)
      this.updateHPBar()
    } else if (p.kind === 'vacuum') {
      // Pull in all current XP orbs and XP bundles instantly
      for (const orb of this.xpOrbs) {
        if (!orb.alive) continue
        orb.alive = false
        this.scene.remove(orb.mesh)
        this.gainXP(orb.value)
      }
      for (const pk of this.pickups) {
        if (!pk.alive) continue
        if (pk.kind === 'xp' && pk.xpValue) {
          pk.alive = false
          this.scene.remove(pk.mesh)
          this.gainXP(pk.xpValue)
        }
      }
    }
    if (p.kind === 'xp' && p.xpValue) {
      this.gainXP(p.xpValue)
    }
    this.updateHud()
    this.audio.playPickup()
  }

  updateHud() {
    this.hud.textContent = `Lvl ${this.level}  XP ${this.xp.toFixed(1)}/${this.xpToLevel.toFixed(1)}  Score ${this.score}  Time ${(this.gameTime | 0)}s`
  }

  updateHPBar() {
    const f = Math.max(0, Math.min(1, this.player.hp / this.player.maxHp))
    const el = document.querySelector('#hpbar #hpfill') as HTMLDivElement
    if (el) el.style.width = `${f * 100}%`
    const lab = document.querySelector('#hpbar #hplabel') as HTMLDivElement
    if (lab) lab.textContent = `${this.player.hp}/${this.player.maxHp}`
  }

  updateInventoryUI() {
    const wslots = document.querySelector<HTMLDivElement>('#wslots')!
    const uslots = document.querySelector<HTMLDivElement>('#uslots')!
    wslots.innerHTML = ''
    uslots.innerHTML = ''
    for (const w of this.ownedWeapons) {
      wslots.appendChild(this.makeSlotIcon(w))
    }
    for (const [u, lvl] of this.ownedUpgrades) {
      uslots.appendChild(this.makeSlotIcon(`${u} Lv.${lvl}`))
    }
  }

  makeSlotIcon(text: string) {
    const el = document.createElement('div')
    el.className = 'slot'
    el.innerHTML = `<span class="icon">💾</span><span class="label">${text}</span>`
    return el
  }

  // Level-up system
  showLevelUp() {
    this.isPausedForLevelUp = true
    this.overlay.innerHTML = ''
    this.overlay.style.display = 'flex'
    this.uiSelectIndex = 0

    const choices = this.rollChoices(3)
    for (const ch of choices) this.overlay.appendChild(ch)
    const cards = Array.from(this.overlay.querySelectorAll('.card')) as HTMLButtonElement[]
    cards.forEach((c, i) => c.classList.toggle('selected', i === 0))
  }

  rollChoices(num: number) {
    const pool: { title: string; desc: string; icon: string; apply: () => void }[] = []

    // Weapons (max 5 unique)
    if (this.ownedWeapons.size < this.maxWeapons) {
      if (!this.ownedWeapons.has('CRT Beam'))
        pool.push({ title: 'CRT Beam', desc: 'Piercing laser sweep', icon: '📺', apply: () => this.addWeapon('CRT Beam') })
      if (!this.ownedWeapons.has('Dot Matrix'))
        pool.push({ title: 'Dot Matrix', desc: 'Side bullets', icon: '🖨️', apply: () => { this.addWeapon('Dot Matrix'); this.sideBullets = true } })
      if (!this.ownedWeapons.has('Dial-up Burst'))
        pool.push({ title: 'Dial-up Burst', desc: 'Periodic shockwave', icon: '📞', apply: () => this.addWeapon('Dial-up Burst') })
      if (!this.ownedWeapons.has('SCSI Rocket'))
        pool.push({ title: 'SCSI Rocket', desc: 'Homing rockets', icon: '🚀', apply: () => this.addWeapon('SCSI Rocket') })
      if (!this.ownedWeapons.has('Tape Whirl'))
        pool.push({ title: 'Tape Whirl', desc: 'Orbiting saws', icon: '📼', apply: () => this.addWeapon('Tape Whirl') })
      if (!this.ownedWeapons.has('Magic Lasso'))
        pool.push({ title: 'Magic Lasso', desc: 'Draw a loop to damage inside', icon: '🪢', apply: () => this.addWeapon('Magic Lasso') })
      if (!this.ownedWeapons.has('Shield Wall'))
        pool.push({ title: 'Shield Wall', desc: 'Blocking energy wall', icon: '🛡️', apply: () => this.addWeapon('Shield Wall') })
    }

    // Upgrades (max 5 unique; upgrades can level)
    const addUpgrade = (key: string, desc: string, icon: string, fn: () => void) => {
      pool.push({ title: key, desc, icon, apply: () => { this.ownedUpgrades.set(key, (this.ownedUpgrades.get(key) ?? 0) + 1); fn(); this.updateInventoryUI() } })
    }
    addUpgrade('Turbo CPU', 'Increase fire rate', '🧠', () => (this.fireInterval = Math.max(0.06, this.fireInterval * 0.88)))
    addUpgrade('SCSI Splitter', 'Add +1 multishot', '🔌', () => (this.multishot = Math.min(6, this.multishot + 1)))
    addUpgrade('Overclocked Bus', 'Increase move speed', '🧩', () => (this.player.speed = Math.min(13, this.player.speed + 0.6)))
    addUpgrade('Copper Heatsink', '+1 projectile damage', '🧱', () => (this.projectileDamage += 1))
    addUpgrade('ECC Memory', '+1 HP; heal 50%', '💊', () => { this.player.maxHp += 1; this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.ceil(this.player.maxHp * 0.5)); this.updateHPBar() })
    addUpgrade('DMA Burst', 'Burst fire', '💥', () => (this.burstCount = Math.min(5, this.burstCount + 1)))
    addUpgrade('Magnet Coil', 'Pull XP farther', '🧲', () => (this.xpMagnetRadius = Math.min(5, this.xpMagnetRadius + 0.7)))
    addUpgrade('Piercing ISA', '+1 projectile pierce', '🧷', () => (this.projectilePierce = Math.min(3, this.projectilePierce + 1)))
    addUpgrade('XP Amplifier', 'Gain more XP from drops', '📈', () => (this.xpGainMultiplier = Math.min(3.0, this.xpGainMultiplier * 1.1)))

    // Weapon level-ups appear as choices if already owned
    if (this.ownedWeapons.has('CRT Beam')) pool.push({ title: 'CRT Beam (Level up)', desc: '+1 length, +2 DPS, shorter off-time', icon: '📺', apply: () => this.levelUpBeam() })
    if (this.hasLasso) pool.push({ title: 'Magic Lasso (Level up)', desc: '+2s duration, +2 damage', icon: '🪢', apply: () => this.levelUpLasso() })
    if (this.hasShield) pool.push({ title: 'Shield Wall (Level up)', desc: '+1 length, wider, longer uptime', icon: '🛡️', apply: () => this.levelUpShield() })
    if (this.ownedWeapons.has('Dial-up Burst')) pool.push({ title: 'Dial-up Burst (Level up)', desc: 'Bigger radius, faster cycle', icon: '📞', apply: () => this.levelUpBurst() })
    if (this.ownedWeapons.has('SCSI Rocket')) pool.push({ title: 'SCSI Rocket (Level up)', desc: 'Faster, stronger rockets', icon: '🚀', apply: () => this.levelUpRocket() })
    if (this.ownedWeapons.has('Dot Matrix')) pool.push({ title: 'Dot Matrix (Level up)', desc: 'Stronger side bullets', icon: '🖨️', apply: () => this.levelUpDotMatrix() })
    if (this.ownedWeapons.has('Tape Whirl')) pool.push({ title: 'Tape Whirl (Level up)', desc: 'Bigger radius, higher DPS', icon: '📼', apply: () => this.levelUpWhirl() })

    // Randomize and take N
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, num).map((p) => this.makeChoiceCard(p.title, p.desc, p.icon, p.apply))
  }

  makeChoiceCard(title: string, desc: string, icon: string, apply: () => void) {
    const c = document.createElement('button')
    c.className = 'card'
    c.innerHTML = `<div class="cardrow"><span class="cardicon">${icon}</span><strong>${title}</strong></div><div class="carddesc">${desc}</div>`
    c.onclick = () => {
      // Enforce max counts
      if (this.isWeapon(title) && this.ownedWeapons.size >= this.maxWeapons) return
      if (!this.isWeapon(title) && this.ownedUpgrades.size >= this.maxUpgrades && !this.ownedUpgrades.has(title)) return
      apply()
      this.overlay.style.display = 'none'
      this.isPausedForLevelUp = false
    }
    return c
  }

  isWeapon(name: string) {
    return ['CRT Beam', 'Dot Matrix', 'Dial-up Burst', 'SCSI Rocket', 'Tape Whirl'].includes(name)
  }

  addWeapon(name: string) {
    if (this.ownedWeapons.has(name)) return
    this.ownedWeapons.add(name)
    if (name === 'CRT Beam' && !this.crtBeam) {
      const geom = new THREE.PlaneGeometry(this.crtBeamLength, 0.35)
      const mat = new THREE.MeshBasicMaterial({ color: 0x99e0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending })
      const beam = new THREE.Mesh(geom, mat)
      beam.rotation.x = -Math.PI / 2
      beam.position.set(0, 0.2, this.crtBeamLength / 2)
      this.player.group.add(beam)
      this.crtBeam = beam
      // Outer glow
      const g2 = new THREE.PlaneGeometry(this.crtBeamLength, 0.7)
      const m2 = new THREE.MeshBasicMaterial({ color: 0x33cfff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending })
      const glow = new THREE.Mesh(g2, m2)
      glow.rotation.x = -Math.PI / 2
      glow.position.set(0, 0.19, this.crtBeamLength / 2)
      this.player.group.add(glow)
      this.crtBeamGlow = glow
      this.crtBeamTimer = 0
      this.crtBeamOn = true
    }
    if (name === 'Tape Whirl' && this.whirlSaws.length === 0) {
      const createSaw = () => new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 16), new THREE.MeshBasicMaterial({ color: 0xffcc66 }))
      const s1 = createSaw(), s2 = createSaw(), s3 = createSaw()
      this.scene.add(s1, s2, s3)
      this.whirlSaws.push(s1, s2, s3)
    }
    if (name === 'Magic Lasso' && !this.hasLasso) {
      this.hasLasso = true
      const p0 = this.player.group.position.clone()
      const p1 = this.player.group.position.clone().add(new THREE.Vector3(0.05, 0, 0.05))
      const geom = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1]), 2, 0.065, 6, false)
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd199, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
      this.lassoMesh = new THREE.Mesh(geom, mat)
      this.lassoMesh.position.y = 0
      this.scene.add(this.lassoMesh)
      this.lassoPoints = []
      this.lassoLastPoint.copy(this.player.group.position)
      this.lassoLevel = 1
    }
    if (name === 'Shield Wall' && !this.hasShield) {
      this.hasShield = true
      const geom = new THREE.PlaneGeometry(this.shieldWidth, this.shieldLength)
      const mat = new THREE.MeshBasicMaterial({ color: 0x88e1ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      const wall = new THREE.Mesh(geom, mat)
      wall.rotation.x = -Math.PI / 2
      wall.position.set(0, 0.15, this.shieldLength / 2)
      this.player.group.add(wall)
      this.shieldMesh = wall
      this.shieldTimer = 0
      this.shieldOn = true
      this.shieldLevel = 1
    }
    this.updateInventoryUI()
  }

  // When enemy dies, spawn XP
  spawnXP(position: THREE.Vector3) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0x66ff88 }))
    mesh.position.copy(position)
    mesh.position.y = 0.35
    this.scene.add(mesh)
    this.xpOrbs.push({ mesh, value: 1, alive: true })
  }

  gainXP(amount: number) {
    const gained = amount * this.xpGainMultiplier
    this.xp += gained
    this.showXPToast(`+${gained.toFixed(1)} XP`)
    if (this.xp >= this.xpToLevel) {
      this.xp -= this.xpToLevel
      this.level += 1
      this.xpToLevel = Math.floor(this.xpToLevel * 1.5)
      this.showLevelUp()
      this.audio.playLevelUp()
    }
    this.updateXPBar()
    this.updateHud()
    this.audio.playPickup()
  }

  updateXPBar() {
    const fill = Math.max(0, Math.min(1, this.xp / this.xpToLevel))
    const el = this.xpBar.querySelector('#xpfill') as HTMLDivElement
    if (el) el.style.width = `${fill * 100}%`
    const lab = this.xpBar.querySelector('#xplabel') as HTMLDivElement
    if (lab) lab.textContent = `${this.xp.toFixed(1)}/${this.xpToLevel.toFixed(1)}`
  }

  showXPToast(text: string) {
    const t = document.createElement('div')
    t.textContent = text
    Object.assign(t.style, {
      position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
      color: '#8effe2', fontFamily: 'ui-monospace, monospace', fontSize: '16px',
      textShadow: '0 0 8px #33d6a6', pointerEvents: 'none', zIndex: '25', opacity: '1', transition: 'opacity 600ms, transform 600ms'
    } as CSSStyleDeclaration)
    document.body.appendChild(t)
    requestAnimationFrame(() => { t.style.opacity = '0'; t.style.transform = 'translate(-50%, -70%)' })
    setTimeout(() => t.remove(), 650)
  }

  applyTheme(theme: Theme) {
    if (this.currentTheme === theme) return
    this.currentTheme = theme

    // Clear previous obstacles
    for (const o of this.themeObstacles) this.scene.remove(o)
    this.themeObstacles.length = 0

    // Remove other billboards once chosen
    if (!this.themeLocked) {
      this.themeLocked = true
      for (const bb of [this.billboardGeocities, this.billboardYahoo, this.billboardDialup]) {
        if (bb) this.scene.remove(bb)
      }
    }

    // Ground texture via CanvasTexture
    const texCanvas = document.createElement('canvas')
    texCanvas.width = 512
    texCanvas.height = 512
    const ctx = texCanvas.getContext('2d')!
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, 512, 512)

    if (theme === 'geocities') {
      // Deep navy base
      ctx.fillStyle = '#0a0e2a'
      ctx.fillRect(0, 0, 512, 512)
      // Tile stickers: "WELCOME", "UNDER CONSTRUCTION", stars
      const drawSticker = (x: number, y: number, text: string, bg: string) => {
        ctx.fillStyle = bg
        ctx.fillRect(x, y, 96, 32)
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'
        ctx.strokeRect(x, y, 96, 32)
        ctx.fillStyle = '#fffbcc'
        ctx.font = 'bold 16px sans-serif'
        ctx.fillText(text, x + 6, y + 22)
      }
      for (let y = 16; y < 512; y += 96) {
        for (let x = 16; x < 512; x += 128) {
          drawSticker(x, y, 'WELCOME', '#1b3aa3')
          if (x + 64 < 512) drawSticker(x + 48, y + 40, 'UNDER CONSTRUCTION', '#a36f1b')
        }
      }
      // Sparse pixel stars
      ctx.fillStyle = '#9be3ff'
      for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2)
    } else if (theme === 'yahoo') {
      ctx.fillStyle = '#120a2a'
      ctx.fillRect(0, 0, 512, 512)
      ctx.strokeStyle = '#3a0ca3'
      for (let i = 0; i < 32; i++) {
        ctx.beginPath()
        ctx.moveTo(0, (i * 16) % 512)
        ctx.lineTo(512, ((i * 16) % 512) + 8)
        ctx.stroke()
      }
    } else if (theme === 'dialup') {
      ctx.fillStyle = '#091a12'
      ctx.fillRect(0, 0, 512, 512)
      ctx.strokeStyle = '#1e4d3a'
      for (let i = 0; i < 100; i++) {
        ctx.globalAlpha = 0.15
        ctx.beginPath()
        ctx.arc(Math.random() * 512, Math.random() * 512, Math.random() * 12 + 4, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    const tex = new THREE.CanvasTexture(texCanvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(10, 10)
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).map = tex
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(0xffffff)
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).needsUpdate = true

    // Obstacles per theme
    const obstacles: THREE.Object3D[] = []
    const addBox = (x: number, z: number, c: number, s = 2) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, 1, s), new THREE.MeshBasicMaterial({ color: c }))
      m.position.set(x, 0.5, z)
      obstacles.push(m)
      this.scene.add(m)
    }
    if (theme === 'geocities') {
      addBox(-4, -2, 0xff77ff, 3)
      addBox(2, -6, 0xffff55, 2)
      addBox(6, 4, 0x55ff55, 3)
    } else if (theme === 'yahoo') {
      addBox(-6, 6, 0x6600cc, 3)
      addBox(0, -8, 0x9900ff, 2)
    } else if (theme === 'dialup') {
      addBox(-8, 0, 0x88aa99, 3)
      addBox(4, 8, 0x557788, 3)
    }
    this.themeObstacles = obstacles

    // Spawn 1–2 heal pickups near the start of the level
    const startHeals = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < startHeals; i++) {
      const ang = Math.random() * Math.PI * 2
      const dist = 4 + Math.random() * 6
      const pos = this.player.group.position.clone().add(new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist))
      this.dropPickup(pos, 'heal')
    }

    // Start music for theme
    this.audio.startMusic(theme as ThemeKey)
  }

  checkThemeTiles() {
    if (this.themeLocked) return
    const p = this.player.group.position
    if (Math.abs(p.x + 6) < 2.5 && Math.abs(p.z + 6) < 2.5) { this.applyTheme('geocities'); this.themeChosen = true }
    if (Math.abs(p.x - 8) < 2.5 && Math.abs(p.z - 4) < 2.5) { this.applyTheme('yahoo'); this.themeChosen = true }
    if (Math.abs(p.x + 10) < 2.5 && Math.abs(p.z - 10) < 2.5) { this.applyTheme('dialup'); this.themeChosen = true }
  }

  // Controller overlay navigation
  updateOverlaySelection(delta: number) {
    if (this.overlay.style.display !== 'flex') return
    this.uiNavCooldown -= delta
    // Deadzone and edge-trigger
    const axis = this.input.axesLeft.x
    const moveAxis = Math.abs(axis) > 0.5 ? Math.sign(axis) : 0
    const gp = this.input.getActiveGamepad()
    const aPressed = !!gp && (gp.buttons[0]?.pressed || gp.buttons[1]?.pressed || gp.buttons[7]?.pressed || gp.buttons[9]?.pressed)
    const dpadLeft = !!gp && (gp.buttons[14]?.pressed)
    const dpadRight = !!gp && (gp.buttons[15]?.pressed)
    const enterPressed = !!this.input.keys['enter']
    const confirm = aPressed || enterPressed

    // Stick nav with cooldown
    if (this.uiNavCooldown <= 0 && moveAxis !== 0) {
      this.uiNavCooldown = 0.25
      const cards = Array.from(this.overlay.querySelectorAll('button.card')) as HTMLButtonElement[]
      if (cards.length === 0) return
      this.uiSelectIndex = (this.uiSelectIndex + moveAxis + cards.length) % cards.length
      cards.forEach((c, i) => c.classList.toggle('selected', i === this.uiSelectIndex))
    }
    // D-pad edge nav without cooldown
    if (dpadLeft && !this.uiDpadPrevLeft) {
      const cards = Array.from(this.overlay.querySelectorAll('button.card')) as HTMLButtonElement[]
      if (cards.length > 0) {
        this.uiSelectIndex = (this.uiSelectIndex - 1 + cards.length) % cards.length
        cards.forEach((c, i) => c.classList.toggle('selected', i === this.uiSelectIndex))
      }
    }
    if (dpadRight && !this.uiDpadPrevRight) {
      const cards = Array.from(this.overlay.querySelectorAll('button.card')) as HTMLButtonElement[]
      if (cards.length > 0) {
        this.uiSelectIndex = (this.uiSelectIndex + 1) % cards.length
        cards.forEach((c, i) => c.classList.toggle('selected', i === this.uiSelectIndex))
      }
    }
    if (confirm && !this.uiConfirmPrev) {
      const cards = Array.from(this.overlay.querySelectorAll('button.card')) as HTMLButtonElement[]
      const selected = cards[this.uiSelectIndex]
      if (selected) selected.click()
    }
    this.uiConfirmPrev = confirm
    this.uiDpadPrevLeft = dpadLeft
    this.uiDpadPrevRight = dpadRight
  }

  // Start conditions: do not run timer/spawns until a theme is chosen
  allowGameProgress() {
    return this.themeChosen && !this.isPausedForLevelUp && !this.isPaused
  }

  loop() {
    const now = performance.now()
    const dt = Math.min(0.033, (now - this.lastTime) / 1000)
    this.lastTime = now

    // Overlay controller navigation
    this.updateOverlaySelection(dt)

    // Title overlay input
    if (this.showTitle && this.titleOverlay.style.display === 'flex') {
      const gp = this.input.getActiveGamepad()
      const a = !!gp && (gp.buttons[0]?.pressed || gp.buttons[9]?.pressed)
      const enter = !!this.input.keys['enter']
      const left = !!gp && (gp.buttons[14]?.pressed || (this.input.axesLeft.x < -0.6))
      const right = !!gp && (gp.buttons[15]?.pressed || (this.input.axesLeft.x > 0.6))
      const cards = Array.from(this.titleOverlay.querySelectorAll('.card')) as HTMLButtonElement[]
      const currentIndex = cards.findIndex((c) => c.classList.contains('selected'))
      if (right) {
        const next = Math.min(cards.length - 1, currentIndex + 1)
        cards.forEach((c, i) => c.classList.toggle('selected', i === next))
      }
      if (left) {
        const prev = Math.max(0, currentIndex - 1)
        cards.forEach((c, i) => c.classList.toggle('selected', i === prev))
      }
      if (a || enter) {
        const selected = cards.find((c) => c.classList.contains('selected')) || cards[0]
        selected.click()
      }
      // Render and continue loop without running game logic
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    // Always allow free rotation before theme select
    this.input.updateGamepad()
    let aimVector = new THREE.Vector3()
    if (this.input.axesRight.x !== 0 || this.input.axesRight.y !== 0) {
      // Use camera-ray from stick as NDC to match mouse aiming behavior
      const ndc = new THREE.Vector2(this.input.axesRight.x, -this.input.axesRight.y)
      this.raycaster.setFromCamera(ndc, this.camera)
      const hit = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hit)
      aimVector.copy(hit.sub(this.player.group.position)).setY(0).normalize()
    } else {
      // Also allow mouse to rotate before selecting a level
      this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.x, this.input.mouse.y), this.camera)
      const hitMouse = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hitMouse)
      aimVector.copy(hitMouse.sub(this.player.group.position)).setY(0).normalize()
    }
    if (aimVector.lengthSq() > 0) {
      const yaw = Math.atan2(aimVector.x, aimVector.z)
      this.player.facing = yaw
      this.player.group.rotation.y = yaw
    }

    // Pause toggle (Start/P/Enter edge)
    const gp = this.input.getActiveGamepad()
    const startPressed = !!gp && gp.buttons[9]?.pressed
    const pPressed = !!this.input.keys['p']
    const escPressed = !!this.input.keys['escape']
    const pauseNow = !!(startPressed || pPressed || escPressed)
    if (pauseNow && !this.pausePrev) {
      // When opening pause, re-hook sliders so events are active
      const vm = this.pauseOverlay.querySelector('#vol-master') as HTMLInputElement
      if (vm) {
        const vmu = this.pauseOverlay.querySelector('#vol-music') as HTMLInputElement
        const vs = this.pauseOverlay.querySelector('#vol-sfx') as HTMLInputElement
        const vmVal = this.pauseOverlay.querySelector('#vol-master-val') as HTMLSpanElement
        const vmuVal = this.pauseOverlay.querySelector('#vol-music-val') as HTMLSpanElement
        const vsVal = this.pauseOverlay.querySelector('#vol-sfx-val') as HTMLSpanElement
        const syncVals = () => {
          if (vm && vmVal) vmVal.textContent = Number(vm.value).toFixed(2)
          if (vmu && vmuVal) vmuVal.textContent = Number(vmu.value).toFixed(2)
          if (vs && vsVal) vsVal.textContent = Number(vs.value).toFixed(2)
        }
        vm.oninput = () => { this.audio.setMasterVolume(Number(vm.value)); syncVals() }
        const vmu2 = this.pauseOverlay.querySelector('#vol-music') as HTMLInputElement
        const vs2 = this.pauseOverlay.querySelector('#vol-sfx') as HTMLInputElement
        if (vmu2) vmu2.oninput = () => { this.audio.setMusicVolume(Number(vmu2.value)); syncVals() }
        if (vs2) vs2.oninput = () => { this.audio.setSfxVolume(Number(vs2.value)); syncVals() }
        syncVals()
      }
      this.togglePause()
    }
    this.uiStartPrev = !!startPressed
    this.pausePrev = pauseNow

    if (!this.themeChosen) {
      const mv = this.input.getMoveVector()
      this.player.group.position.add(new THREE.Vector3(mv.x, 0, mv.y).multiplyScalar(this.player.speed * dt))
      this.checkThemeTiles()
      this.isoPivot.position.lerp(new THREE.Vector3(this.player.group.position.x, 0, this.player.group.position.z), 0.1)
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    if (this.isPaused) {
      // Allow unpause from any input while paused
      const gp2 = this.input.getActiveGamepad()
      const start2 = !!gp2 && gp2.buttons[9]?.pressed
      const p2 = !!this.input.keys['p']
      const esc2 = !!this.input.keys['escape']
      const pausePressed = !!(start2 || p2 || esc2)
      if (pausePressed && !this.pausePrev) this.togglePause()
      this.pausePrev = pausePressed
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    this.gameTime += dt

    // Update i-frames early so they expire properly
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dt)
      const flicker = Math.floor(this.gameTime * 20) % 2 === 0
      this.player.group.visible = flicker
      if (this.invulnTimer === 0) this.player.group.visible = true
    } else {
      this.player.group.visible = true
    }

    if (this.isPausedForLevelUp) {
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    this.input.updateGamepad()

    const mv = this.input.getMoveVector()
    const moveDir = new THREE.Vector3(mv.x, 0, mv.y)
    this.player.group.position.add(moveDir.multiplyScalar(this.player.speed * dt))

    // Giant spawns periodically
    this.giantTimer += dt
    if (this.giantTimer >= this.giantInterval) {
      this.giantTimer = 0
      this.spawnGiant()
    }

    // Obstacles pushback
    for (const o of this.themeObstacles) {
      const d2 = this.player.group.position.distanceToSquared(o.position)
      if (d2 < 1.6 ** 2) {
        const push = this.player.group.position.clone().sub(o.position).setY(0).normalize().multiplyScalar(0.08)
        this.player.group.position.add(push)
      }
    }

    // Aim and rotation (forward +Z)
    aimVector = new THREE.Vector3()
    if (this.input.axesRight.x !== 0 || this.input.axesRight.y !== 0) {
      const ndc = new THREE.Vector2(this.input.axesRight.x, -this.input.axesRight.y)
      this.raycaster.setFromCamera(ndc, this.camera)
      const hitPoint2 = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint2)
      aimVector.copy(hitPoint2.sub(this.player.group.position)).setY(0).normalize()
    } else {
      this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.x, this.input.mouse.y), this.camera)
      const hitPoint = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint)
      aimVector.copy(hitPoint.sub(this.player.group.position))
      aimVector.y = 0
      aimVector.normalize()
    }
    if (aimVector.lengthSq() > 0) {
      const yaw = Math.atan2(aimVector.x, aimVector.z)
      this.player.facing = yaw
      this.player.group.rotation.y = yaw
    }

    // Primary shooting
    this.fireTimer += dt
    const shouldFire = this.input.mouseDown || this.input.axesRight.x !== 0 || this.input.axesRight.y !== 0
    if (shouldFire && this.fireTimer >= this.fireInterval) {
      this.fireTimer = 0
      for (let b = 0; b < this.burstCount; b++) {
        const delay = b * this.burstDelay
        setTimeout(() => this.shoot(), delay * 1000)
      }
      if (this.sideBullets) {
        // Left and right side shots
        const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.player.group.quaternion).setY(0).normalize()
        const right = left.clone().multiplyScalar(-1)
        this.fireSideBullet(left)
        this.fireSideBullet(right)
      }
    }

    // CRT Beam damage tick
    if (this.ownedWeapons.has('CRT Beam') && this.crtBeam) {
      // Flicker cycle
      this.crtBeamTimer += dt
      const currPhase = this.crtBeamOn ? this.crtBeamOnDuration : this.crtBeamOffDuration
      if (this.crtBeamTimer >= currPhase) { this.crtBeamTimer = 0; this.crtBeamOn = !this.crtBeamOn }
      this.crtBeam.visible = this.crtBeamOn
      if (this.crtBeamGlow) this.crtBeamGlow.visible = this.crtBeamOn
      // subtle pulse
      if (this.crtBeam && this.crtBeam.visible) {
        const t = (Math.sin(this.gameTime * 12) * 0.5 + 0.5)
        ;(this.crtBeam.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.12 * t
        if (this.crtBeamGlow) (this.crtBeamGlow.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * t
      }
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0).normalize()
      if (this.crtBeamOn) for (const e of this.enemies) {
        if (!e.alive) continue
        const toE = e.mesh.position.clone().sub(this.player.group.position)
        toE.y = 0
        const dist = toE.length()
        if (dist <= this.crtBeamLength) {
          const dirDot = forward.dot(toE.normalize()) // cos angle
          if (dirDot > 0.92) {
            e.hp -= this.crtBeamDps * dt
            if (e.hp <= 0) {
              e.alive = false
              this.spawnExplosion(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.spawnXP(e.mesh.position.clone())
              if (Math.random() < 0.25) this.dropPickup(e.mesh.position.clone())
            } else this.audio.playImpact()
          }
        }
      }
    }

    // Tape Whirl update
    if (this.ownedWeapons.has('Tape Whirl') && this.whirlSaws.length > 0) {
      for (let i = 0; i < this.whirlSaws.length; i++) {
        const saw = this.whirlSaws[i]
        const angle = this.gameTime * this.whirlSpeed + (i * Math.PI * 2) / this.whirlSaws.length
        const offset = new THREE.Vector3(Math.cos(angle) * this.whirlRadius, 0.6, Math.sin(angle) * this.whirlRadius)
        saw.position.copy(this.player.group.position).add(offset)
        // Damage enemies on touch
        for (const e of this.enemies) {
          if (!e.alive) continue
          const hitDist = 1.0 // horizontal radius for contact
          const sp = saw.position.clone(); sp.y = 0
          const ep = e.mesh.position.clone(); ep.y = 0
          if (sp.distanceToSquared(ep) < hitDist * hitDist) {
            e.hp -= this.whirlDamage * dt
            if (e.hp <= 0) {
              e.alive = false
              this.scene.remove(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.spawnXP(e.mesh.position.clone())
            } else {
              this.audio.playImpact()
              // small nudge so we don't re-hit the same spot without visual movement
              const away = e.mesh.position.clone().sub(saw.position).setY(0).normalize().multiplyScalar(0.02)
              e.mesh.position.add(away)
            }
          }
        }
      }
    }

    // Special weapons passive timers
    if (this.ownedWeapons.has('Dial-up Burst')) {
      this.modemWaveTimer += dt
      if (this.modemWaveTimer >= this.modemWaveInterval) {
        this.modemWaveTimer = 0
        this.emitShockwave()
      }
    }
    if (this.ownedWeapons.has('SCSI Rocket')) {
      this.rocketTimer += dt
      if (this.rocketTimer >= this.rocketInterval) {
        this.rocketTimer = 0
        this.launchRocket()
      }
    }

    // Apply XP magnet
    for (const orb of this.xpOrbs) {
      if (!orb.alive) continue
      const toPlayer = this.player.group.position.clone().sub(orb.mesh.position)
      toPlayer.y = 0
      const d = toPlayer.length()
      if (d < this.xpMagnetRadius) {
        toPlayer.normalize()
        orb.mesh.position.add(toPlayer.multiplyScalar((this.xpMagnetRadius - d + 0.4) * dt * 6))
      }
    }

    // Spawning waves and difficulty ramp
    this.spawnAccumulator += dt
    const minute = Math.floor(this.gameTime / 60)
    const baseInterval = Math.max(0.6, 2.0 - this.gameTime * 0.03)
    if (this.spawnAccumulator >= baseInterval) {
      this.spawnAccumulator = 0
      const count = 1 + Math.min(6, Math.floor(this.gameTime / 25))
      for (let i = 0; i < count; i++) this.spawnEnemyByWave(minute)
    }

    // Update enemies with different behaviors
    for (const e of this.enemies) {
      if (!e.alive) continue
      e.timeAlive += dt
      const toPlayer = this.player.group.position.clone().sub(e.mesh.position)
      toPlayer.y = 0
      let dir = toPlayer.clone().normalize()
      if (e.type === 'runner') {
        // Accelerate over time, but ~20% slower overall
        e.speed = (2.8 + Math.min(3, this.gameTime * 0.02)) * 0.8
      } else if (e.type === 'zigzag') {
        const perp = new THREE.Vector3(-dir.z, 0, dir.x)
        dir.addScaledVector(perp, Math.sin(e.timeAlive * 6) * 0.6).normalize()
      } else if (e.type === 'tank') {
        // Slow but more HP; already handled at spawn
      } else if (e.type === 'shooter') {
        // Keeps distance
        const dist = toPlayer.length()
        if (dist < 5) dir.multiplyScalar(-1)
      }
      e.mesh.position.add(dir.multiplyScalar(e.speed * dt))

      // Collide with player
      if (e.mesh.position.distanceToSquared(this.player.group.position) < (this.player.radius + 0.5) ** 2) {
        if (this.invulnTimer <= 0) {
          e.alive = false
          this.spawnExplosion(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.player.hp = Math.max(0, this.player.hp - 1)
          this.updateHPBar()
          this.audio.playOuch()
          if (this.player.hp <= 0) {
            this.onPlayerDeath()
            return
          }
          this.updateHud()
          this.onEnemyDown()
          this.invulnTimer = this.invulnDuration
        }
      }

      // Face billboard towards player
      if (e.face) {
        const toP = this.player.group.position.clone().sub(e.mesh.position).setY(0)
        const dir2 = toP.clone().normalize()
        const faceOffset = e.type === 'giant' ? 1.0 : 0.45
        const faceHeight = e.type === 'giant' ? 2.1 : 0.95
        e.face.position.copy(e.mesh.position).add(dir2.multiplyScalar(faceOffset)).setY(faceHeight)
        e.face.lookAt(this.player.group.position.clone().setY(faceHeight))
        if (e.type === 'giant' && e.faceTex && e.faceCanvas) {
          if ((e.nextFaceUpdate ?? 0) <= performance.now()) {
            const frame = Math.floor(e.timeAlive * 10)
            this.drawAnimatedFace(e.faceCanvas, frame)
            e.faceTex.needsUpdate = true
            e.nextFaceUpdate = performance.now() + 120
          }
        }
      }
    }

    // Update projectiles with damage and pierce
    for (const p of this.projectiles) {
      if (!p.alive) continue
      p.ttl -= dt
      if (p.ttl <= 0) {
        p.alive = false
        this.scene.remove(p.mesh)
        continue
      }
      const prev = p.mesh.position.clone()
      p.mesh.position.addScaledVector(p.velocity, dt)

      // Swept collision against enemies
      for (const e of this.enemies) {
        if (!e.alive) continue
        // distance from segment prev->curr to enemy center on XZ
        const a = prev.clone(); const b = p.mesh.position.clone(); const c = e.mesh.position.clone()
        a.y = b.y = c.y = 0
        const ab = b.clone().sub(a)
        const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())))
        const closest = a.clone().add(ab.multiplyScalar(t))
        const d2 = closest.distanceToSquared(c)
        if (d2 < 0.55 ** 2) {
          e.hp -= p.damage
          if (e.hp <= 0) {
            e.alive = false
            this.spawnExplosion(e.mesh)
            if (e.face) this.scene.remove(e.face)
            this.onEnemyDown()
            this.score += 1
            this.updateHud()
            this.spawnXP(e.mesh.position.clone())
            if (Math.random() < 0.25) this.dropPickup(e.mesh.position.clone())
          }
          else {
            this.audio.playImpact()
          }
          if (p.pierce > 0) {
            p.pierce -= 1
          } else {
            p.alive = false
            this.scene.remove(p.mesh)
          }
          break
        }
      }
      p.last.copy(p.mesh.position)
    }

    // Update XP and pickups
    for (const orb of this.xpOrbs) {
      if (!orb.alive) continue
      orb.mesh.rotation.y += dt * 2
      const d2 = orb.mesh.position.distanceToSquared(this.player.group.position)
      if (d2 < (this.player.radius + 0.6) ** 2) {
        orb.alive = false
        this.scene.remove(orb.mesh)
        this.gainXP(orb.value)
      }
    }

    for (const pk of this.pickups) {
      if (!pk.alive) continue
      pk.mesh.rotation.y += dt * 2
      // Magnetize XP bundles, not heals
      if (pk.kind === 'xp') {
        const toP = this.player.group.position.clone().sub(pk.mesh.position)
        toP.y = 0
        const dist = toP.length()
        if (dist < this.xpMagnetRadius) {
          toP.normalize()
          pk.mesh.position.add(toP.multiplyScalar((this.xpMagnetRadius - dist + 0.4) * dt * 6))
        }
      }
      if (pk.mesh.position.distanceToSquared(this.player.group.position) < (this.player.radius + 0.6) ** 2) {
        pk.alive = false
        this.scene.remove(pk.mesh)
        this.applyPickup(pk)
      }
    }

    // Theme triggers
    this.checkThemeTiles()

    this.isoPivot.position.lerp(new THREE.Vector3(this.player.group.position.x, 0, this.player.group.position.z), 0.1)

    // Magic Lasso update
    if (this.hasLasso) this.updateLasso()

    // Shield Wall blocking
    if (this.hasShield && this.shieldMesh) {
      // Flicker cycle
      this.shieldTimer += dt
      const currPhase = this.shieldOn ? this.shieldOnDuration : this.shieldOffDuration
      if (this.shieldTimer >= currPhase) { this.shieldTimer = 0; this.shieldOn = !this.shieldOn }
      this.shieldMesh.visible = this.shieldOn
      if (this.shieldOn) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0).normalize()
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.player.group.quaternion).setY(0).normalize()
        for (const e of this.enemies) {
          if (!e.alive) continue
          const rel = e.mesh.position.clone().sub(this.player.group.position).setY(0)
          const depth = rel.dot(forward)
          const lateral = Math.abs(rel.dot(right))
          if (depth > 0 && depth < this.shieldLength && lateral < this.shieldWidth * 0.5) {
            // push enemy forward (away from player)
            const push = forward.clone().multiplyScalar(Math.max(0.15, 0.32 - depth * 0.02))
            e.mesh.position.add(push)
          }
        }
      }
    }

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(() => this.loop())
  }

  togglePause() {
    this.isPaused = !this.isPaused
    this.pauseOverlay.style.display = this.isPaused ? 'flex' : 'none'
    if (this.isPaused) this.audio.pauseMusic()
    else this.audio.resumeMusic()
  }

  fireSideBullet(dir: THREE.Vector3) {
    const start = new THREE.Vector3()
    this.player.weaponAnchor.getWorldPosition(start)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x99ddff }))
    mesh.position.copy(start)
    mesh.position.y = 0.5
    this.scene.add(mesh)
    this.projectiles.push({ mesh, velocity: dir.clone().multiplyScalar(12), alive: true, ttl: 1.6, damage: this.projectileDamage * this.sideBulletDamageMultiplier, pierce: this.projectilePierce, last: mesh.position.clone() })
  }

  emitShockwave() {
    // Damage nearby enemies in ring
    // Visual ring
    const ringGeom = new THREE.RingGeometry(this.modemWaveRadius * 0.2, this.modemWaveRadius * 0.22, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    const ring = new THREE.Mesh(ringGeom, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(this.player.group.position).setY(0.02)
    this.scene.add(ring)
    const start = performance.now()
    const duration = 350
    const initR = this.modemWaveRadius * 0.2
    const endR = this.modemWaveRadius
    const anim = () => {
      const t = (performance.now() - start) / duration
      if (t >= 1) { this.scene.remove(ring); ringGeom.dispose(); (ring.material as THREE.Material).dispose?.(); return }
      const r = initR + (endR - initR) * t
      ring.geometry.dispose()
      ring.geometry = new THREE.RingGeometry(r * 0.98, r, 48)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t)
      requestAnimationFrame(anim)
    }
    anim()
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = e.mesh.position.distanceTo(this.player.group.position)
      if (d < this.modemWaveRadius) {
        e.hp -= this.modemWaveDamage + Math.floor(this.gameTime / 60)
        // Knockback away from player, stronger near center
        const dir = e.mesh.position.clone().sub(this.player.group.position).setY(0).normalize()
        const strength = Math.max(0.12, (this.modemWaveRadius - d) * 0.08)
        e.mesh.position.add(dir.multiplyScalar(strength))
        if (e.hp <= 0) {
          e.alive = false
          this.spawnExplosion(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.onEnemyDown()
          this.score += 1
          this.spawnXP(e.mesh.position.clone())
        } else {
          this.audio.playImpact()
        }
      }
    }
  }

  launchRocket() {
    // Simple homing rocket toward nearest enemy
    const target = this.enemies.find((e) => e.alive)
    if (!target) return
    const start = new THREE.Vector3()
    this.player.weaponAnchor.getWorldPosition(start)
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 10), new THREE.MeshBasicMaterial({ color: 0xff8844 }))
    mesh.position.copy(start)
    mesh.position.y = 0.6
    this.scene.add(mesh)
    const rocket: Projectile = { mesh, velocity: new THREE.Vector3(), alive: true, ttl: 3.5, damage: this.rocketDamage, pierce: 0, last: mesh.position.clone() }
    this.projectiles.push(rocket)
    const update = () => {
      if (!rocket.alive) return
      const t = this.enemies.find((e) => e.alive)
      if (t) {
        const dir = t.mesh.position.clone().sub(rocket.mesh.position).setY(0).normalize()
        rocket.velocity.lerp(dir.multiplyScalar(this.rocketSpeed), this.rocketTurn)
        rocket.mesh.lookAt(t.mesh.position.clone().setY(rocket.mesh.position.y))
      }
      setTimeout(update, 50)
    }
    update()
  }

  spawnEnemyByWave(minute: number) {
    // Decide type by minute
    let type: EnemyType = 'slime'
    if (minute >= 4) type = 'shooter'
    else if (minute >= 3) type = 'tank'
    else if (minute >= 2) type = 'zigzag'
    else if (minute >= 1) type = 'runner'

    const angle = Math.random() * Math.PI * 2
    const dist = 14 + Math.random() * 8
    const x = this.player.group.position.x + Math.cos(angle) * dist
    const z = this.player.group.position.z + Math.sin(angle) * dist

    let geom: THREE.BufferGeometry
    let color: number
    let hp: number
    let speed: number
    switch (type) {
      case 'runner':
        geom = new THREE.SphereGeometry(0.45, 12, 12)
        color = 0xffdd55
        hp = 2 + Math.floor(this.gameTime / 35)
        speed = 2.4
        break
      case 'zigzag':
        geom = new THREE.IcosahedronGeometry(0.5, 0)
        color = 0x55ffaa
        hp = 2 + Math.floor(this.gameTime / 35)
        speed = 2.6
        break
      case 'tank':
        geom = new THREE.BoxGeometry(0.7, 0.7, 0.7)
        color = 0xff6699
        hp = 6 + Math.floor(this.gameTime / 24)
        speed = 1.5
        break
      case 'shooter':
        geom = new THREE.ConeGeometry(0.4, 0.7, 10)
        color = 0x66aaff
        hp = 4 + Math.floor(this.gameTime / 25)
        speed = 2.0
        break
      default:
        geom = new THREE.SphereGeometry(0.5, 12, 12)
        color = 0xaa55ff
        hp = 2 + Math.floor(this.gameTime / 40)
        speed = 2.2
    }
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color }))
    mesh.position.set(x, 0.5, z)
    this.scene.add(mesh)

    // Create larger face billboard that tracks the player
    const faceTex = this.makeFaceTexture(type)
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
    )
    face.position.set(x, 0.95, z)
    this.scene.add(face)

    this.enemies.push({ mesh, alive: true, speed, hp, type, timeAlive: 0, face })
  }

  makeFaceTexture(type: EnemyType) {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 128
    const g = c.getContext('2d')!
    g.clearRect(0, 0, 128, 128)
    g.fillStyle = 'rgba(0,0,0,0)'
    g.fillRect(0, 0, 128, 128)
    // Eyes (bigger)
    g.fillStyle = '#fff'
    g.beginPath(); g.arc(40, 58, 20, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(88, 58, 20, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#111'
    const angry = type === 'runner' || type === 'tank' || type === 'shooter'
    g.beginPath(); g.arc(40 + (angry ? 6 : 0), 62, 10, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(88 + (angry ? -6 : 0), 62, 10, 0, Math.PI * 2); g.fill()
    // Brows
    g.strokeStyle = '#fff'; g.lineWidth = 6
    if (angry) {
      g.beginPath(); g.moveTo(18, 36); g.lineTo(58, 48); g.stroke()
      g.beginPath(); g.moveTo(108, 36); g.lineTo(68, 48); g.stroke()
    } else {
      g.beginPath(); g.moveTo(24, 44); g.lineTo(58, 44); g.stroke()
      g.beginPath(); g.moveTo(70, 44); g.lineTo(104, 44); g.stroke()
    }
    // Mouth
    g.strokeStyle = '#f66'; g.lineWidth = 7
    if (type === 'tank') {
      g.beginPath(); g.moveTo(36, 94); g.lineTo(92, 94); g.stroke()
    } else {
      g.beginPath(); g.arc(64, 90, 18, Math.PI * 0.05, Math.PI - Math.PI * 0.05); g.stroke()
    }
    const tex = new THREE.CanvasTexture(c)
    return tex
  }

  spawnGiant() {
    const angle = Math.random() * Math.PI * 2
    const dist = 16 + Math.random() * 6
    const x = this.player.group.position.x + Math.cos(angle) * dist
    const z = this.player.group.position.z + Math.sin(angle) * dist
    const geom = new THREE.SphereGeometry(1.2, 12, 12)
    const color = 0xff44aa
    const hp = 60 + Math.floor(this.gameTime / 6) // very tanky
    const speed = 1.2
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color }))
    mesh.position.set(x, 1.2, z)
    this.scene.add(mesh)

    // Animated face canvas
    const canvas = document.createElement('canvas')
    canvas.width = 128; canvas.height = 128
    const tex = new THREE.CanvasTexture(canvas)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    face.position.set(x, 2.1, z)
    this.scene.add(face)
    this.drawAnimatedFace(canvas, 0)

    this.enemies.push({ mesh, alive: true, speed, hp, type: 'giant', timeAlive: 0, face, faceTex: tex, faceCanvas: canvas, nextFaceUpdate: performance.now() })
  }

  drawAnimatedFace(c: HTMLCanvasElement, frame: number) {
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    // background sparkle
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `hsla(${(frame * 10 + i * 9) % 360}, 90%, 60%, 0.2)`
      g.fillRect((i * 13 + frame * 3) % 128, (i * 7) % 128, 3, 3)
    }
    // big eyes
    g.fillStyle = '#fff'
    g.beginPath(); g.arc(42, 60, 22, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(86, 60, 22, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#111'
    g.beginPath(); g.arc(42 + Math.sin(frame * 0.3) * 6, 64, 11, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.arc(86 + Math.cos(frame * 0.3) * -6, 64, 11, 0, Math.PI * 2); g.fill()
    // animated mouth
    g.strokeStyle = '#f66'; g.lineWidth = 8
    g.beginPath(); g.arc(64, 94, 18 + Math.sin(frame * 0.2) * 4, Math.PI * 0.05, Math.PI - Math.PI * 0.05); g.stroke()
  }

  // Death handling: controller to restart
  onPlayerDeath() {
    this.isPausedForLevelUp = true
    this.audio.playGameOver()
    this.overlay.innerHTML = ''
    this.overlay.style.display = 'flex'
    const wrap = document.createElement('div')
    wrap.style.display = 'flex'
    wrap.style.gap = '16px'
    // Left: Game Over + submit
    const goCard = document.createElement('div')
    goCard.className = 'card'
    const lastName = (localStorage.getItem('player.name') || '').slice(0, 20)
    goCard.innerHTML = `
      <div style="font-size:28px;color:#ff6699;margin-bottom:8px;">GAME OVER</div>
      <div class="carddesc" style="margin-bottom:8px;">Time: ${this.gameTime.toFixed(1)}s • Score: ${this.score}</div>
      <label class="carddesc" style="display:block;margin-bottom:6px;">Name (max 20):</label>
      <input id="name-input" maxlength="20" value="${lastName.replace(/"/g, '&quot;')}" style="width:100%; padding:6px; background:rgba(255,255,255,0.06); border:1px solid #1f2a44; color:#eaf6ff; border-radius:6px;" />
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button id="submit-btn" class="card" style="flex:1; text-align:center;"><strong>Submit</strong></button>
        <button id="restart-btn" class="card" style="flex:1; text-align:center;"><strong>Restart</strong></button>
      </div>
    `
    // Right: Leaderboard
    const lbCard = document.createElement('div')
    lbCard.className = 'card'
    lbCard.style.minWidth = '280px'
    lbCard.innerHTML = '<strong>Leaderboard</strong><div class="carddesc">Top 13 by time survived</div><div id="lb-list" style="margin-top:8px; display:grid; gap:4px; font-family: ui-monospace, monospace;"></div>'
    wrap.appendChild(goCard)
    wrap.appendChild(lbCard)
    this.overlay.appendChild(wrap)

    const restartBtn = goCard.querySelector('#restart-btn') as HTMLButtonElement
    restartBtn.onclick = () => location.reload()
    const submitBtn = goCard.querySelector('#submit-btn') as HTMLButtonElement
    const nameInput = goCard.querySelector('#name-input') as HTMLInputElement
    submitBtn.onclick = async () => {
      const name = (nameInput.value || '').slice(0, 20)
      try { localStorage.setItem('player.name', name) } catch {}
      await this.submitLeaderboard(name, Math.floor(this.gameTime), this.score)
      await this.refreshLeaderboard()
      // Focus restart after submit for quick replay
      restartBtn.focus()
    }
    // Fetch initial board
    this.refreshLeaderboard()
    // Enter submits if name field focused, else restart
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (document.activeElement === nameInput) submitBtn.click()
        else restartBtn.click()
      }
    }
    window.addEventListener('keydown', handler, { once: true })
  }

  onEnemyDown() {
    this.audio.playEnemyDown()
  }

  private spawnExplosion(source: THREE.Mesh) {
    const pos = source.position.clone()
    const color = ((source.material as any)?.color?.getHex?.() ?? 0xffffff) as number
    this.scene.remove(source)
    const shardCount = 10
    const shards: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = []
    for (let i = 0; i < shardCount; i++) {
      const g = new THREE.BoxGeometry(0.15, 0.15, 0.15)
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
      const m = new THREE.Mesh(g, mat)
      m.position.copy(pos)
      m.position.y = 0.6
      this.scene.add(m)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize()
      const speed = 3 + Math.random() * 2
      shards.push({ m, v: dir.multiplyScalar(speed), life: 0.3 })
    }
    const tick = () => {
      const dt = 1 / 60
      let alive = false
      for (const s of shards) {
        if (s.life <= 0) continue
        s.m.position.addScaledVector(s.v, dt)
        s.v.multiplyScalar(0.9)
        ;(s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / 0.3)
        s.life -= dt
        alive = alive || s.life > 0
      }
      if (alive) requestAnimationFrame(tick)
      else for (const s of shards) this.scene.remove(s.m)
    }
    tick()
  }

  private updateLasso() {
    const curr = this.player.group.position.clone()
    curr.y = 0
    if (curr.distanceToSquared(this.lassoLastPoint) > this.lassoPointGap * this.lassoPointGap) {
      this.lassoPoints.push({ p: curr.clone(), t: this.gameTime })
      this.lassoLastPoint.copy(curr)
      if (this.lassoPoints.length > this.lassoMaxPoints) this.lassoPoints.shift()
      // expire old points
      while (this.lassoPoints.length && (this.gameTime - this.lassoPoints[0].t) > this.lassoDuration) this.lassoPoints.shift()
      // update tube mesh
      if (this.lassoMesh) {
        const positions = this.lassoPoints.map(q => q.p.clone().setY(0.02))
        if (positions.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(positions)
          const tube = new THREE.TubeGeometry(curve, Math.max(10, positions.length * 2), 0.065, 6, false)
          this.lassoMesh.geometry.dispose()
          this.lassoMesh.geometry = tube
          const nearExpire = this.lassoPoints.length > 0 && (this.gameTime - this.lassoPoints[0].t) > (this.lassoDuration - this.lassoFlashThreshold)
          const mat = this.lassoMesh.material as THREE.MeshBasicMaterial
          mat.opacity = nearExpire ? 0.45 + 0.35 * (Math.sin(this.gameTime * 10) * 0.5 + 0.5) : 0.9
        } else {
          const a = this.player.group.position.clone()
          const b = this.player.group.position.clone().add(new THREE.Vector3(0.05, 0, 0.05))
          const empty = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, b]), 2, 0.065, 6, false)
          this.lassoMesh.geometry.dispose()
          this.lassoMesh.geometry = empty
        }
      }
      // loop detection
      const n = this.lassoPoints.length
      if (n > this.lassoMinLoopPoints) {
        const end = this.lassoPoints[n - 1].p
        for (let i = 0; i < n - this.lassoMinLoopPoints; i++) {
          if (end.distanceToSquared(this.lassoPoints[i].p) < this.lassoCloseDist * this.lassoCloseDist) {
            // Closed loop from i..n-1
            const poly = this.lassoPoints.slice(i).map(q => q.p)
            this.damageInsidePolygon(poly)
            // clear
            this.lassoPoints.length = 0
            if (this.lassoMesh) {
              const a = this.player.group.position.clone()
              const b = this.player.group.position.clone().add(new THREE.Vector3(0.05, 0, 0.05))
              this.lassoMesh.geometry.dispose()
              this.lassoMesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, b]), 2, 0.065, 6, false)
            }
            break
          }
        }
      }
    }
  }

  private damageInsidePolygon(poly: THREE.Vector3[]) {
    const pts = poly.map(p => ({ x: p.x, z: p.z }))
    const inside = (x: number, z: number) => {
      let c = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, zi = pts[i].z
        const xj = pts[j].x, zj = pts[j].z
        const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi + 1e-6) + xi)
        if (intersect) c = !c
      }
      return c
    }
    for (const e of this.enemies) {
      if (!e.alive) continue
      const p = e.mesh.position
      if (inside(p.x, p.z)) {
        e.hp -= this.lassoDamage
        if (e.hp <= 0) {
          e.alive = false
          this.spawnExplosion(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.onEnemyDown()
          this.score += 1
          this.updateHud()
          this.spawnXP(e.mesh.position.clone())
        } else {
          this.audio.playImpact()
        }
      }
    }
  }

  private levelUpLasso() {
    if (!this.hasLasso) return
    this.lassoLevel += 1
    this.lassoDuration = Math.min(12, this.lassoDuration + 2)
    this.lassoDamage += 2
  }

  private levelUpBeam() {
    if (!this.crtBeam) return
    this.crtBeamLength += 1
    this.crtBeamDps += 2
    this.crtBeamOffDuration = Math.max(0.5, this.crtBeamOffDuration - 0.1)
    ;(this.crtBeam.geometry as THREE.PlaneGeometry).dispose?.()
    this.crtBeam.geometry = new THREE.PlaneGeometry(this.crtBeamLength, 0.35)
    this.crtBeam.position.set(0, 0.2, this.crtBeamLength / 2)
    if (this.crtBeamGlow) {
      this.crtBeamGlow.geometry.dispose?.()
      this.crtBeamGlow.geometry = new THREE.PlaneGeometry(this.crtBeamLength, 0.7)
      this.crtBeamGlow.position.set(0, 0.19, this.crtBeamLength / 2)
    }
  }

  private levelUpShield() {
    if (!this.shieldMesh) return
    this.shieldLength += 1
    this.shieldWidth += 0.2
    this.shieldOnDuration = Math.min(2.0, this.shieldOnDuration + 0.15)
    ;(this.shieldMesh.geometry as THREE.PlaneGeometry).dispose?.()
    this.shieldMesh.geometry = new THREE.PlaneGeometry(this.shieldWidth, this.shieldLength)
    this.shieldMesh.position.set(0, 0.15, this.shieldLength / 2)
  }

  private levelUpBurst() {
    this.modemWaveRadius = Math.min(6.5, this.modemWaveRadius + 0.6)
    this.modemWaveInterval = Math.max(1.3, this.modemWaveInterval - 0.2)
    this.modemWaveDamage += 1
  }

  private levelUpRocket() {
    this.rocketDamage += 1
    this.rocketSpeed += 1
    this.rocketTurn = Math.min(0.35, this.rocketTurn + 0.03)
  }

  private levelUpDotMatrix() {
    this.sideBulletDamageMultiplier = Math.min(2.0, this.sideBulletDamageMultiplier + 0.2)
  }

  private levelUpWhirl() {
    this.whirlRadius = Math.min(3.2, this.whirlRadius + 0.25)
    this.whirlDamage += 4
  }

  private async submitLeaderboard(name: string, timeSurvived: number, score: number) {
    try {
      await fetch('/.netlify/functions/leaderboard-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, timeSurvived, score })
      })
    } catch {}
  }

  private async refreshLeaderboard() {
    try {
      const res = await fetch('/.netlify/functions/leaderboard-top')
      const data = await res.json()
      const list = this.overlay.querySelector('#lb-list') as HTMLDivElement
      if (!list) return
      const entries = (data?.entries ?? []) as { name: string; timeSurvived: number; score: number }[]
      list.innerHTML = entries.map((e: any, i: number) => `
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <span>${String(i + 1).padStart(2, '0')}. ${escapeHtml(e.name ?? '')}</span>
          <span>${(e.timeSurvived ?? 0)}s • ${e.score ?? 0}</span>
        </div>
      `).join('') || '<div class="carddesc">No entries yet</div>'
    } catch {
      // Fallback: nothing
    }
  }
}

function escapeHtml(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function runGame() {
  const root = document.querySelector<HTMLDivElement>('#app')!
  root.innerHTML = ''
  new Game(root)
}
