import * as THREE from 'three'
// Bundled raw changelog text (Vite)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import changelogRaw from '../CHANGELOG.md?raw'
import { AudioManager } from './audio'
import type { ThemeKey } from './audio'

type Vector2 = { x: number; y: number }

type EnemyType =
  | 'slime'
  | 'runner'
  | 'zigzag'
  | 'tank'
  | 'shooter'
  | 'giant'
  // Upstream unique enemies
  | 'spinner'
  | 'splitter'
  | 'bomber'
  | 'sniper'
  | 'weaver'
  // New advanced enemies for waves 6–10
  | 'charger'   // bursts toward player after brief windup
  | 'orbiter'   // strong strafe around player with inward pressure
  | 'teleport'  // periodically teleports near player
  | 'brute'     // slow heavy with short rushes

class InputManager {
  axesLeft: Vector2 = { x: 0, y: 0 }
  axesRight: Vector2 = { x: 0, y: 0 }
  keys: Record<string, boolean> = {}
  mouse: Vector2 = { x: 0, y: 0 }
  mouseDown = false
  private gamepadIndex: number | null = null
  private lastMouseMove = 0
  private lastTouch = 0

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
      this.lastMouseMove = performance.now()
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
    const gpLX = dz(gp.axes[0] ?? 0)
    const gpLY = dz(gp.axes[1] ?? 0)
    const gpRX = dz(gp.axes[2] ?? 0)
    const gpRY = dz(gp.axes[3] ?? 0)
    const touchRecent = this.hasRecentTouch()
    // Left stick: if gamepad has input, use it; otherwise keep touch if recent, else zero
    if (gpLX !== 0 || gpLY !== 0) {
      this.axesLeft.x = gpLX; this.axesLeft.y = gpLY
    } else if (!touchRecent) {
      this.axesLeft.x = 0; this.axesLeft.y = 0
    }
    // Right stick: same logic
    if (gpRX !== 0 || gpRY !== 0) {
      this.axesRight.x = gpRX; this.axesRight.y = gpRY
    } else if (!touchRecent) {
      this.axesRight.x = 0; this.axesRight.y = 0
    }
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

  hasRecentMouseMove(thresholdMs = 1500): boolean {
    return performance.now() - this.lastMouseMove < thresholdMs
  }

  markTouch() { this.lastTouch = performance.now() }
  hasRecentTouch(thresholdMs = 2000): boolean { return performance.now() - this.lastTouch < thresholdMs }
}

class TouchControls {
  private leftId: number | null = null
  private rightId: number | null = null
  private leftStart = { x: 0, y: 0 }
  private rightStart = { x: 0, y: 0 }
  private radius = 70
  private leftEl: HTMLDivElement
  private rightEl: HTMLDivElement

  constructor(_: HTMLCanvasElement, private input: InputManager, private isEnabled: () => boolean) {
    // Only enable on touch-capable (coarse pointer) screens
    const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
    if (!coarse) {
      // Create hidden anchors so CSS does not shift
      this.leftEl = document.createElement('div'); this.rightEl = document.createElement('div')
      return
    }
    this.leftEl = document.createElement('div')
    this.leftEl.id = 'touch-left'
    this.rightEl = document.createElement('div')
    this.rightEl.id = 'touch-right'
    document.body.appendChild(this.leftEl)
    document.body.appendChild(this.rightEl)

    const onStart = (e: TouchEvent) => {
      // Allow UI interactions (pause button, overlays) to receive taps normally
      const target = e.target as HTMLElement | null
      if (target && (target.closest('#touch-pause') || target.closest('.overlay'))) return
      if (!this.isEnabled()) return
      this.input.markTouch()
      for (const t of Array.from(e.changedTouches)) {
        const isLeft = t.clientX < window.innerWidth * 0.5
        if (isLeft && this.leftId == null) {
          this.leftId = t.identifier
          this.leftStart = { x: t.clientX, y: t.clientY }
          this.leftEl.style.display = 'block'
          this.leftEl.style.left = `${this.leftStart.x - 60}px`
          this.leftEl.style.top = `${this.leftStart.y - 60}px`
        } else if (!isLeft && this.rightId == null) {
          this.rightId = t.identifier
          this.rightStart = { x: t.clientX, y: t.clientY }
          this.rightEl.style.display = 'block'
          this.rightEl.style.left = `${this.rightStart.x - 60}px`
          this.rightEl.style.top = `${this.rightStart.y - 60}px`
          this.input.mouseDown = true
        }
      }
      e.preventDefault()
    }
    const onMove = (e: TouchEvent) => {
      // Do not interfere with UI drags on overlays/buttons
      const target = e.target as HTMLElement | null
      if (target && (target.closest('#touch-pause') || target.closest('.overlay'))) return
      if (!this.isEnabled()) {
        this.leftEl.style.display = 'none'; this.rightEl.style.display = 'none'
        this.leftId = this.rightId = null
        this.input.axesLeft.x = this.input.axesLeft.y = 0
        this.input.axesRight.x = this.input.axesRight.y = 0
        this.input.mouseDown = false
        return
      }
      this.input.markTouch()
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.leftId) {
          const dx = t.clientX - this.leftStart.x
          const dy = t.clientY - this.leftStart.y
          const nx = Math.max(-1, Math.min(1, dx / this.radius))
          const ny = Math.max(-1, Math.min(1, dy / this.radius))
          this.input.axesLeft.x = nx
          this.input.axesLeft.y = ny
        } else if (t.identifier === this.rightId) {
          const dx = t.clientX - this.rightStart.x
          const dy = t.clientY - this.rightStart.y
          const nx = Math.max(-1, Math.min(1, dx / this.radius))
          const ny = Math.max(-1, Math.min(1, dy / this.radius))
          this.input.axesRight.x = nx
          this.input.axesRight.y = ny
          // treat as firing when aiming with touch
          this.input.mouseDown = true
        }
      }
      e.preventDefault()
    }
    const onEnd = (e: TouchEvent) => {
      let handled = false
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.leftId) {
          this.leftId = null
          this.leftEl.style.display = 'none'
          this.input.axesLeft.x = 0; this.input.axesLeft.y = 0
          handled = true
        } else if (t.identifier === this.rightId) {
          this.rightId = null
          this.rightEl.style.display = 'none'
          this.input.axesRight.x = 0; this.input.axesRight.y = 0
          this.input.mouseDown = false
          handled = true
        }
      }
      // Only prevent default if we actually handled a virtual stick
      if (handled) e.preventDefault()
    }
    window.addEventListener('touchstart', onStart, { passive: false })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: false })
    window.addEventListener('touchcancel', onEnd, { passive: false })
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
    kind?: 'rocket' | 'side' | 'bullet'
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
  // Subtle anti-clump hesitation behavior
  hesitateState?: 'moving' | 'decel' | 'paused' | 'accel'
  hesitateTimer?: number
  hesitateDur?: number
  nextHesitateAt?: number
  speedScale?: number
  // Wave index (minute) when this enemy spawned
  spawnWave: number
  // Optional behavior state for AI patterns like run/pause cycles
  behaviorState?: 'running' | 'paused' | 'windup' | 'dash' | 'recover' | 'orbit' | 'slamWindup' | 'slam'
  behaviorTimer?: number
  behaviorRunDuration?: number
  behaviorPauseDuration?: number
  // Jeeves wall-climb behavior
  canClimb?: boolean
  climbState?: 'ground' | 'ascending' | 'onTop' | 'descending'
  climbUntil?: number
  climbTargetY?: number
  // Shooter-specific: 50% chance to be aggressive (charge player)
  shooterAggressive?: boolean
  // Bomber flank behavior
  bomberPhase?: 'flank' | 'dash'
  bomberTargetAngle?: number
  // Generic AI helpers
  baseSpeed?: number
  behaviorPhase?: 1 | -1
  dashRemaining?: number
  orbitDir?: 1 | -1
  nextTeleportTime?: number
  // Temporary slow from Dial-up Burst
  burstSlowUntil?: number
  burstSlowFactor?: number
  // Effect throttles
  nextWhirlFxTime?: number
  // Visibility tracking for offscreen culling
  lastOnscreenAt?: number
  // Visual feedback
  baseColorHex?: number
  hitTintUntil?: number
  hitTintColor?: number
  faceOuchUntil?: number
  nextDmgToastTime?: number
  // Special behaviors
  booWave10?: boolean
  booShy?: boolean
  eliteAggressive?: boolean
  // Giant enrage
  giantEnrageUntil?: number
  recentHits?: number
  lastHitAt?: number
  // Brute slam
  nextSlamAt?: number
  slamWindupUntil?: number
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

type Theme = 'default' | 'geocities' | 'yahoo' | 'dialup' | 'jeeves'

class Game {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  isoPivot: THREE.Group
  frameId = 0
  // WebGL context tracking
  contextLost = false
  // Small fullscreen button
  fullscreenBtn?: HTMLButtonElement
  optionsFab?: HTMLButtonElement
  changelogFab?: HTMLButtonElement
  // Debug toggles/overlay
  debugPerfOverlay = false
  // Debug mode: Kernel Panic
  kernelPanic = false
  plentifulPickups = true
  perfOverlayEl?: HTMLDivElement
  perfOverlayNextUpdate = 0
  pauseDebounceUntil = 0
  // Pools and shared resources
  paintDiskPool: THREE.Mesh[] = []
  sharedPaintGeom = new THREE.CircleGeometry(1, 22)
  sharedPaintMat = new THREE.MeshBasicMaterial({ color: 0x2c826e, transparent: false, opacity: 1, side: THREE.DoubleSide })
  shardPool: THREE.Mesh[] = []
  sharedShardGeom = new THREE.BoxGeometry(0.15, 0.15, 0.15)
  sharedBulletGeom = new THREE.SphereGeometry(0.14, 10, 10)
  sharedBulletMat = new THREE.MeshBasicMaterial({ color: 0xffff66 })
  sharedSideBulletGeom = new THREE.SphereGeometry(0.12, 8, 8)
  sharedSideBulletMat = new THREE.MeshBasicMaterial({ color: 0x99ddff })
  sharedRocketGeom = new THREE.ConeGeometry(0.18, 0.6, 10)
  sharedRocketMat = new THREE.MeshBasicMaterial({ color: 0xff8844 })
  sharedXPGeom = new THREE.BoxGeometry(0.25, 0.25, 0.25)
  sharedXPOrbMat = new THREE.MeshBasicMaterial({ color: 0x66ff88 })
  sharedXPCubeGeom = new THREE.BoxGeometry(0.42, 0.42, 0.42)
  sharedXPCubeMat = new THREE.MeshBasicMaterial({ color: 0xb388ff })
  // XP tier materials
  sharedXPTier3Mat = new THREE.MeshBasicMaterial({ color: 0xb388ff })
  sharedXPTier5Mat = new THREE.MeshBasicMaterial({ color: 0xffaa66 })
  sharedXPTier10Mat = new THREE.MeshBasicMaterial({ color: 0x6699ff })
  sharedXPTier20Mat = new THREE.MeshBasicMaterial({ color: 0xff66cc })
  sharedXPTier50Mat = new THREE.MeshBasicMaterial({ color: 0xffdd55 })
  sharedVacuumGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5)
  sharedVacuumMat = new THREE.MeshBasicMaterial({ color: 0x2266ff })
  projectilePool: Projectile[] = []
  // Lasso update throttle
  lassoNextGeomAt = 0

  private disposeObjectDeep(obj: THREE.Object3D) {
    obj.traverse((node: any) => {
      const mesh = node as THREE.Mesh
      const mat = mesh.material as any
      if (mesh.geometry) {
        mesh.geometry.dispose?.()
      }
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m.map) m.map.dispose?.()
          m.dispose?.()
        }
      } else if (mat) {
        if (mat.map) mat.map.dispose?.()
        mat.dispose?.()
      }
    })
  }

  private onEnemyDamaged(e: Enemy, _amount: number) {
    // Brief, low-cost tint
    e.hitTintColor = ((e.baseColorHex ?? 0xffffff) & 0xf0f0f0) >>> 0
    e.hitTintUntil = this.gameTime + 0.06
    // Giant enrage: track rapid hits
    if (e.type === 'giant') {
      if ((e.lastHitAt ?? -999) < this.gameTime - 1.0) e.recentHits = 0
      e.recentHits = (e.recentHits ?? 0) + 1
      e.lastHitAt = this.gameTime
      if (e.recentHits >= 3) e.giantEnrageUntil = this.gameTime + 3.0
    }
  }
  // Temp vectors for projections
  _tmpProj = new THREE.Vector3()
  _frustum = new THREE.Frustum()
  _frustumMat = new THREE.Matrix4()
  // Spatial hash for enemies (rebuilt each frame before projectile checks)
  spatialCellSize = 4.0
  spatialMap: Map<string, Enemy[]> = new Map()
  // Simple pools to reduce allocations
  poolRings: THREE.Mesh[] = []
  poolQuads: THREE.Mesh[] = []
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
  modemWavePulses = 1
  modemWavePulseGap = 0.18
  burstLevel = 0
  rocketInterval = 1.8
  rocketTimer = 0
  rocketSpeed = 3.5
  rocketTurn = 0.15
  rocketDamage = 3
  rocketLevel = 0
  rocketBlastRadius = 2.6
  xpMagnetRadius = 2.0
  modemWaveDamage = 5
  // Global XP vacuum effect
  vacuumActive = false
  vacuumEndTime = 0
  vacuumPull = 12
  // Level-up magnet tail (real-time ms)
  levelUpTailUntilMs = 0
  // SFX throttling to avoid audio spam and perf spikes
  lastImpactSfxMs = 0
  impactSfxIntervalMs = 60
  // Spawn/ent caps and debug
  maxEnemies = 400
  debugLogTimer = 0
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
  whirlLevel = 0
  whirlOn = true
  whirlOnDuration = 1.2
  whirlOffDuration = 0.8
  whirlTimer = 0
  // Sata Cable Tail
  sataTailGroup?: THREE.Group
  sataTailSegments: THREE.Mesh[] = []
  sataTailLength = 2.0
  sataTailDps = 20
  sataTailAmp = 0.18
  sataTailFreq = 8.0
  sataTailLevel = 0
  // Wave management
  lastWaveMinute = -1
  waveCullDelaySeconds = 2
  waveCullKeepFraction = 0.03
  maxActiveEnemies = 1000
  aliveEnemies = 0
  // Offscreen cull policy for older waves
  offscreenCullSeconds = 2.5
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
  // Paint.exe
  paintLevel = 0
  paintOn = true
  paintOnDuration = 0.7
  paintOffDuration = 1.3
  paintTimer = 0
  paintDps = 10
  paintDuration = 1.3
  paintGap = 0.35
  paintRadius = 1.38
  paintSwaths: { pos: THREE.Vector3; t: number; mesh: THREE.Mesh; radius: number }[] = []
  lastPaintPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN)
  score = 0
  lastTime = performance.now()
  gameTime = 0
  spawnAccumulator = 0
  // Spawn cadence modulation
  spawnPhase = Math.random() * Math.PI * 2
  microBurstLeft = 0
  hud: HTMLDivElement
  hpBar!: HTMLDivElement
  inventory!: HTMLDivElement
  overlay: HTMLDivElement
  pauseOverlay: HTMLDivElement
  titleOverlay: HTMLDivElement
  changelogOverlay: HTMLDivElement
    debugOverlay?: HTMLDivElement
  // Alt Title state
  altTitleActive = false
  altTitleGroup?: THREE.Group
  altFloppies: { mesh: THREE.Mesh; label: 'START' | 'DAILY' | 'DEBUG' | 'BOARD'; target: THREE.Vector3; targetRot: number; floatPhase?: number }[] = []
  altDriveMesh?: THREE.Mesh
  altNavCooldown = 0
  altInsertAnim?: { m: THREE.Mesh; t: number; dur: number; start: THREE.Vector3; end: THREE.Vector3; startR: number; endR: number; startRX: number; endRX: number; onDone: () => void }
  altEnterDebounceUntil = 0
  altBgMesh?: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
	altHiddenDom?: HTMLElement[]
	altTouchOnDown?: (e: PointerEvent) => void
	altTouchOnMove?: (e: PointerEvent) => void
	altTouchOnUp?: (e: PointerEvent) => void
	altSwipeStartX = 0
	altSwipeActive = false
	altLayer = 1
	altPrevTouchAction?: string
	altHiddenScene?: { ground: boolean; player: boolean; bills: boolean[] }
  altPrevIsoRot?: THREE.Euler
  altPrevIsoPos?: THREE.Vector3
  altIntroAnims?: { m: THREE.Mesh; t: number; dur: number; startRX: number; endRX: number }[]
  altSelectDance?: { m: THREE.Mesh; t: number; dur: number; startScale: number; startRZ: number; makeInsert: () => void }
  altTapStartTime = 0
  altSwipeDidCycle = false
  altDragging = false
  altDragDX = 0
  altDragStartTime = 0

	private disposeAltBg() {
		const bg = this.altBgMesh as (THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>) | undefined
		if (!bg) return
		this.scene.remove(bg)
		;(bg.geometry as THREE.BufferGeometry).dispose()
		const matAny = bg.material as (THREE.Material | THREE.Material[])
		if (Array.isArray(matAny)) matAny.forEach((m) => m.dispose())
		else matAny.dispose()
		this.altBgMesh = undefined
	}

	private removeAllAltBgPlanes() {
		try {
			const children = [...this.scene.children]
			for (const c of children) {
				if ((c as any)?.name === 'alt-bg-plane') {
					this.scene.remove(c as any)
					try { (c as any).geometry?.dispose?.() } catch {}
					const matAny = (c as any).material
					if (Array.isArray(matAny)) matAny.forEach((m: any) => m?.dispose?.())
					else matAny?.dispose?.()
				}
			}
		} catch {}
	}
  // Title art element reference (static for now)
  titleImgEl?: HTMLImageElement
  autoFire = true
  hitCount = 0
  hitCounterEl!: HTMLDivElement
  // Pending level-ups to resolve sequentially
  pendingLevelUps = 0
  // Debug toggles
  debugShowDamage = false

  private makeHorseshoeMagnet(): THREE.Object3D {
    const group = new THREE.Group()
    const legGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12)
    const mat = new THREE.MeshBasicMaterial({ color: 0x2266ff })
    const left = new THREE.Mesh(legGeom, mat)
    const right = new THREE.Mesh(legGeom, mat)
    left.position.set(-0.18, 0.3, 0)
    right.position.set(0.18, 0.3, 0)
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.08, 8, 24, Math.PI), mat)
    arc.rotation.set(Math.PI / 2, 0, 0)
    arc.position.set(0, 0.6, 0)
    group.add(left, right, arc)
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xdddddd })
    const tipGeom = new THREE.CylinderGeometry(0.085, 0.085, 0.08, 10)
    const t1 = new THREE.Mesh(tipGeom, tipMat); t1.position.copy(left.position).setY(0.04)
    const t2 = new THREE.Mesh(tipGeom, tipMat); t2.position.copy(right.position).setY(0.04)
    group.add(t1, t2)
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), new THREE.MeshBasicMaterial({ visible: false }))
    shell.add(group)
    return shell
  }

  private showJeevesEditor() {
    if (!this.debugOverlay) return
    const wrap = document.createElement('div')
    wrap.className = 'card'
    wrap.classList.add('debug-panel')
    wrap.style.minWidth = '520px'
    wrap.style.maxWidth = '80vw'
    wrap.style.maxHeight = '80vh'
    wrap.style.display = 'flex'
    ;(wrap.style as any).flexDirection = 'column'
    wrap.style.overflow = 'hidden'

    const title = document.createElement('strong')
    title.textContent = 'Jeeves Maze Editor'
    const info = document.createElement('div'); info.className = 'carddesc'; info.textContent = 'Toggle cells to place/remove blocks. Grid snap = 3.'

    // Presets row: built-ins + saved
    const presetRow = document.createElement('div')
    presetRow.className = 'cardrow'
    const presetLab = document.createElement('span'); presetLab.textContent = 'Preset:'
    presetLab.style.minWidth = '54px'
    const presetSel = document.createElement('select'); (presetSel as any).style.padding = '2px 6px'; (presetSel as any).style.fontSize = '12px'
    const saveBtn = document.createElement('button'); saveBtn.className = 'card'; saveBtn.textContent = 'Save…'; saveBtn.style.padding = '2px 6px'; saveBtn.style.fontSize = '12px'
    presetRow.append(presetLab, presetSel, saveBtn)

    type CellCoord = { x: number, z: number }
    const builtin: Record<string, CellCoord[]> = (() => {
      const list: Record<string, CellCoord[]> = {}
      const toMap = (fn: (x: number, z: number) => boolean) => {
        const out: CellCoord[] = []
        for (let z = -24; z <= 24; z += 3) for (let x = -24; x <= 24; x += 3) if (fn(x, z)) out.push({ x, z })
        return out
      }
      list['Empty'] = []
      list['Cross'] = toMap((x, z) => Math.abs(x) < 1 || Math.abs(z) < 1)
      list['Ring'] = toMap((x, z) => (Math.abs(x) === 24 || Math.abs(z) === 24))
      list['Corridors'] = toMap((x, z) => (x % 12 === 0) || (z % 12 === 0))
      list['Checker'] = toMap((x, z) => ((x + z) / 3) % 2 === 0)
      return list
    })()

    const savedKey = 'jeeves.presets'
    const loadSaved = (): Record<string, CellCoord[]> => {
      try { return JSON.parse(localStorage.getItem(savedKey) || '{}') } catch { return {} }
    }
    const savePreset = (name: string, coords: CellCoord[]) => {
      const all = loadSaved(); all[name] = coords; localStorage.setItem(savedKey, JSON.stringify(all))
    }
    const refreshOptions = () => {
      presetSel.innerHTML = ''
      const all = { ...builtin, ...loadSaved() }
      Object.keys(all).forEach(name => { const opt = document.createElement('option'); opt.value = name; opt.textContent = name; presetSel.appendChild(opt) })
    }
    const applyPresetToGrid = (coords: CellCoord[]) => {
      const set = new Set(coords.map(c => `${c.x},${c.z}`))
      for (const b of cells) {
        const key = `${(b as any).__x},${(b as any).__z}`
        const setState = (active: boolean) => { b.style.background = active ? '#b07d3b' : '#2b2f3a'; (b as any).__active = active }
        setState(set.has(key))
      }
    }
    saveBtn.onclick = async () => {
      const name = prompt('Save preset as:')?.trim()
      if (!name) return
      const coords: CellCoord[] = []
      cells.forEach(c => { if ((c as any).__active) coords.push({ x: (c as any).__x, z: (c as any).__z }) })
      savePreset(name, coords)
      refreshOptions()
      presetSel.value = name
      // Optional: try Netlify Function if present
      try { await fetch('/.netlify/functions/jeeves-presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, coords }) }) } catch {}
      // Re-pull remote list to merge new entry
      try {
        const res = await fetch('/.netlify/functions/jeeves-presets')
        if (res.ok) {
          const data = await res.json()
          const remote: Record<string, CellCoord[]> = data?.presets || {}
          const saved = loadSaved()
          for (const k of Object.keys(remote)) if (!saved[k]) saved[k] = remote[k]
          localStorage.setItem(savedKey, JSON.stringify(saved))
          refreshOptions()
        }
      } catch {}

    }
    presetSel.onchange = () => {
      const all = { ...builtin, ...loadSaved() }
      const coords = all[presetSel.value] || []
      applyPresetToGrid(coords)
    }
    refreshOptions()
    // Attempt to load remote presets on open
    ;(async () => {
      try {
        const res = await fetch('/.netlify/functions/jeeves-presets')
        if (res.ok) {
          const data = await res.json()
          const remote: Record<string, CellCoord[]> = data?.presets || {}
          const saved = loadSaved()
          for (const k of Object.keys(remote)) if (!saved[k]) saved[k] = remote[k]
          localStorage.setItem(savedKey, JSON.stringify(saved))
          refreshOptions()
        }
      } catch {}
    })()

    const gridEl = document.createElement('div')
    gridEl.style.display = 'grid'
    ;(gridEl.style as any).gridTemplateColumns = 'repeat(17, 16px)'
    gridEl.style.gap = '2px'
    gridEl.style.marginTop = '6px'
    const cells: HTMLButtonElement[] = []
    const minG = -24, maxG = 24, stepG = 3
    const on = new Set(this.debugJeevesLayout.map(c => `${c.x},${c.z}`))
    for (let z = minG; z <= maxG; z += stepG) {
      for (let x = minG; x <= maxG; x += stepG) {
        const b = document.createElement('button') as HTMLButtonElement
        b.className = 'ns-button'
        b.style.width = '16px'; b.style.height = '16px'; b.style.padding = '0'; b.style.borderRadius = '2px'
        const key = `${x},${z}`
        const setState = (active: boolean) => { b.style.background = active ? '#b07d3b' : '#2b2f3a'; (b as any).__active = active }
        setState(on.has(key))
        b.onclick = () => setState(!(b as any).__active)
        ;(b as any).__x = x; (b as any).__z = z
        cells.push(b); gridEl.appendChild(b)
      }
    }

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'; btnRow.style.justifyContent = 'space-between'; btnRow.style.gap = '8px'; btnRow.style.marginTop = '8px'
    const backBtn = document.createElement('button'); backBtn.className = 'card'; backBtn.textContent = 'Back'
    const applyBtn = document.createElement('button'); applyBtn.className = 'card'; applyBtn.textContent = 'Apply to Jeeves'
    btnRow.appendChild(backBtn); btnRow.appendChild(applyBtn)

    this.debugOverlay!.innerHTML = ''
    wrap.append(title, info, presetRow, gridEl, btnRow)
    this.debugOverlay!.appendChild(wrap)
    this.debugOverlay!.style.display = 'flex'

    backBtn.onclick = () => this.showDebugPanel()
    applyBtn.onclick = () => {
      const layout: { x: number; z: number }[] = []
      cells.forEach(c => { if ((c as any).__active) layout.push({ x: (c as any).__x, z: (c as any).__z }) })
      this.debugJeevesLayout = layout
      if (this.currentTheme !== 'jeeves') this.applyTheme('jeeves')
      // Ensure game can progress (spawn waves) after applying Jeeves via editor
      this.themeChosen = true
      for (const o of this.themeObstacles) this.scene.remove(o)
      this.themeObstacles = []
      this.themeObstacleCells.clear()
      const addBox = (x: number, z: number, c: number, s = 2) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, 1, s), new THREE.MeshBasicMaterial({ color: c }))
        m.position.set(x, 0.5, z)
        this.themeObstacles.push(m)
        this.scene.add(m)
        const cs = this.obstacleCellSize
        const key = `${Math.floor(x / cs)},${Math.floor(z / cs)}`
        const list = this.themeObstacleCells.get(key) || []
        list.push(m)
        this.themeObstacleCells.set(key, list)
      }
      for (const cell of this.debugJeevesLayout) addBox(cell.x, cell.z, 0x5a4a35, 4)
    }
  }

  private showWavesSubmenu() {
    if (!this.debugOverlay) return
    const wrap = document.createElement('div')
    wrap.className = 'card'
    wrap.classList.add('debug-panel')
    wrap.style.minWidth = '520px'
    wrap.style.maxWidth = '80vw'
    wrap.style.maxHeight = '80vh'
    wrap.style.display = 'flex'
    ;(wrap.style as any).flexDirection = 'column'
    wrap.style.overflow = 'hidden'

    const title = document.createElement('strong')
    title.textContent = 'Waves Order (drag to reorder)'

    const info = document.createElement('div')
    info.className = 'carddesc'
    info.textContent = 'Top is wave 1. Applies when "Use Custom Waves" is enabled.'

    const useRow = document.createElement('label')
    useRow.className = 'carddesc'
    useRow.style.display = 'flex'
    useRow.style.alignItems = 'center'
    useRow.style.gap = '8px'
    const useChk = document.createElement('input'); useChk.type = 'checkbox'; useChk.checked = this.debugUseWavePlan
    const useLab = document.createElement('span'); useLab.textContent = 'Use Custom Waves'
    useRow.appendChild(useChk); useRow.appendChild(useLab)

    const list = document.createElement('div')
    list.style.marginTop = '6px'
    list.style.display = 'grid'
    ;(list.style as any).gap = '4px'

    const enemyTypes: EnemyType[] = ['slime','runner','spinner','splitter','bomber','sniper','weaver','zigzag','tank','shooter','charger','orbiter','teleport','brute']
    const enemyColorHex: Partial<Record<EnemyType, number>> = {
      slime: 0xaa55ff,
      runner: 0xffdd55,
      spinner: 0x66e0ff,
      splitter: 0xffaa33,
      bomber: 0xcc4455,
      sniper: 0x44ffaa,
      weaver: 0xaa66ff,
      zigzag: 0x55ffaa,
      tank: 0xff6699,
      shooter: 0x66aaff,
      charger: 0xffaa33,
      orbiter: 0x33ddff,
      teleport: 0xcc66ff,
      brute: 0xdd3333,
      giant: 0xff44aa,
    }
    const current = this.debugWavePlan.length > 0 ? this.debugWavePlan.slice() : enemyTypes.slice(0, 15)
    while (current.length < 15) current.push(enemyTypes[0])
    while (current.length > 15) current.length = 15

    const makeItem = (name: EnemyType, idx: number) => {
      const row = document.createElement('button')
      row.className = 'card ns-button'
      row.draggable = true
      row.style.minHeight = '24px'
      row.style.padding = '2px 6px'
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.gap = '6px'
      row.type = 'button'
      const handle = document.createElement('span'); handle.textContent = '≡'; handle.style.cursor = 'grab'; handle.style.opacity = '0.7'
      const swatch = document.createElement('span'); swatch.style.display = 'inline-block'; swatch.style.width = '10px'; swatch.style.height = '10px'; swatch.style.border = '1px solid rgba(0,0,0,0.5)'; swatch.style.background = `#${(enemyColorHex[name] ?? 0x888888).toString(16).padStart(6,'0')}`
      const lab = document.createElement('span'); lab.textContent = `${idx + 1}. ${name}`
      row.appendChild(handle); row.appendChild(swatch); row.appendChild(lab)
      ;(row as any).__name = name
      return row
    }

    const render = () => {
      list.innerHTML = ''
      current.forEach((n, i) => list.appendChild(makeItem(n, i)))
    }

    let dragIndex = -1
    list.addEventListener('dragstart', (e: any) => {
      const el = e.target.closest('.card')
      if (!el) return
      dragIndex = Array.from(list.children).indexOf(el)
      e.dataTransfer.setData('text/plain', String(dragIndex))
    })
    list.addEventListener('dragover', (e) => { e.preventDefault() })
    list.addEventListener('drop', (e: any) => {
      e.preventDefault()
      const from = dragIndex
      const el = e.target.closest('.card')
      const to = el ? Array.from(list.children).indexOf(el) : -1
      if (from >= 0 && to >= 0 && from !== to) {
        const item = current.splice(from, 1)[0]
        current.splice(to, 0, item)
        render()
      }
      dragIndex = -1
    })

    render()

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'; btnRow.style.gap = '6px'; btnRow.style.marginTop = '6px'
    const resetBtn = document.createElement('button'); resetBtn.className = 'card'; resetBtn.textContent = 'Reset'
    resetBtn.style.padding = '4px 8px'; resetBtn.style.fontSize = '12px'
    const backBtn = document.createElement('button'); backBtn.className = 'card'; backBtn.textContent = 'Back'
    backBtn.style.padding = '4px 8px'; backBtn.style.fontSize = '12px'
    const saveBtn = document.createElement('button'); saveBtn.className = 'card'; saveBtn.textContent = 'Save'
    saveBtn.style.padding = '4px 8px'; saveBtn.style.fontSize = '12px'
    btnRow.appendChild(backBtn); btnRow.appendChild(resetBtn); btnRow.appendChild(saveBtn)

    const scroll = document.createElement('div')
    scroll.style.flex = '1 1 auto'
    scroll.style.overflow = 'auto'
    scroll.appendChild(list)

    const container = document.createElement('div')
    container.style.display = 'flex'
    ;(container.style as any).flexDirection = 'column'
    container.append(title, info, useRow, scroll, btnRow)

    this.debugOverlay!.innerHTML = ''
    this.debugOverlay!.appendChild(container)
    this.debugOverlay!.style.display = 'flex'
    this.debugOverlay!.style.pointerEvents = 'auto'

    backBtn.onclick = () => this.showDebugPanel()
    resetBtn.onclick = () => { current.splice(0, current.length, 'slime','runner','spinner','splitter','bomber','sniper','weaver','zigzag','tank','shooter','charger','orbiter','teleport','brute','slime'); render() }
    saveBtn.onclick = () => {
      this.debugUseWavePlan = useChk.checked
      this.debugWavePlan = current.slice()
      this.showDebugPanel()
    }
  }

  private showDebugPanel() {
    if (!this.debugOverlay) {
      this.debugOverlay = document.createElement('div') as HTMLDivElement
      this.debugOverlay.className = 'overlay'
      this.root.appendChild(this.debugOverlay)
    }
    const wrap = document.createElement('div')
    wrap.className = 'card'
    wrap.classList.add('debug-panel')
    wrap.style.minWidth = '540px'
    wrap.style.maxWidth = '80vw'
    wrap.style.maxHeight = '80vh'
    wrap.style.display = 'flex'
    ;(wrap.style as any).flexDirection = 'column'
    wrap.style.overflow = 'hidden'
    const title = document.createElement('strong')
    title.textContent = 'Debug Loadout'
    const info = document.createElement('div')
    info.className = 'carddesc'
    info.textContent = 'Toggle weapons/upgrades and set levels. Max 5 weapons and 5 upgrades.'
    const scroll = document.createElement('div')
    scroll.style.flex = '1 1 auto'
    scroll.style.overflow = 'auto'
    const form = document.createElement('div')
    form.style.display = 'grid'; form.style.gridTemplateColumns = '1fr 1fr'; form.style.gap = '6px'
    scroll.appendChild(form)
    // Jeeves Maze Editor moved to its own screen
    const jeevesBtn = document.createElement('button'); jeevesBtn.className = 'card'; jeevesBtn.textContent = 'Jeeves Maze Editor…'
    jeevesBtn.style.padding = '4px 8px'; jeevesBtn.style.fontSize = '12px'; jeevesBtn.style.marginTop = '6px'
    jeevesBtn.onclick = () => this.showJeevesEditor()
    scroll.appendChild(jeevesBtn)
    // Plentiful Pickups toggle
    const pickRow = document.createElement('div')
    pickRow.className = 'cardrow'
    const pickChk = document.createElement('input'); pickChk.type = 'checkbox'; pickChk.checked = this.plentifulPickups
    pickChk.onchange = () => { this.plentifulPickups = pickChk.checked }
    const pickLab = document.createElement('span'); pickLab.textContent = ' Plentiful Pickups (heal/magnet)'
    pickLab.style.marginLeft = '6px'
    pickRow.appendChild(pickChk); pickRow.appendChild(pickLab)
    wrap.appendChild(pickRow)
    const emojiMap: Record<string, string> = {
      'CRT Beam': '🔦',
      'Dot Matrix': '🖨️',
      'Dial-up Burst': '📞',
      'SCSI Rocket': '🚀',
      'Tape Whirl': '🧷',
      'Magic Lasso': '🪢',
      'Shield Wall': '🛡️',
      'Sata Cable Tail': '🪫',
      'Paint.exe': '🎨',
      'Turbo CPU': '⚡',
      'SCSI Splitter': '🔀',
      'Overclocked Bus': '🚌',
      'Copper Heatsink': '🧊',
      'ECC Memory': '💾',
      'DMA Burst': '💥',
      'Magnet Coil': '🧲',
      'Piercing ISA': '🗡️',
      'XP Amplifier': '📈',
    }
    const makeRow = (label: string, kind: 'weapon' | 'upgrade') => {
      const row = document.createElement('div')
      row.className = 'card dbg-row'
      row.style.padding = '4px'
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.justifyContent = 'space-between'
      const emoji = emojiMap[label] ?? '•'
      const name = document.createElement('div'); name.innerHTML = `<strong>${emoji} ${label}</strong>`
      const controls = document.createElement('div')
      controls.style.display = 'flex'; controls.style.gap = '6px'; controls.style.alignItems = 'center'
      const chk = document.createElement('input'); chk.type = 'checkbox'
      const lvl = document.createElement('input'); lvl.type = 'number'; (lvl as any).min = '1'; (lvl as any).max = '9'; (lvl as any).step = '1'; lvl.value = '1'; lvl.style.width = '52px'
      controls.appendChild(chk); controls.appendChild(document.createTextNode('Lv')); controls.appendChild(lvl)
      row.appendChild(name); row.appendChild(controls)
      ;(row as any).__kind = kind; (row as any).__name = label; (row as any).__chk = chk; (row as any).__lvl = lvl
      return row
    }
    const weapons = ['CRT Beam','Dot Matrix','Dial-up Burst','SCSI Rocket','Tape Whirl','Magic Lasso','Shield Wall','Sata Cable Tail','Paint.exe']
    const upgrades = ['Turbo CPU','SCSI Splitter','Overclocked Bus','Copper Heatsink','ECC Memory','DMA Burst','Magnet Coil','Piercing ISA','XP Amplifier']
    weapons.forEach(w => form.appendChild(makeRow(w, 'weapon')))
    upgrades.forEach(u => form.appendChild(makeRow(u, 'upgrade')))
    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'; btnRow.style.justifyContent = 'space-between'; btnRow.style.gap = '8px'; btnRow.style.marginTop = '12px'
    const backBtn = document.createElement('button'); backBtn.className = 'card'; backBtn.textContent = 'Back'
    backBtn.style.padding = '4px 8px'; backBtn.style.fontSize = '12px'
    const startBtn = document.createElement('button'); startBtn.className = 'card'; startBtn.textContent = 'Start with Loadout'
    startBtn.style.padding = '4px 8px'; startBtn.style.fontSize = '12px'
    btnRow.appendChild(backBtn); btnRow.appendChild(startBtn)
    this.debugOverlay!.innerHTML = ''
    this.debugOverlay!.appendChild(wrap)
    this.debugOverlay!.style.display = 'flex'; this.debugOverlay!.style.pointerEvents = 'auto'
    // B closes
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'b') backBtn.click() }
    window.addEventListener('keydown', onKey, { once: true })
    // Debug option: show damage toasts
    const dmgRow = document.createElement('div')
    dmgRow.className = 'cardrow'
    const dmgChk = document.createElement('input'); dmgChk.type = 'checkbox'; dmgChk.checked = this.debugShowDamage
    dmgChk.onchange = () => { this.debugShowDamage = dmgChk.checked }
    const dmgLab = document.createElement('span'); dmgLab.textContent = ' Show damage toasts over enemies'
    dmgLab.style.marginLeft = '6px'
    dmgRow.appendChild(dmgChk); dmgRow.appendChild(dmgLab)
    // Debug option: performance overlay toggle
    const perfRow = document.createElement('div')
    perfRow.className = 'cardrow'
    const perfChk = document.createElement('input'); perfChk.type = 'checkbox'; perfChk.checked = this.debugPerfOverlay
    perfChk.onchange = () => {
      this.debugPerfOverlay = perfChk.checked
      if (!this.debugPerfOverlay && this.perfOverlayEl) { this.perfOverlayEl.remove(); this.perfOverlayEl = undefined }
    }
    const perfLab = document.createElement('span'); perfLab.textContent = ' Show lightweight performance overlay'
    perfLab.style.marginLeft = '6px'
    perfRow.appendChild(perfChk); perfRow.appendChild(perfLab)

    // Group checkboxes together and place above buttons
    const toggles = document.createElement('div')
    toggles.className = 'card'
    toggles.style.display = 'grid'
    toggles.style.gap = '4px'
    toggles.style.padding = '4px 6px'
    toggles.appendChild(pickRow)
    toggles.appendChild(dmgRow)
    toggles.appendChild(perfRow)

    wrap.append(title, info, scroll, toggles, btnRow)

    // Waves submenu button
    const wavesBtn = document.createElement('button'); wavesBtn.className = 'card'; wavesBtn.innerHTML = 'Waves…'
    wavesBtn.onclick = () => this.showWavesSubmenu()
    wavesBtn.style.marginTop = '6px'
    wavesBtn.style.padding = '4px 8px'
    wavesBtn.style.fontSize = '12px'
    // Move Waves and Kernel Panic into bottom actions
    const kpRow = document.createElement('label') as HTMLLabelElement
    kpRow.style.display = 'inline-flex'; kpRow.style.alignItems = 'center'; kpRow.style.gap = '6px'
    kpRow.className = 'card'
    kpRow.style.padding = '4px 8px'
    kpRow.style.fontSize = '12px'
    const kpChk = document.createElement('input'); kpChk.type = 'checkbox'; kpChk.checked = this.kernelPanic
    const kpLab = document.createElement('span'); kpLab.textContent = 'Kernel Panic'
    kpRow.appendChild(kpChk); kpRow.appendChild(kpLab)
    kpChk.onchange = () => { this.kernelPanic = kpChk.checked; if (this.kernelPanic) this.plentifulPickups = false }
    wavesBtn.tabIndex = 0; kpRow.tabIndex = 0
    btnRow.insertBefore(wavesBtn, startBtn)
    btnRow.appendChild(kpRow)

    backBtn.onclick = () => { this.debugOverlay!.style.display = 'none' }
    // move focus to bottom buttons
    backBtn.tabIndex = 0; startBtn.tabIndex = 0
    startBtn.onclick = () => {
      // Collect selections
      const rows = Array.from(form.children) as any[]
      const selectedWeapons = rows.filter(r => r.__kind === 'weapon' && r.__chk.checked).map(r => ({ name: r.__name, lvl: Number(r.__lvl.value) || 1 }))
      const selectedUpgrades = rows.filter(r => r.__kind === 'upgrade' && r.__chk.checked).map(r => ({ name: r.__name, lvl: Number(r.__lvl.value) || 1 }))
      // Enforce caps
      if (selectedWeapons.length > this.maxWeapons) selectedWeapons.length = this.maxWeapons
      if (selectedUpgrades.length > this.maxUpgrades) selectedUpgrades.length = this.maxUpgrades
      // Start game
      this.titleOverlay.style.display = 'none'; this.showTitle = false
      this.audio.startMusic('default' as ThemeKey)
      // Apply loadout
      for (const w of selectedWeapons) {
        this.addWeapon(w.name)
        for (let i = 1; i < w.lvl; i++) {
          if (w.name === 'CRT Beam') this.levelUpBeam()
          else if (w.name === 'Dial-up Burst') this.levelUpBurst()
          else if (w.name === 'SCSI Rocket') this.levelUpRocket()
          else if (w.name === 'Dot Matrix') this.levelUpDotMatrix()
          else if (w.name === 'Tape Whirl') this.levelUpWhirl()
          else if (w.name === 'Magic Lasso') this.levelUpLasso()
          else if (w.name === 'Shield Wall') this.levelUpShield()
          else if (w.name === 'Sata Cable Tail') this.levelUpSataTail()
        }
      }
      for (const u of selectedUpgrades) {
        for (let i = 0; i < u.lvl; i++) {
          if (u.name === 'Turbo CPU') this.fireInterval = Math.max(0.06, this.fireInterval * 0.88)
          else if (u.name === 'SCSI Splitter') this.multishot = Math.min(6, this.multishot + 1)
          else if (u.name === 'Overclocked Bus') this.player.speed = Math.min(13, this.player.speed + 0.6)
          else if (u.name === 'Copper Heatsink') this.projectileDamage += 1
          else if (u.name === 'ECC Memory') { this.player.maxHp += 1; this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.ceil(this.player.maxHp * 0.5)); this.updateHPBar() }
          else if (u.name === 'DMA Burst') this.burstCount = Math.min(5, this.burstCount + 1)
          else if (u.name === 'Magnet Coil') this.xpMagnetRadius = Math.min(5, this.xpMagnetRadius + 0.7)
          else if (u.name === 'Piercing ISA') this.projectilePierce = Math.min(3, this.projectilePierce + 1)
          else if (u.name === 'XP Amplifier') {
            const lvl = (this.ownedUpgrades.get('XP Amplifier') ?? 0) + 1
            if (lvl <= 1) this.xpGainMultiplier = 1.2
            else if (lvl === 2) this.xpGainMultiplier = 3
            else this.xpGainMultiplier = Math.min(6, 1 + lvl * 1)
            this.ownedUpgrades.set('XP Amplifier', lvl)
          }
        }
        if (u.name !== 'XP Amplifier') this.ownedUpgrades.set(u.name, u.lvl)
      }
      this.updateInventoryUI()
      this.debugOverlay!.style.display = 'none'
    }
    // Controller navigation for Debug panel
    const focusables: (HTMLInputElement | HTMLButtonElement)[] = []
    const rows = Array.from(form.children) as HTMLDivElement[]
    for (const r of rows) {
      const chk = (r as any).__chk as HTMLInputElement
      const lvl = (r as any).__lvl as HTMLInputElement
      if (chk) focusables.push(chk)
      if (lvl) focusables.push(lvl)
    }
    focusables.push(backBtn as HTMLButtonElement, startBtn as HTMLButtonElement)
    let sel = 0
    // Smooth scroll helper
    const smoothScrollTo = (container: HTMLDivElement, to: number, duration = 240) => {
      const start = container.scrollTop
      const max = Math.max(0, container.scrollHeight - container.clientHeight)
      const target = Math.max(0, Math.min(max, to))
      const delta = target - start
      const t0 = performance.now()
      const ease = (t: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, t)))) / 2
      const step = () => {
        const t = (performance.now() - t0) / duration
        container.scrollTop = start + delta * ease(t)
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    const highlight = () => {
      // Clear row and element highlights
      rows.forEach((r) => r.classList.remove('selected'))
      for (const el of focusables) (el as HTMLElement).classList.remove('ui-selected')
      const el = focusables[sel]
      // Row background hint
      const row = el.closest('.card') as HTMLDivElement | null
      if (row) row.classList.add('selected')
      // Exact element highlight
      ;(el as HTMLElement).classList.add('ui-selected')
      // Ensure in view
      const container = scroll
      const elRect = (el as HTMLElement).getBoundingClientRect()
      const cRect = container.getBoundingClientRect()
      if (elRect.top < cRect.top + 8) {
        const offset = container.scrollTop + (elRect.top - cRect.top) - 8
        smoothScrollTo(container, offset)
      } else if (elRect.bottom > cRect.bottom - 8) {
        const offset = container.scrollTop + (elRect.bottom - cRect.bottom) + 8
        smoothScrollTo(container, offset)
      }
    }
    highlight()
    let prevLeft = false, prevRight = false, prevUp = false, prevDown = false, prevA = false, prevB = false
    const nav = () => {
      if (!this.debugOverlay || this.debugOverlay.style.display !== 'flex') return
      const pad = this.input.getActiveGamepad()
      const axX = pad ? (pad.axes?.[0] ?? 0) : 0
      const axY = pad ? (pad.axes?.[1] ?? 0) : 0
      const left = axX < -0.5 || !!pad?.buttons?.[14]?.pressed
      const right = axX > 0.5 || !!pad?.buttons?.[15]?.pressed
      const up = axY < -0.5 || !!pad?.buttons?.[12]?.pressed
      const down = axY > 0.5 || !!pad?.buttons?.[13]?.pressed
      const a = !!pad?.buttons?.[0]?.pressed
      const b = !!pad?.buttons?.[1]?.pressed
      const curr = focusables[sel]
      const isNum = curr instanceof HTMLInputElement && curr.type === 'number'
      const isChk = curr instanceof HTMLInputElement && curr.type === 'checkbox'
      const isBtn = curr instanceof HTMLButtonElement
      if (left && !prevLeft) { sel = (sel - 1 + focusables.length) % focusables.length; highlight() }
      if (right && !prevRight) { sel = (sel + 1) % focusables.length; highlight() }
      if (isNum) {
        if (up && !prevUp) { (curr as HTMLInputElement).stepUp(); }
        if (down && !prevDown) { (curr as HTMLInputElement).stepDown(); }
      } else {
        // Move vertically by 2 to traverse grid of rows; clamp within range
        if (up && !prevUp) { sel = Math.max(0, sel - 2); highlight() }
        if (down && !prevDown) { sel = Math.min(focusables.length - 1, sel + 2); highlight() }
      }
      if (a && !prevA) {
        if (isChk) (curr as HTMLInputElement).checked = !(curr as HTMLInputElement).checked
        else if (isBtn) (curr as HTMLButtonElement).click()
        else if (isNum) (curr as HTMLInputElement).stepUp()
      }
      if (b && !prevB) backBtn.click()
      prevLeft = left; prevRight = right; prevUp = up; prevDown = down; prevA = a; prevB = b
      requestAnimationFrame(nav)
    }
    requestAnimationFrame(nav)
  }
  hitCounterFlip = false
  submitLocked = false
  lastHudSeconds = -1
  showTitle = true
  xpBar: HTMLDivElement
  pauseTouchBtn!: HTMLButtonElement
  currentTheme: Theme = 'default'
  themeObstacles: THREE.Mesh[] = []
  // Spatial index for theme obstacles (used in Jeeves maze)
  themeObstacleCells: Map<string, THREE.Mesh[]> = new Map()
  obstacleCellSize = 2
  themeLocked = false
  themeChosen = false
  // Debug: custom obstacle layout for Jeeves (pixel-grid editor)
  debugJeevesLayout: { x: number; z: number }[] = []
  // Controller UI state
  uiSelectIndex = 0
  uiNavCooldown = 0
  uiConfirmPrev = false
  uiDpadPrevLeft = false
  uiDpadPrevRight = false
  uiDpadPrevUp = false
  uiDpadPrevDown = false
  uiStartPrev = false
  isPaused = false
  pausePrev = false
	// Pause overlay nav state (controller)
	pauseNavIdx = 0
	pauseNavPrevUp = false
	pauseNavPrevDown = false
	pauseNavPrevA = false
	pauseNavRaf = 0
  audio = new AudioManager()
  groundMesh!: THREE.Mesh
  groundTex?: THREE.CanvasTexture
  grid!: THREE.GridHelper
  billboardGeocities!: THREE.Object3D
  billboardYahoo!: THREE.Object3D
  billboardDialup!: THREE.Object3D
  ownedWeapons = new Set<string>()
  // Order that weapons were acquired (for shareable summary)
  weaponOrder: string[] = []
  // Representative enemy type per wave minute (for shareable summary)
  waveTypes: (EnemyType | undefined)[] = []
  // Share UI preview element reference
  private sharePreviewEl?: HTMLPreElement
  // Current share text (source of truth for copy/share)
  private lastShareText: string = ''
  // Last submitted payload snapshot
  private lastSubmittedInfo?: { name: string; timeSurvived: number; score: number }
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
    // Handle WebGL context loss/restoration to avoid permanent white/black screen
    const canvasEl = this.renderer.domElement
    canvasEl.addEventListener('webglcontextlost', (e: Event) => {
      e.preventDefault()
      this.contextLost = true
    })
    canvasEl.addEventListener('webglcontextrestored', () => {
      this.contextLost = false
      if (this.groundTex) this.groundTex.needsUpdate = true
    })

    this.grid = new THREE.GridHelper(200, 200, 0x334455, 0x223344)
    ;(this.grid.material as THREE.LineBasicMaterial).transparent = true
    ;(this.grid.material as THREE.LineBasicMaterial).opacity = 0.35
    this.scene.add(this.grid)

    this.billboardGeocities = this.makeBillboard('GEOCITIES', new THREE.Vector3(-6, 0.01, -6))
    this.billboardYahoo = this.makeBillboard('YAHOO DIR', new THREE.Vector3(8, 0.01, 4))
    this.billboardDialup = this.makeBillboard('DIAL-UP 56K', new THREE.Vector3(-10, 0.01, 10))
    ;(this as any).billboardJeeves = this.makeBillboard('JEEVES', new THREE.Vector3(12, 0.01, -12))
    this.scene.add(this.billboardGeocities, this.billboardYahoo, this.billboardDialup, (this as any).billboardJeeves)

    this.player.group.position.set(0, 0.6, 0)
    this.scene.add(this.player.group)

    this.hud = document.createElement('div') as HTMLDivElement
    this.hud.id = 'hud'
    this.root.appendChild(this.hud)

    // Small fullscreen button (bottom-right)
    const fsFab = document.createElement('button') as HTMLButtonElement
    fsFab.id = 'fs-fab'
    fsFab.title = 'Fullscreen'
    fsFab.textContent = '⛶'
    fsFab.style.position = 'fixed'
    fsFab.style.right = '12px'
    fsFab.style.bottom = '12px'
    fsFab.style.width = '34px'
    fsFab.style.height = '34px'
    fsFab.style.borderRadius = '8px'
    fsFab.style.background = 'rgba(20,28,44,0.9)'
    fsFab.style.color = '#9be3ff'
    fsFab.style.border = '1px solid #1f2a44'
    fsFab.style.font = '16px ui-monospace, monospace'
    fsFab.style.display = 'inline-flex'
    ;(fsFab.style as any).alignItems = 'center'
    ;(fsFab.style as any).justifyContent = 'center'
    fsFab.style.cursor = 'pointer'
    fsFab.style.zIndex = '40'
    fsFab.onclick = () => this.toggleFullscreen()
    this.root.appendChild(fsFab)
    this.fullscreenBtn = fsFab
    // Options and Changelog FABs (small) near fullscreen (only visible on title screen)
    const makeSmallFab = (label: string) => {
      const b = document.createElement('button') as HTMLButtonElement
      b.className = 'card'
      b.style.position = 'fixed'
      b.style.bottom = '12px'
      b.style.width = '34px'; b.style.height = '34px'; b.style.padding = '0'
      b.style.borderRadius = '8px'
      b.style.background = 'rgba(20,28,44,0.9)'
      b.style.color = '#9be3ff'
      b.style.border = '1px solid #1f2a44'
      b.style.font = '16px ui-monospace, monospace'
      b.style.display = 'inline-flex'; (b.style as any).alignItems = 'center'; (b.style as any).justifyContent = 'center'
      b.style.cursor = 'pointer'
      b.style.zIndex = '40'
      b.innerHTML = `<span style="line-height:16px">${label}</span>`
      b.style.display = 'none'
      this.root.appendChild(b)
      return b
    }
    this.optionsFab = makeSmallFab('⚙️'); this.optionsFab.style.right = '56px'
    this.changelogFab = makeSmallFab('🧾'); this.changelogFab.style.right = '100px'

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
    this.xpBar.innerHTML = '<div id="xpfill"></div><div id="xplabel" style="position:absolute; left:8px; top:50%; transform:translateY(-50%); font: 12px ui-monospace, monospace; color:#0b0; text-shadow:0 0 6px rgba(0,0,0,0.6)"></div><div id="levellabel" style="position:absolute; right:8px; top:50%; transform:translateY(-50%); font: 12px Tahoma, ui-sans-serif; color:#0b1020;"></div>'
    this.root.appendChild(this.xpBar)

    // 90s hit counter UI
    this.hitCounterEl = document.createElement('div') as HTMLDivElement
    this.hitCounterEl.id = 'hitcounter'
    this.root.appendChild(this.hitCounterEl)
    this.updateHitCounter()
    // Touch pause button (hidden by default)
    this.pauseTouchBtn = document.createElement('button') as HTMLButtonElement
    this.pauseTouchBtn.id = 'touch-pause'
    this.pauseTouchBtn.className = 'ns-button'
    this.pauseTouchBtn.textContent = 'Pause'
    this.pauseTouchBtn.style.display = 'none'
    this.pauseTouchBtn.onclick = () => this.togglePause()
    this.root.appendChild(this.pauseTouchBtn)
    // Flip label periodically for 90s flair
    setInterval(() => { this.hitCounterFlip = !this.hitCounterFlip; this.updateHitCounter() }, 1200)

    // Level-up overlay
    this.overlay = document.createElement('div') as HTMLDivElement
    this.overlay.className = 'overlay'
    this.root.appendChild(this.overlay)

    // Pause overlay
    this.pauseOverlay = document.createElement('div') as HTMLDivElement
    this.pauseOverlay.className = 'overlay'
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
          <label style="display:flex; align-items:center; gap:8px;">Auto-fire
            <input id="opt-autofire" type="checkbox" ${this.autoFire ? 'checked' : ''} />
            <span class="carddesc">Fire main weapon automatically</span>
          </label>
          <div class="carddesc" id="pause-debug" style="margin-top:6px; font-family: ui-monospace, monospace;"></div>
        </div>
      </div>
      <div class="pause-actions">
        <button id="btn-resume" class="card selected"><strong>Resume</strong></button>
        <button id="btn-restart" class="card"><strong>Restart</strong></button>
        <button id="btn-mainmenu" class="card"><strong>Main Menu</strong></button>
      </div>
    `
    this.root.appendChild(this.pauseOverlay)
    const hookSliders = () => {
      const vm = this.pauseOverlay.querySelector('#vol-master') as HTMLInputElement
      const vmu = this.pauseOverlay.querySelector('#vol-music') as HTMLInputElement
      const vs = this.pauseOverlay.querySelector('#vol-sfx') as HTMLInputElement
      const vmVal = this.pauseOverlay.querySelector('#vol-master-val') as HTMLSpanElement
      const vmuVal = this.pauseOverlay.querySelector('#vol-music-val') as HTMLSpanElement
      const vsVal = this.pauseOverlay.querySelector('#vol-sfx-val') as HTMLSpanElement
      const af = this.pauseOverlay.querySelector('#opt-autofire') as HTMLInputElement
      const resumeBtn = this.pauseOverlay.querySelector('#btn-resume') as HTMLButtonElement
      const restartBtn = this.pauseOverlay.querySelector('#btn-restart') as HTMLButtonElement
      const mainBtn = this.pauseOverlay.querySelector('#btn-mainmenu') as HTMLButtonElement
      const dbg = this.pauseOverlay.querySelector('#pause-debug') as HTMLDivElement
      // Add fullscreen button to pause actions
      const pauseActionsEl = this.pauseOverlay.querySelector('.pause-actions') as HTMLDivElement
      if (pauseActionsEl && !pauseActionsEl.querySelector('#btn-fullscreen')) {
        const fs = document.createElement('button') as HTMLButtonElement
        fs.id = 'btn-fullscreen'
        fs.className = 'card'
        fs.innerHTML = '<strong>Fullscreen</strong>'
        fs.onclick = () => this.toggleFullscreen()
        pauseActionsEl.insertBefore(fs, pauseActionsEl.firstChild)
      }
      const syncVals = () => {
        if (vm && vmVal) vmVal.textContent = Number(vm.value).toFixed(2)
        if (vmu && vmuVal) vmuVal.textContent = Number(vmu.value).toFixed(2)
        if (vs && vsVal) vsVal.textContent = Number(vs.value).toFixed(2)
      }
      if (vm) vm.oninput = () => { this.audio.setMasterVolume(Number(vm.value)); syncVals() }
      if (vmu) vmu.oninput = () => { this.audio.setMusicVolume(Number(vmu.value)); syncVals() }
      if (vs) vs.oninput = () => { this.audio.setSfxVolume(Number(vs.value)); syncVals() }
      if (af) af.onchange = () => { this.autoFire = !!af.checked; try { localStorage.setItem('opt.autofire', this.autoFire ? '1' : '0') } catch {} }
      if (resumeBtn) resumeBtn.onclick = () => { this.togglePause() }
      const confirmAction = (message: string, action: () => void) => {
        const conf = document.createElement('div') as HTMLDivElement
        conf.className = 'overlay'
        const card = document.createElement('div') as HTMLDivElement
        card.className = 'card'
        const text = document.createElement('div') as HTMLDivElement
        text.className = 'carddesc'
        text.textContent = message
        const row = document.createElement('div') as HTMLDivElement
        row.style.display = 'flex'; row.style.gap = '8px'; row.style.marginTop = '8px'
        const ok = document.createElement('button') as HTMLButtonElement; ok.className = 'card'; ok.innerHTML = '<strong>OK</strong>'
        const cancel = document.createElement('button') as HTMLButtonElement; cancel.className = 'card'; cancel.innerHTML = '<strong>Cancel</strong>'
        row.append(ok, cancel); card.append(text, row); conf.append(card)
        this.root.append(conf)
        conf.style.display = 'flex'
        ok.onclick = () => { conf.remove(); action() }
        cancel.onclick = () => conf.remove()
        let prevA = false, prevB = false
        const nav = () => {
          const gp = this.input.getActiveGamepad()
          const a = !!gp?.buttons?.[0]?.pressed
          const b = !!gp?.buttons?.[1]?.pressed
          if (a && !prevA) ok.click()
          if (b && !prevB) cancel.click()
          prevA = a; prevB = b
          if (conf.parentElement) requestAnimationFrame(nav)
        }
        requestAnimationFrame(nav)
      }
      if (restartBtn) restartBtn.onclick = () => confirmAction('Restart the run? Are you sure?', () => location.reload())
      if (mainBtn) mainBtn.onclick = () => confirmAction('Return to main menu? Are you sure?', () => location.reload())
      // Gamepad navigation for pause actions
      const actionBtns = [resumeBtn, restartBtn, mainBtn].filter(Boolean) as HTMLButtonElement[]
      let idx = 0
      const setSel = () => actionBtns.forEach((b, i) => b.classList.toggle('selected', i === idx))
      setSel()
      let prevUp = false, prevDown = false, prevA = false
      const nav = () => {
        if (!this.isPaused) return
        const gp = this.input.getActiveGamepad()
        const up = !!gp && ((gp.axes?.[1] ?? 0) < -0.5 || gp.buttons?.[12]?.pressed)
        const down = !!gp && ((gp.axes?.[1] ?? 0) > 0.5 || gp.buttons?.[13]?.pressed)
        const a = !!gp && gp.buttons?.[0]?.pressed
        if (up && !prevUp) { idx = (idx - 1 + actionBtns.length) % actionBtns.length; setSel() }
        if (down && !prevDown) { idx = (idx + 1) % actionBtns.length; setSel() }
        if (a && !prevA) actionBtns[idx]?.click()
        prevUp = up; prevDown = down; prevA = a
        requestAnimationFrame(nav)
      }
      requestAnimationFrame(nav)

      // Update debug line
      const updDbg = () => {
        if (!dbg) return
        const enemies = this.aliveEnemies
        const proj = this.projectiles.filter(p => p.alive).length
        const orbs = this.xpOrbs.filter(o => o.alive).length
        const picks = this.pickups.filter(p => p.alive).length
        dbg.textContent = `EN:${enemies} PR:${proj} XP:${orbs} PK:${picks}`
      }
      updDbg()
      // Initialize slider positions from current defaults
      if (vm) vm.value = this.audio.getMasterVolume().toFixed(2)
      if (vmu) vmu.value = this.audio.getMusicVolume().toFixed(2)
      if (vs) vs.value = this.audio.getSfxVolume().toFixed(2)
      if (af) af.checked = this.autoFire
      syncVals()
    }
    hookSliders()

    // Title overlay
    this.titleOverlay = document.createElement('div') as HTMLDivElement
    this.titleOverlay.className = 'overlay'
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
    // Keep static for now; animation disabled
    this.titleImgEl = img
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
    btnRow.className = 'title-buttons'
    btnRow.style.display = 'grid'
    btnRow.style.gridTemplateColumns = 'repeat(2, minmax(120px, 1fr))'
    btnRow.style.gap = '6px'
    btnRow.style.margin = '0 auto'
    ;(btnRow.style as any).justifyItems = 'center'
    ;(btnRow.style as any).justifyContent = 'center'
    const startBtn = document.createElement('button') as HTMLButtonElement
    startBtn.className = 'card nav-card selected'
    startBtn.style.padding = '8px'
    startBtn.innerHTML = '<strong>Start</strong>'
    const lbBtn = document.createElement('button') as HTMLButtonElement
    lbBtn.className = 'card nav-card'
    lbBtn.style.padding = '8px'
    lbBtn.innerHTML = '<strong>Leaderboards</strong>'
    const bugBtn = document.createElement('button') as HTMLButtonElement
    bugBtn.className = 'card nav-card'
    bugBtn.style.padding = '8px'
    bugBtn.innerHTML = '<strong>Bug Report</strong>'
    const optBtn = document.createElement('button') as HTMLButtonElement
    optBtn.style.display = 'none' // replaced by FAB
    const chgBtn = document.createElement('button') as HTMLButtonElement
    chgBtn.style.display = 'none' // replaced by FAB
    const dbgBtn = document.createElement('button') as HTMLButtonElement
    dbgBtn.className = 'card nav-card'
    dbgBtn.style.padding = '8px'
    dbgBtn.innerHTML = '<strong>Debug Mode</strong>'
    const dailyBtn = document.createElement('button') as HTMLButtonElement
    dailyBtn.className = 'card nav-card'
    dailyBtn.style.padding = '8px'
    dailyBtn.innerHTML = `<strong>Daily Disk</strong><div class="carddesc">${this.getNewYorkDate()}</div>`
    const altBtn = document.createElement('button') as HTMLButtonElement
    altBtn.className = 'card nav-card'
    altBtn.style.padding = '8px'
    altBtn.innerHTML = '<strong>Alt Title</strong>'
    // Insert Start last so it appears first on grid
    // NOTE: Top-right small buttons removed; using bottom-right FABs instead
    btnRow.appendChild(startBtn)
    btnRow.appendChild(lbBtn)
    btnRow.appendChild(dailyBtn)
    btnRow.appendChild(dbgBtn)
    btnRow.appendChild(bugBtn)
    btnRow.appendChild(altBtn)
    this.titleOverlay.appendChild(titleWrap)
    this.titleOverlay.appendChild(btnRow)
    this.root.appendChild(this.titleOverlay)

    lbBtn.onclick = () => this.showLeaderboards() /* implemented below */
    bugBtn.onclick = () => this.showBestiary()

    const begin = () => {
      this.titleOverlay.style.display = 'none'
      this.showTitle = false
      this.pauseDebounceUntil = performance.now() + 400
      // start default music; theme selection will switch later
      this.audio.startMusic('default' as ThemeKey)
      // Safety: ensure any Alt Title background is removed
      try { this.disposeAltBg() } catch {}
      try { this.removeAllAltBgPlanes() } catch {}
    }
    startBtn.onclick = begin
    const openOptions = () => {
      const note = document.createElement('div') as HTMLDivElement
      note.className = 'overlay'
      const card = document.createElement('div') as HTMLDivElement
      card.className = 'card'
      card.innerHTML = '<strong>Options</strong><div class="carddesc">Coming soon</div>'
      note.appendChild(card)
      this.root.appendChild(note)
      setTimeout(() => note.remove(), 1000)
    }
    optBtn.onclick = openOptions
    const openChangelog = () => this.showChangelog()
    chgBtn.onclick = openChangelog
    // Show corner FABs only on title screen
    if (this.optionsFab) this.optionsFab.style.display = 'inline-flex'
    if (this.changelogFab) this.changelogFab.style.display = 'inline-flex'
    this.optionsFab?.addEventListener('click', openOptions)
    this.changelogFab?.addEventListener('click', openChangelog)
    dbgBtn.onclick = () => this.showDebugPanel()
    dailyBtn.onclick = () => {
      this.isDaily = true
      this.dailyId = this.getNewYorkDate()
      this.buildDailyPlan(this.dailyId)
      begin()
    }
    altBtn.onclick = () => this.showAltTitle()
    this.uiSelectIndex = 0

    // Changelog overlay (hidden by default)
    this.changelogOverlay = document.createElement('div') as HTMLDivElement
    this.changelogOverlay.className = 'overlay'
    this.changelogOverlay.style.display = 'none'
    this.root.appendChild(this.changelogOverlay)

    this.updateHud()
    this.updateHPBar()
    this.updateInventoryUI()
    this.updateXPBar()

    this.input = new InputManager(canvas)
    // Touch controls (dual virtual sticks) if on mobile and allowed in state
    const isTouchEnabled = () => !this.showTitle && !this.isPaused && !this.isPausedForLevelUp
    new TouchControls(canvas, this.input, isTouchEnabled)

    // Load options without clobbering defaults
    try {
      const savedAF = localStorage.getItem('opt.autofire')
      if (savedAF !== null) this.autoFire = savedAF === '1'
    } catch {}

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
  private pickOffscreenSpawn(minMargin = 3, maxMargin = 8, tries = 12): THREE.Vector3 {
    const aspect = window.innerWidth / window.innerHeight
    const viewSize = 12
    const viewXHalf = viewSize * aspect
    const viewZHalf = viewSize
    const center = this.player.group.position
    const diag = Math.hypot(viewXHalf, viewZHalf)
    const minR = diag + minMargin
    const maxR = minR + maxMargin
    const tmp = new THREE.Vector3()
    for (let i = 0; i < tries; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = minR + Math.random() * (maxR - minR)
      const x = center.x + Math.cos(angle) * dist
      const z = center.z + Math.sin(angle) * dist
      tmp.set(x, 0.5, z).project(this.camera)
      if (Math.abs(tmp.x) > 1.02 || Math.abs(tmp.y) > 1.02) {
        return new THREE.Vector3(x, 0.5, z)
      }
    }
    const angle = Math.random() * Math.PI * 2
    const x = center.x + Math.cos(angle) * (maxR + 6)
    const z = center.z + Math.sin(angle) * (maxR + 6)
    return new THREE.Vector3(x, 0.5, z)
  }

  spawnEnemy() {
    // Spawn just outside current view to avoid pop-in but keep approach time reasonable
    const angle = Math.random() * Math.PI * 2
    const aspect = window.innerWidth / window.innerHeight
    const viewSize = 12
    const viewXHalf = viewSize * aspect
    const viewZHalf = viewSize
    // Spawn just outside the current on-screen rectangle. Using the diagonal ensures it's offscreen
    const margin = 4
    const minR = Math.hypot(viewXHalf, viewZHalf) + margin
    const maxR = minR + 6
    const dist = minR + Math.random() * (maxR - minR)
    const x = this.player.group.position.x + Math.cos(angle) * dist
    const z = this.player.group.position.z + Math.sin(angle) * dist
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff55aa }))
    mesh.position.set(x, 0.5, z)
    this.scene.add(mesh)
    const minute = Math.floor(this.gameTime / 60)
    const baseColor = ((mesh.material as THREE.MeshBasicMaterial).color.getHex?.() ?? 0xffffff) as number
    this.enemies.push({ mesh, alive: true, speed: 2 + Math.random() * 1.5, hp: 2, type: 'slime', timeAlive: 0, spawnWave: minute, baseColorHex: baseColor })
    this.aliveEnemies++
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
      const mesh = new THREE.Mesh(this.sharedBulletGeom, this.sharedBulletMat)
      mesh.position.copy(start).add(dir.clone().multiplyScalar(0.12))
      mesh.position.y = 0.5
      this.scene.add(mesh)
      this.projectiles.push({ mesh, velocity: dir.multiplyScalar(14), alive: true, ttl: 1.6, damage: this.projectileDamage, pierce: this.projectilePierce, last: mesh.position.clone(), kind: 'bullet' })
    }
    this.audio.playShoot()
  }

  dropPickup(position: THREE.Vector3, forceKind?: 'heal' | 'xp') {
    // Only drops: Heal (rare) or XP bundles
    const roll = Math.random()
    let kind: Pickup['kind']
    if (forceKind) kind = forceKind
    else {
      const vacOdds = this.plentifulPickups ? 0.06 : 0.015
      const healOdds = this.plentifulPickups ? 0.33 : 0.12
      if (roll < vacOdds) kind = 'vacuum'
      else if (roll < vacOdds + healOdds) kind = 'heal'
      else kind = 'xp'
    }
    let mesh: THREE.Mesh
    if (kind === 'heal') {
      // 3D triangular prism (more visible)
      const tri = new THREE.Shape()
      tri.moveTo(0, 0.35); tri.lineTo(-0.35, -0.35); tri.lineTo(0.35, -0.35); tri.lineTo(0, 0.35)
      const prism = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false })
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe38a })
      mesh = new THREE.Mesh(prism, mat)
      mesh.rotation.x = -Math.PI / 2
    } else if (kind === 'vacuum') {
      // Blue horseshoe magnet
      const m = this.makeHorseshoeMagnet?.()
      mesh = (m as unknown as THREE.Mesh) || new THREE.Mesh(this.sharedVacuumGeom, this.sharedVacuumMat)
    } else {
      // XP drop uses the same replacement odds as enemy death (respects wave gating)
      this.spawnXP(position)
      return
    }
    mesh.position.copy(position)
    mesh.position.y = kind === 'heal' ? 0.7 : 0.4
    this.scene.add(mesh)
    const xpValue = undefined
    this.pickups.push({ mesh, kind, alive: true, xpValue })
  }

  applyPickup(p: Pickup) {
    if (p.kind === 'heal') {
      const heal = Math.ceil(this.player.maxHp * 0.25)
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal)
      this.updateHPBar()
    } else if (p.kind === 'vacuum') {
      // Enable a timed global vacuum that pulls all XP and XP bundles toward the player
      this.vacuumActive = true
      this.vacuumEndTime = this.gameTime + 3.0
    }
    if (p.kind === 'xp' && p.xpValue) {
      this.gainXP(p.xpValue)
    }
    this.updateHud()
    this.audio.playPickup()
  }

  updateHud() {
    const secs = Math.max(0, (this.gameTime | 0))
    const digits = String(secs).padStart(4, '0')
    // Ensure wave element exists
    let waveEl = document.querySelector<HTMLDivElement>('#wave')
    if (!waveEl) {
      waveEl = document.createElement('div') as HTMLDivElement
      waveEl.id = 'wave'
      document.body.appendChild(waveEl)
    }
    const waveNum = Math.max(1, Math.floor(this.gameTime / 60) + 1)
    waveEl.innerHTML = `
      <div class="hc-wrap">
        <span class="hc-label">WAVE</span>
        ${String(waveNum).padStart(2, '0').split('').map((d) => `<span class=\"hc-digit\">${d}</span>`).join('')}
      </div>`
    this.hud.innerHTML = `
      <div class="hc-wrap">
        <span class="hc-label">TIME</span>
        ${digits.split('').map((d) => `<span class=\"hc-digit\">${d}</span>`).join('')}
      </div>`
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
      const lvl =
        w === 'CRT Beam' ? Math.max(1, Math.floor((this.crtBeamDps - 6) / 2) + 1) :
        w === 'Tape Whirl' ? Math.max(1, this.whirlLevel || 1) :
        w === 'SCSI Rocket' ? Math.max(1, this.rocketLevel || 1) :
        w === 'Magic Lasso' ? Math.max(1, this.lassoLevel || 1) :
        w === 'Shield Wall' ? Math.max(1, this.shieldLevel || 1) :
        w === 'Sata Cable Tail' ? Math.max(1, this.sataTailLevel || 1) :
        w === 'Dial-up Burst' ? Math.max(1, this.burstLevel || 1) :
        w === 'Dot Matrix' ? (this.sideBullets ? 1 + 0 : 1) : 1
      wslots.appendChild(this.makeSlotIcon(`${w} Lv.${lvl}`))
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
    // Allow attraction to continue briefly after level-up
    this.levelUpTailUntilMs = performance.now() + 500
    this.overlay.innerHTML = ''
    this.overlay.style.display = 'flex'
    this.uiSelectIndex = 0

    const choices = this.rollChoices(3)
    // Append first, then trigger animation next frame to avoid flash
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i]
      ch.disabled = true
      ch.style.opacity = '0'
      this.overlay.appendChild(ch)
      // Stagger
      const delay = i * 70
      requestAnimationFrame(() => {
        setTimeout(() => {
          ch.classList.add('appear')
          ch.style.opacity = ''
        }, delay)
      })
    }
    const cards = Array.from(this.overlay.querySelectorAll('.card')) as HTMLButtonElement[]
    cards.forEach((c, i) => c.classList.toggle('selected', i === 0))
    setTimeout(() => { cards.forEach((c) => (c.disabled = false)) }, 500)
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
        pool.push({ title: 'SCSI Rocket', desc: 'Powerful missiles with a blast radius', icon: '🚀', apply: () => this.addWeapon('SCSI Rocket') })
      if (!this.ownedWeapons.has('Tape Whirl'))
        pool.push({ title: 'Tape Whirl', desc: 'Orbiting saws', icon: '📼', apply: () => this.addWeapon('Tape Whirl') })
      if (!this.ownedWeapons.has('Sata Cable Tail'))
        pool.push({ title: 'Sata Cable Tail', desc: 'Flapping rear tail', icon: '🔌', apply: () => this.addWeapon('Sata Cable Tail') })
      if (!this.ownedWeapons.has('Magic Lasso'))
        pool.push({ title: 'Magic Lasso', desc: 'Draw a loop to damage inside', icon: '🪢', apply: () => this.addWeapon('Magic Lasso') })
      if (!this.ownedWeapons.has('Shield Wall'))
        pool.push({ title: 'Shield Wall', desc: 'Blocking energy wall', icon: '🛡️', apply: () => this.addWeapon('Shield Wall') })
      if (!this.ownedWeapons.has('Paint.exe'))
        pool.push({ title: 'Paint.exe', desc: 'Leaves damaging paint on ground', icon: '🎨', apply: () => this.addWeapon('Paint.exe') })
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
    addUpgrade('XP Amplifier', 'Gain more XP from drops', '📈', () => {
      const lvl = (this.ownedUpgrades.get('XP Amplifier') ?? 0) + 1
      if (lvl <= 1) this.xpGainMultiplier = 1.2
      else if (lvl === 2) this.xpGainMultiplier = 3
      else this.xpGainMultiplier = Math.min(6, 1 + lvl * 1)
      this.xpGainMultiplier = Math.min(6, this.xpGainMultiplier)
    })

    // Weapon level-ups appear as choices if already owned
    if (this.ownedWeapons.has('CRT Beam')) pool.push({ title: 'CRT Beam (Level up)', desc: '+1 length, +2 DPS, shorter off-time', icon: '📺', apply: () => this.levelUpBeam() })
    if (this.hasLasso) pool.push({ title: 'Magic Lasso (Level up)', desc: '+2s duration, +2 damage', icon: '🪢', apply: () => this.levelUpLasso() })
    if (this.hasShield) pool.push({ title: 'Shield Wall (Level up)', desc: '+1 length, wider, longer uptime', icon: '🛡️', apply: () => this.levelUpShield() })
    if (this.ownedWeapons.has('Dial-up Burst')) pool.push({ title: 'Dial-up Burst (Level up)', desc: 'Bigger radius, faster cycle, multi-pulse', icon: '📞', apply: () => this.levelUpBurst() })
    if (this.ownedWeapons.has('SCSI Rocket')) pool.push({ title: 'SCSI Rocket (Level up)', desc: 'Bigger blast and stronger payload', icon: '🚀', apply: () => this.levelUpRocket() })
    if (this.ownedWeapons.has('Dot Matrix')) pool.push({ title: 'Dot Matrix (Level up)', desc: 'Stronger side bullets', icon: '🖨️', apply: () => this.levelUpDotMatrix() })
    if (this.ownedWeapons.has('Tape Whirl')) pool.push({ title: 'Tape Whirl (Level up)', desc: 'Bigger radius, higher DPS', icon: '📼', apply: () => this.levelUpWhirl() })
    if (this.ownedWeapons.has('Sata Cable Tail')) pool.push({ title: 'Sata Cable Tail (Level up)', desc: 'Longer, stronger tail', icon: '🔌', apply: () => this.levelUpSataTail() })
    if (this.ownedWeapons.has('Paint.exe')) pool.push({ title: 'Paint.exe (Level up)', desc: 'More uptime, stronger DPS, longer paint', icon: '🎨', apply: () => this.levelUpPaint() })

    // Filter out entries that would be invalid due to caps
    const allWeapons = ['CRT Beam','Dot Matrix','Dial-up Burst','SCSI Rocket','Tape Whirl','Magic Lasso','Shield Wall','Sata Cable Tail','Paint.exe']
    const isWeaponName = (t: string) => allWeapons.includes(t)
    const isWeaponLevelUp = (t: string) => /\(\s*Level up\s*\)$/i.test(t)
    const canApply = (title: string) => {
      if (isWeaponName(title)) return this.ownedWeapons.size < this.maxWeapons
      if (isWeaponLevelUp(title)) return true
      // upgrade entries: allow if we have space or we're leveling an existing upgrade
      return this.ownedUpgrades.size < this.maxUpgrades || this.ownedUpgrades.has(title)
    }
    // Ensure titles are unique and valid
    let filtered = pool.filter(p => canApply(p.title))
    const seen = new Set<string>()
    filtered = filtered.filter(p => {
      if (seen.has(p.title)) return false
      seen.add(p.title)
      return true
    })

    // Randomize and take N
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); [filtered[i], filtered[j]] = [filtered[j], filtered[i]]
    }
    filtered = filtered.slice(0, num)
    return filtered.map((p) => this.makeChoiceCard(p.title, p.desc, p.icon, p.apply))
  }

  makeChoiceCard(title: string, desc: string, icon: string, apply: () => void) {
    const c = document.createElement('button')
    c.className = 'card'
    c.innerHTML = `<div class="cardrow"><span class="cardicon">${icon}</span><strong>${title}</strong></div><div class="carddesc">${desc}</div>`
    c.onclick = () => {
      // Enforce max counts
      const isWeaponLevelUp = /(\(\s*Level up\s*\))$/i.test(title)
      if (this.isWeapon(title) && this.ownedWeapons.size >= this.maxWeapons) return
      if (!this.isWeapon(title) && !isWeaponLevelUp && this.ownedUpgrades.size >= this.maxUpgrades && !this.ownedUpgrades.has(title)) return
      apply()
      this.overlay.style.display = 'none'
      this.isPausedForLevelUp = false
      if (this.pendingLevelUps > 0) {
        this.pendingLevelUps -= 1
        if (this.pendingLevelUps > 0) {
          // Queue next level-up selection immediately
          setTimeout(() => this.showLevelUp(), 0)
        }
      }
    }
    return c
  }

  isWeapon(name: string) {
    return ['CRT Beam', 'Dot Matrix', 'Dial-up Burst', 'SCSI Rocket', 'Tape Whirl', 'Magic Lasso', 'Shield Wall', 'Sata Cable Tail', 'Paint.exe'].includes(name)
  }

  addWeapon(name: string) {
    if (this.ownedWeapons.has(name)) return
    this.ownedWeapons.add(name)
    // Track acquisition order once
    if (!this.weaponOrder.includes(name)) this.weaponOrder.push(name)
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
    if (name === 'Dial-up Burst') {
      this.burstLevel = 1
      this.modemWavePulses = 1
    }
    if (name === 'Sata Cable Tail' && !this.sataTailGroup) {
      const group = new THREE.Group()
      // Anchor firmly to player's backside in LOCAL space (do not set world each frame)
      group.position.set(0, 0.12, -0.35)
      this.player.group.add(group)
      this.sataTailGroup = group
      // Build flat ribbon-like segments (boxes) for a SATA vibe
      const segs = 12
      this.sataTailSegments = []
      const segLen = Math.max(0.08, this.sataTailLength / (segs - 1))
      for (let i = 0; i < segs; i++) {
        const k = i / (segs - 1)
        const w = 0.12 * (1 - 0.15 * k)
        const h = 0.03
        const d = Math.max(0.06, segLen * 0.9)
        const geom = new THREE.BoxGeometry(w, h, d)
        const color = new THREE.MeshBasicMaterial({ color: 0xcc3344 }) // red SATA cable
        const seg = new THREE.Mesh(geom, color)
        seg.position.set(0, 0, -k * this.sataTailLength)
        group.add(seg)
        this.sataTailSegments.push(seg)
      }
      this.sataTailLevel = 1
    }
    if (name === 'Tape Whirl' && this.whirlSaws.length === 0) {
      const createSaw = () => new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 16), new THREE.MeshBasicMaterial({ color: 0xffcc66 }))
      const s1 = createSaw(), s2 = createSaw(), s3 = createSaw()
      this.scene.add(s1, s2, s3)
      this.whirlSaws.push(s1, s2, s3)
      this.whirlLevel = 1
      this.whirlTimer = 0; this.whirlOn = true
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
    if (name === 'Paint.exe' && this.paintLevel === 0) {
      this.paintLevel = 1
      this.paintTimer = 0
      this.paintOn = true
      // No mesh created here; paint swaths are emitted during update
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

  // When enemy dies, spawn XP (replacement odds by wave)
  spawnXP(position: THREE.Vector3) {
    const wave = Math.max(0, Math.floor(this.gameTime / 60))
    let v1 = 0.8, v3 = 0.2, v5 = 0, v10 = 0, v20 = 0
    if (wave >= 2) { v1 = 0.7; v3 = 0.25; v5 = 0.05 }
    if (wave >= 4) { v1 = 0.5; v3 = 0.25; v5 = 0.25 }
    if (wave >= 6) { v1 = 0.35; v3 = 0.3; v5 = 0.25; v10 = 0.1 }
    if (wave >= 8) { v1 = 0.25; v3 = 0.3; v5 = 0.3; v10 = 0.15; v20 = 0 }
    if (wave >= 10) { v1 = 0.18; v3 = 0.28; v5 = 0.32; v10 = 0.16; v20 = 0.06 }
    if (wave >= 12) { v1 = 0.12; v3 = 0.25; v5 = 0.32; v10 = 0.22; v20 = 0.09 }
    if (wave >= 15) { v1 = 0.08; v3 = 0.22; v5 = 0.3; v10 = 0.28; v20 = 0.12 }
    // touch v20 to satisfy TS
    if (v20 < 0) { /* no-op */ }

    const r = Math.random()
    let value = 1
    if (r < v1) value = 1
    else if (r < v1 + v3) value = 3
    else if (r < v1 + v3 + v5) value = 5
    else if (r < v1 + v3 + v5 + v10) value = 10
    else value = 20

    if (value === 1) {
      const mesh = new THREE.Mesh(this.sharedXPGeom, this.sharedXPOrbMat)
      mesh.position.copy(position)
      mesh.position.y = 0.35
      this.scene.add(mesh)
      this.xpOrbs.push({ mesh, value: 1, alive: true })
      return
    }
    const mat = value === 3 ? this.sharedXPTier3Mat
      : value === 5 ? this.sharedXPTier5Mat
      : value === 10 ? this.sharedXPTier10Mat
      : this.sharedXPTier20Mat
    const mesh = new THREE.Mesh(this.sharedXPCubeGeom, mat)
    mesh.position.copy(position)
    mesh.position.y = 0.4
    this.scene.add(mesh)
    this.pickups.push({ mesh, kind: 'xp', alive: true, xpValue: value })
  }

  // getCurrentWave unused after replacement odds; keep if later needed
  // private getCurrentWave(): number {
  //   return Math.max(0, Math.floor(this.gameTime / 60))
  // }

     // Deprecated: computeXpBundleValue and dropXpBundleAt removed (replaced by replacement odds in spawnXP)


  private dropXpOnDeath(e: Enemy): void {
    const pos = e.mesh.position.clone()
    if (e.type === 'giant') {
      // 50 XP gold bundle + 3 random cubes (replacement odds)
      const gold = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), this.sharedXPTier50Mat)
      gold.position.copy(pos); gold.position.y = 0.55
      this.scene.add(gold)
      this.pickups.push({ mesh: gold, kind: 'xp', alive: true, xpValue: 50 })
      for (let i = 0; i < 3; i++) {
        const offset = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)
        this.spawnXP(pos.clone().add(offset))
      }
    } else {
      this.spawnXP(pos)
    }
  }

  gainXP(amount: number) {
    const gained = amount * this.xpGainMultiplier
    this.xp += gained
    this.showXPToast(`+${gained.toFixed(1)} XP`)
    while (this.xp >= this.xpToLevel) {
      this.xp -= this.xpToLevel
      this.level += 1
      this.xpToLevel = Math.floor(this.xpToLevel * 1.5)
      this.pendingLevelUps += 1
    }
    if (this.pendingLevelUps > 0 && !this.isPausedForLevelUp) {
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
    const lvl = this.xpBar.querySelector('#levellabel') as HTMLDivElement
    if (lvl) lvl.textContent = `Lvl ${this.level}`
  }

  showXPToast(text: string) {
    const t = document.createElement('div')
    t.textContent = text
    t.style.position = 'fixed'
    t.style.left = '50%'
    t.style.top = '50%'
    t.style.transform = 'translate(-50%, -50%)'
    t.style.color = '#8effe2'
    t.style.fontFamily = 'ui-monospace, monospace'
    t.style.fontSize = '16px'
    t.style.textShadow = '0 0 8px #33d6a6'
    t.style.pointerEvents = 'none'
    t.style.zIndex = '25'
    t.style.opacity = '1'
    t.style.transition = 'opacity 600ms, transform 600ms'
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
    this.themeObstacleCells.clear()
    // Set obstacle grid cell size per theme (bigger cells for Jeeves)
    this.obstacleCellSize = theme === 'jeeves' ? 8 : 2

    // Remove other billboards once chosen
    if (!this.themeLocked) {
      this.themeLocked = true
      for (const bb of [this.billboardGeocities, this.billboardYahoo, this.billboardDialup, (this as any).billboardJeeves]) {
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
    } else if (theme === 'jeeves') {
      // Warm parchment base with faint grid (maze-like feel)
      ctx.fillStyle = '#2b2418'
      ctx.fillRect(0, 0, 512, 512)
      ctx.strokeStyle = '#3a3122'; ctx.lineWidth = 1
      for (let i = 0; i <= 512; i += 16) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke()
      }
    }

    const tex = new THREE.CanvasTexture(texCanvas)
    this.groundTex = tex
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(10, 10)
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).map = tex
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).color = new THREE.Color(0xffffff)
    ;(this.groundMesh.material as THREE.MeshBasicMaterial).needsUpdate = true

    // Obstacles per theme
    const obstacles: THREE.Mesh[] = []
    const addBox = (x: number, z: number, c: number, s = 2) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, 1, s), new THREE.MeshBasicMaterial({ color: c }))
      m.position.set(x, 0.5, z)
      obstacles.push(m)
      this.scene.add(m)
      // Index into spatial grid
      const cs = this.obstacleCellSize
      const key = `${Math.floor(x / cs)},${Math.floor(z / cs)}`
      const list = this.themeObstacleCells.get(key) || []
      list.push(m)
      this.themeObstacleCells.set(key, list)
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
    } else if (theme === 'jeeves') {
      // Many small blockers to create a dense maze
      const min = -24, max = 24, step = 8
      // Fill grid with walls
      for (let z = min; z <= max; z += step) {
        for (let x = min; x <= max; x += step) {
          addBox(x, z, 0x5a4a35, 4)
        }
      }
      // Apply debug custom layout if provided (drawn grid wins)
      if (this.debugJeevesLayout.length > 0) {
        // Clear all and rebuild from layout
        for (const m of obstacles) this.scene.remove(m)
        obstacles.length = 0
        this.themeObstacleCells.clear()
        for (const cell of this.debugJeevesLayout) addBox(cell.x, cell.z, 0x5a4a35, 4)
      } else {
      // Carve corridors using simple walkers (wider steps reduce tiny gaps)
      const carve = (sx: number, sz: number, len: number) => {
        let x = sx, z = sz
        for (let i = 0; i < len; i++) {
          // Remove block by moving it underfloor (cheap carving)
          const cs = this.obstacleCellSize
          const key = `${Math.floor(x / cs)},${Math.floor(z / cs)}`
          const list = this.themeObstacleCells.get(key)
          if (list) {
            for (const m of list) { if (Math.abs(m.position.x - x) < 0.1 && Math.abs(m.position.z - z) < 0.1) { this.scene.remove(m) } }
            this.themeObstacleCells.delete(key)
          }
          const dir = Math.floor(Math.random() * 4)
          if (dir === 0) x += step * 2; else if (dir === 1) x -= step * 2; else if (dir === 2) z += step * 2; else z -= step * 2
          x = Math.max(min, Math.min(max, x)); z = Math.max(min, Math.min(max, z))
        }
      }
      carve(0, 0, 120)
      carve(-12, -6, 90)
      carve(12, 6, 90)
      // Clear generous spawn area around player start
      const clearRadius = 4
      for (let z = -clearRadius; z <= clearRadius; z += step) {
        for (let x = -clearRadius; x <= clearRadius; x += step) {
          const cs = this.obstacleCellSize
          const key = `${Math.floor(x / cs)},${Math.floor(z / cs)}`
          this.themeObstacleCells.delete(key)
        }
      }
      }
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
    // Jeeves tile (new)
    if (Math.abs(p.x - 12) < 2.5 && Math.abs(p.z + 12) < 2.5) { this.applyTheme('jeeves'); this.themeChosen = true }
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
    // Safety: if Alt Title is not active, ensure any leftover background plane is removed
    if (!this.altTitleActive && this.altBgMesh) { this.disposeAltBg() }
    // Alt Title updates (animations and controller input)
    if (this.altTitleActive && this.altTitleGroup) {
      // Controller left/right and A
      const gp = this.input.getActiveGamepad()
      const axisX = this.input.axesLeft.x
      const moveAxis = Math.abs(axisX) > 0.6 ? Math.sign(axisX) : 0
      this.altNavCooldown = Math.max(0, this.altNavCooldown - dt)
      const dpadLeft = !!gp && gp.buttons[14]?.pressed
      const dpadRight = !!gp && gp.buttons[15]?.pressed
      const a = !!gp && gp.buttons[0]?.pressed
      if (this.altNavCooldown <= 0 && (moveAxis !== 0 || dpadLeft || dpadRight)) {
        this.altNavCooldown = 0.22
        if (moveAxis > 0 || dpadRight) this.cycleAltFloppies(1)
        if (moveAxis < 0 || dpadLeft) this.cycleAltFloppies(-1)
      }
      if (a && performance.now() > (this as any).altEnterDebounceUntil) this.chooseAltFloppy(this.altFloppies[0]?.label ?? 'START')
      // Animate insertion
      if (this.altInsertAnim) {
        const anim = this.altInsertAnim
        anim.t += dt * 1000
        const u = Math.min(1, anim.t / anim.dur)
        const e = u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u // easeInOutQuad
        const p = new THREE.Vector3().lerpVectors(anim.start, anim.end, e)
        anim.m.position.copy(p)
        anim.m.rotation.y = anim.startR + (anim.endR - anim.startR) * e
        anim.m.rotation.x = anim.startRX + (anim.endRX - anim.startRX) * e
        if (u >= 1) { const done = anim.onDone; this.altInsertAnim = undefined; done() }
      }
      // Smoothly tween floppy positions/rotations
      for (const f of this.altFloppies) {
        f.mesh.position.lerp(f.target, Math.min(1, dt * 8))
        f.mesh.rotation.y += (f.targetRot - f.mesh.rotation.y) * Math.min(1, dt * 8)
      }
      // Force idle orientation: slight tilt so thickness is visible (unless inserting)
      if (!this.altInsertAnim) {
        for (const f of this.altFloppies) {
          f.mesh.rotation.x += (-0.18 - f.mesh.rotation.x) * Math.min(1, dt * 8)
          // Reset non-selected scale to default when not dragging
          if (this.altFloppies[0] && f.mesh !== this.altFloppies[0].mesh) f.mesh.scale.setScalar(1.9)
        }
      }
      // Intro rotation removed (per request): disks stay face-up until selection triggers insert
      this.altIntroAnims = undefined
      // Ensure non-title FABs remain hidden while Alt Title is active
      if (this.optionsFab) this.optionsFab.style.display = 'inline-flex'
      if (this.changelogFab) this.changelogFab.style.display = 'inline-flex'
      if (this.fullscreenBtn) this.fullscreenBtn.style.display = 'inline-flex'
      // Keep background aligned to camera and positioned in front; add subtle float to disks
			if (this.altBgMesh) {
        this.altBgMesh.position.copy(this.camera.position)
        this.altBgMesh.quaternion.copy(this.camera.quaternion)
        this.altBgMesh.position.add(new THREE.Vector3(0, 0, -5.0).applyQuaternion(this.camera.quaternion))
			}
      // Slightly stronger floatiness
      const t = performance.now() * 0.001
      for (let i = 0; i < this.altFloppies.length; i++) {
        const f = this.altFloppies[i]
        const mesh = f.mesh
        const ph = f.floatPhase ?? 0
        // During insert or selection dance, freeze other disks' float and fade them out (body + label)
        if ((this.altInsertAnim || this.altSelectDance) && (!this.altInsertAnim || mesh !== this.altInsertAnim.m) && (!this.altSelectDance || mesh !== this.altSelectDance.m)) {
          const applyAlpha = (obj: any, alpha: number) => {
            if (obj && obj.material) {
              const m = obj.material as any
              if (Array.isArray(m)) m.forEach((mm) => { mm.transparent = true; mm.opacity = alpha })
              else { m.transparent = true; m.opacity = alpha }
            }
            if (obj && obj.children) obj.children.forEach((c: any) => applyAlpha(c, alpha))
          }
          const matAny = mesh.material as any
          const curr = Array.isArray(matAny) ? (matAny[0]?.opacity ?? 1) : (matAny?.opacity ?? 1)
          const next = Math.max(0, curr - dt * 4)
          applyAlpha(mesh, next)
          mesh.visible = next > 0.01
        } else {
          // Restore visibility/alpha and sway while idle
          const applyAlpha = (obj: any, alpha: number) => {
            if (obj && obj.material) {
              const m = obj.material as any
              if (Array.isArray(m)) m.forEach((mm) => { mm.transparent = true; mm.opacity = alpha })
              else { m.transparent = true; m.opacity = alpha }
            }
            if (obj && obj.children) obj.children.forEach((c: any) => applyAlpha(c, alpha))
          }
          applyAlpha(mesh, 1)
          mesh.visible = true
          mesh.position.y = f.target.y + Math.sin(t * 1.6 + ph) * 0.025
          // XY sway (toward camera plane)
          const swayX = Math.sin(t * 0.9 + ph) * 0.02
          const swayZ = Math.cos(t * 0.7 + ph) * 0.02
      // If this is the selected top disk, let it drag slightly under the finger
          if (i === 0) {
            // Decay drag when not actively dragging
            if (!this.altDragging) this.altDragDX = this.altDragDX * Math.max(0, 1 - dt * 10)
            const dragX = this.altDragDX
        mesh.position.x = f.target.x + swayX + dragX
            // Scale up slightly while dragging
            const scaleUp = this.altDragging ? 2.05 : 1.9
            mesh.scale.setScalar(scaleUp)
            // Exaggerated wiggle on selected card
            mesh.rotation.z = (Math.sin(t * 1.2 + ph * 0.7) * 0.08) + THREE.MathUtils.clamp(dragX, -0.35, 0.35)
            mesh.renderOrder = 1003
          } else {
            mesh.position.x = f.target.x + swayX
            mesh.rotation.z = Math.sin(t * 0.8 + ph * 0.5) * 0.04
            mesh.renderOrder = 1001
          }
          mesh.position.z = f.target.z + swayZ
        }
      }
      // Selection dance animation
      if (this.altSelectDance) {
        const a = this.altSelectDance
        a.t = Math.min(a.dur, a.t + dt * 1000)
        const u = a.t / a.dur
        // Ease value reserved for future position tweening; not needed now
        const scale = a.startScale * (1 + 0.06 * Math.sin(u * Math.PI * 4) * (1 - u))
        a.m.scale.setScalar(scale)
        a.m.rotation.z = a.startRZ + 0.1 * Math.sin(u * Math.PI * 4) * (1 - u)
        if (a.t >= a.dur) { const go = a.makeInsert; this.altSelectDance = undefined; go() }
      }
      // Render and continue
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    // Overlay controller navigation
    this.updateOverlaySelection(dt)

    // Title overlay input
    if (this.showTitle && this.titleOverlay.style.display === 'flex') {
      const gp = this.input.getActiveGamepad()
      const a = !!gp && (gp.buttons[0]?.pressed || gp.buttons[9]?.pressed)
      const enter = !!this.input.keys['enter']
      const dpadLeft = !!gp && gp.buttons[14]?.pressed
      const dpadRight = !!gp && gp.buttons[15]?.pressed
      const axisX = this.input.axesLeft.x
      const moveAxis = Math.abs(axisX) > 0.6 ? Math.sign(axisX) : 0
      const cards = Array.from(this.titleOverlay.querySelectorAll('.nav-card')) as HTMLButtonElement[]
      this.uiNavCooldown = Math.max(0, this.uiNavCooldown - dt)
      // Stick navigation with cooldown
      if (this.uiNavCooldown <= 0 && moveAxis !== 0 && cards.length > 0) {
        this.uiNavCooldown = 0.25
        this.uiSelectIndex = (this.uiSelectIndex + moveAxis + cards.length) % cards.length
      }
      // D-pad edge navigation
      if (cards.length > 0) {
        if (dpadLeft && !this.uiDpadPrevLeft) this.uiSelectIndex = (this.uiSelectIndex - 1 + cards.length) % cards.length
        if (dpadRight && !this.uiDpadPrevRight) this.uiSelectIndex = (this.uiSelectIndex + 1) % cards.length
      }
      // Vertical mapping to previous/next
      const up = !!gp && ((gp.axes?.[1] ?? 0) < -0.6 || gp.buttons?.[12]?.pressed)
      const down = !!gp && ((gp.axes?.[1] ?? 0) > 0.6 || gp.buttons?.[13]?.pressed)
      if (cards.length > 0) {
        if (up && !this.uiDpadPrevUp) this.uiSelectIndex = (this.uiSelectIndex - 1 + cards.length) % cards.length
        if (down && !this.uiDpadPrevDown) this.uiSelectIndex = (this.uiSelectIndex + 1) % cards.length
      }
      cards.forEach((c, i) => c.classList.toggle('selected', i === this.uiSelectIndex))
      if (a || enter) (cards[this.uiSelectIndex] || cards[0])?.click()
      this.uiDpadPrevLeft = dpadLeft
      this.uiDpadPrevRight = dpadRight
      this.uiDpadPrevUp = up
      this.uiDpadPrevDown = down
      // Title art animation disabled (kept static)
      // Render and continue loop without running game logic
      this.renderer.render(this.scene, this.camera)
    // Ensure FABs visible on title screens (classic or Alt Title)
    if (this.showTitle || this.altTitleActive) {
        if (this.optionsFab) this.optionsFab.style.display = 'inline-flex'
        if (this.changelogFab) this.changelogFab.style.display = 'inline-flex'
        if (this.fullscreenBtn) this.fullscreenBtn.style.display = 'inline-flex'
      }
      requestAnimationFrame(() => this.loop())
      return
    }

    // Hide non-gameplay FABs during gameplay
    if (this.optionsFab) this.optionsFab.style.display = 'none'
    if (this.changelogFab) this.changelogFab.style.display = 'none'

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
    } else if (this.input.hasRecentMouseMove()) {
      // Allow mouse to rotate
      this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.x, this.input.mouse.y), this.camera)
      const hitMouse = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hitMouse)
      aimVector.copy(hitMouse.sub(this.player.group.position)).setY(0).normalize()
    } else if (this.input.hasRecentTouch()) {
      // Maintain last facing on touch when sticks are centered
      aimVector.set(0, 0, 0)
    }
    if (aimVector.lengthSq() > 0) {
      const yaw = Math.atan2(aimVector.x, aimVector.z)
      this.player.facing = yaw
      this.player.group.rotation.y = yaw
    }

    // Pause toggle (Start/P/Enter edge)
    const gp = this.input.getActiveGamepad()
    const startPressed = !!gp && gp.buttons[9]?.pressed && !this.showTitle
    const pPressed = !!this.input.keys['p']
    const escPressed = !!this.input.keys['escape']
    const pauseNow = !!(startPressed || pPressed || escPressed)
    if (pauseNow && !this.pausePrev && performance.now() > this.pauseDebounceUntil) {
      // When opening pause, re-hook sliders so events are active
      const vm = this.pauseOverlay.querySelector('#vol-master') as HTMLInputElement
      if (vm) {
        const vmu = this.pauseOverlay.querySelector('#vol-music') as HTMLInputElement
        const vs = this.pauseOverlay.querySelector('#vol-sfx') as HTMLInputElement
        const vmVal = this.pauseOverlay.querySelector('#vol-master-val') as HTMLSpanElement
        const vmuVal = this.pauseOverlay.querySelector('#vol-music-val') as HTMLSpanElement
        const vsVal = this.pauseOverlay.querySelector('#vol-sfx-val') as HTMLSpanElement
        const dbg = this.pauseOverlay.querySelector('#pause-debug') as HTMLDivElement
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
        // Update debug numbers when pause opens
        if (dbg) {
          const enemies = this.aliveEnemies
          const proj = this.projectiles.filter(p => p.alive).length
          const orbs = this.xpOrbs.filter(o => o.alive).length
          const picks = this.pickups.filter(p => p.alive).length
          dbg.textContent = `EN:${enemies} PR:${proj} XP:${orbs} PK:${picks}`
        }
      }
      this.togglePause()
      // Seed selection index on pause actions
      const actions = Array.from(this.pauseOverlay.querySelectorAll('#btn-resume, #btn-restart, #btn-mainmenu')) as HTMLButtonElement[]
      actions.forEach((b, i) => b.classList.toggle('selected', i === 0))
    }
    this.uiStartPrev = !!startPressed
    this.pausePrev = pauseNow

    if (!this.themeChosen) {
      const mv = this.input.getMoveVector()
      this.player.group.position.add(new THREE.Vector3(mv.x, 0, mv.y).multiplyScalar(this.player.speed * dt))
      this.checkThemeTiles()
      this.isoPivot.position.lerp(new THREE.Vector3(this.player.group.position.x, 0, this.player.group.position.z), 0.1)
      // Allow full rotation control before theme selection
      this.input.updateGamepad()
      let aimVector = new THREE.Vector3()
      if (this.input.axesRight.x !== 0 || this.input.axesRight.y !== 0) {
        const ndc = new THREE.Vector2(this.input.axesRight.x, -this.input.axesRight.y)
        this.raycaster.setFromCamera(ndc, this.camera)
        const hit = new THREE.Vector3()
        this.raycaster.ray.intersectPlane(this.groundPlane, hit)
        aimVector.copy(hit.sub(this.player.group.position)).setY(0).normalize()
      } else if (this.input.hasRecentMouseMove()) {
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
      // Show touch pause only during gameplay
      if (this.pauseTouchBtn) this.pauseTouchBtn.style.display = 'none'
      if (this.optionsFab) this.optionsFab.style.display = 'none'
      if (this.changelogFab) this.changelogFab.style.display = 'none'
      // Keep fullscreen button visible during gameplay
      if (this.fullscreenBtn) this.fullscreenBtn.style.display = 'inline-flex'
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
      // Refresh debug counts each frame while paused
      const dbg = this.pauseOverlay.querySelector('#pause-debug') as HTMLDivElement
      if (dbg) {
        const enemies = this.aliveEnemies
        const proj = this.projectiles.filter(p => p.alive).length
        const orbs = this.xpOrbs.filter(o => o.alive).length
        const picks = this.pickups.filter(p => p.alive).length
        dbg.textContent = `EN:${enemies} PR:${proj} XP:${orbs} PK:${picks}`
      }
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    this.gameTime += dt
    const hudSecs = this.gameTime | 0
    if (hudSecs !== this.lastHudSeconds) { this.lastHudSeconds = hudSecs; this.updateHud() }

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
      // While paused for level-up, allow XP to continue pulling toward the player for a short tail window
      const nowMs = performance.now()
      if (nowMs < this.levelUpTailUntilMs) {
        const tailDur = Math.max(1, this.levelUpTailUntilMs - (this.levelUpTailUntilMs - 500))
        const tailLeft = Math.max(0, this.levelUpTailUntilMs - nowMs)
        const tailFactor = Math.max(0, Math.min(1, tailLeft / tailDur))
        const scale = tailFactor * tailFactor
        // XP bundles
        for (const pk of this.pickups) {
          if (!pk.alive) continue
          if (pk.kind === 'xp') {
            const toP = this.player.group.position.clone().sub(pk.mesh.position)
            toP.y = 0
            const dist = toP.length()
            const inMagnet = dist < this.xpMagnetRadius
            const shouldPull = inMagnet || this.vacuumActive
            if (shouldPull) {
              toP.normalize()
              const pull = this.vacuumActive ? (this.vacuumPull + dist * 2) : (this.xpMagnetRadius - dist + 0.4) * 6
              pk.mesh.position.add(toP.multiplyScalar(pull * dt * scale))
            }
            if (pk.mesh.position.distanceToSquared(this.player.group.position) < (this.player.radius + 0.6) ** 2) {
              pk.alive = false
              this.scene.remove(pk.mesh)
              this.applyPickup(pk)
            }
          }
        }
        // XP orbs
        for (const orb of this.xpOrbs) {
          if (!orb.alive) continue
          const toPlayer = this.player.group.position.clone().sub(orb.mesh.position)
          toPlayer.y = 0
          const d = toPlayer.length()
          const inMagnet = d < this.xpMagnetRadius
          const shouldPull = inMagnet || this.vacuumActive
          if (shouldPull) {
            toPlayer.normalize()
            const pull = this.vacuumActive ? (this.vacuumPull + d * 2) : (this.xpMagnetRadius - d + 0.4) * 6
            orb.mesh.position.add(toPlayer.multiplyScalar(pull * dt * scale))
          }
          const d2 = orb.mesh.position.distanceToSquared(this.player.group.position)
          if (d2 < (this.player.radius + 0.6) ** 2) {
            orb.alive = false
            this.scene.remove(orb.mesh)
            this.gainXP(orb.value)
          }
        }
      }
      this.renderer.render(this.scene, this.camera)
      requestAnimationFrame(() => this.loop())
      return
    }

    this.input.updateGamepad()
    // Toggle touch pause button if touch is the recent modality
    if (this.pauseTouchBtn) this.pauseTouchBtn.style.display = this.input.hasRecentTouch() ? 'block' : 'none'

    const mv = this.input.getMoveVector()
    const moveDir = new THREE.Vector3(mv.x, 0, mv.y)
    this.player.group.position.add(moveDir.multiplyScalar(this.player.speed * dt))

    // Giant spawns periodically
    this.giantTimer += dt
    if (this.giantTimer >= this.giantInterval) {
      this.giantTimer = 0
      this.spawnGiant()
    }

    // Obstacles pushback (AABB resolve on Jeeves; legacy soft push elsewhere)
    if (this.currentTheme === 'jeeves') {
      const cs = this.obstacleCellSize
      const pos = this.player.group.position
      const key = `${Math.floor(pos.x / cs)},${Math.floor(pos.z / cs)}`
      const [cx, cz] = key.split(',').map(Number)
      const cells = [key, `${cx+1},${cz}`, `${cx-1},${cz}`, `${cx},${cz+1}`, `${cx},${cz-1}`]
      const pr = this.player.radius ?? 0.5
      for (const k of cells) {
        const arr = this.themeObstacleCells.get(k)
        if (!arr) continue
        for (const m of arr) {
          // Half extents from geometry parameters (fallback to 1)
          const p = (m.geometry as any)?.parameters || {}
                     const halfX = (p.width ? p.width / 2 : 2)
           const halfZ = (p.depth ? p.depth / 2 : 2)
          const dx = pos.x - m.position.x
          const dz = pos.z - m.position.z
                      if (Math.abs(dx) < halfX + pr && Math.abs(dz) < halfZ + pr) {
              const px = halfX + pr - Math.abs(dx)
              const pz = halfZ + pr - Math.abs(dz)
              if (px < pz) pos.x += (dx === 0 ? (pos.x < m.position.x ? -1 : 1) : Math.sign(dx)) * px
              else pos.z += (dz === 0 ? (pos.z < m.position.z ? -1 : 1) : Math.sign(dz)) * pz
            }
        }
      }
    } else {
      for (const o of this.themeObstacles) {
        const d2 = this.player.group.position.distanceToSquared(o.position)
        if (d2 < 1.6 ** 2) {
          const push = this.player.group.position.clone().sub(o.position).setY(0).normalize().multiplyScalar(0.08)
          this.player.group.position.add(push)
        }
      }
    }
    // Optional: enemy→obstacle collision on Jeeves only (simple grid lookup)
    if (this.currentTheme === 'jeeves') {
      const cs = this.obstacleCellSize
      const resolve = (e: Enemy) => {
        const pos = e.mesh.position
        const key = `${Math.floor(pos.x / cs)},${Math.floor(pos.z / cs)}`
        const neighbors = [key]
        const [cx, cz] = key.split(',').map(Number)
        const around = [[1,0],[-1,0],[0,1],[0,-1]]
        for (const [dx, dz] of around) neighbors.push(`${cx+dx},${cz+dz}`)
        let handledClimb = false
        for (const k of neighbors) {
          const arr = this.themeObstacleCells.get(k)
          if (!arr) continue
          for (const m of arr) {
            const par: any = (m.geometry as any)?.parameters || {}
            const half = (par.width ? par.width / 2 : 2)
            const dx = pos.x - m.position.x
            const dz = pos.z - m.position.z
            if (Math.abs(dx) < half + 0.4 && Math.abs(dz) < half + 0.4) {
              if (e.canClimb) {
                // start/continue climbing instead of pushing out
                e.climbState = e.climbState ?? 'ground'
                if (e.climbState === 'ground') e.climbState = 'ascending'
                handledClimb = true
                break
              } else {
                const px = half + 0.4 - Math.abs(dx)
                const pz = half + 0.4 - Math.abs(dz)
                if (px < pz) pos.x += Math.sign(dx) * px; else pos.z += Math.sign(dz) * pz
              }
            }
          }
          if (handledClimb) break
        }
        // If on top or climbing, manage vertical motion here (groundY=0.5, top=2.5)
        if (e.canClimb) {
          const groundY = 0.5, topY = 2.5
          if (e.climbState === 'ascending') {
            pos.y = Math.min(topY, pos.y + 3 * dt)
            if (pos.y >= topY - 1e-3) { e.climbState = 'onTop'; e.climbUntil = this.gameTime + 0.6 }
          } else if (e.climbState === 'onTop') {
            if ((e.climbUntil ?? 0) <= this.gameTime) e.climbState = 'descending'
          } else if (e.climbState === 'descending') {
            pos.y = Math.max(groundY, pos.y - 3 * dt)
            if (pos.y <= groundY + 1e-3) e.climbState = 'ground'
          } else if (!handledClimb) {
            // Not climbing and not overlapping; keep at ground
            if (pos.y !== groundY) pos.y = Math.max(groundY, pos.y - 3 * dt)
          }
        }
      }
      for (const e of this.enemies) {
        if (!e.alive) continue
        resolve(e)
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
    } else if (this.input.hasRecentMouseMove()) {
      this.raycaster.setFromCamera(new THREE.Vector2(this.input.mouse.x, this.input.mouse.y), this.camera)
      const hitPoint = new THREE.Vector3()
      this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint)
      aimVector.copy(hitPoint.sub(this.player.group.position))
      aimVector.y = 0
      aimVector.normalize()
    } else if (this.input.hasRecentTouch()) {
      aimVector.set(0, 0, 0)
    }
    if (aimVector.lengthSq() > 0) {
      const yaw = Math.atan2(aimVector.x, aimVector.z)
      this.player.facing = yaw
      this.player.group.rotation.y = yaw
    }

    // Primary shooting
    this.fireTimer += dt
    const aimActive = this.input.axesRight.x !== 0 || this.input.axesRight.y !== 0
    const shouldFire = this.autoFire || this.input.mouseDown || aimActive
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
            const dmg = this.crtBeamDps * dt
            e.hp -= dmg
            this.onEnemyDamaged(e, dmg)
            this.onEnemyDamaged(e, dmg)
            const nowT = this.gameTime
            if ((e.nextDmgToastTime ?? 0) <= nowT) {
              this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
              e.nextDmgToastTime = nowT + 0.15
            }
            if (e.hp <= 0) {
            e.alive = false
            this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
              this.spawnExplosion(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.dropXpOnDeath(e)
              if (Math.random() < 0.25) this.dropPickup(e.mesh.position.clone())
            } else this.audio.playImpact()
          }
        }
      }
    }

    // Tape Whirl update
    if (this.ownedWeapons.has('Tape Whirl') && this.whirlSaws.length > 0) {
      // Toggle cycle like CRT beam
      this.whirlTimer += dt
      const curr = this.whirlOn ? this.whirlOnDuration : this.whirlOffDuration
      if (this.whirlTimer >= curr) { this.whirlTimer = 0; this.whirlOn = !this.whirlOn }
      for (let i = 0; i < this.whirlSaws.length; i++) {
        const saw = this.whirlSaws[i]
        const angle = this.gameTime * this.whirlSpeed + (i * Math.PI * 2) / this.whirlSaws.length
        const offset = new THREE.Vector3(Math.cos(angle) * this.whirlRadius, 0.6, Math.sin(angle) * this.whirlRadius)
        saw.visible = this.whirlOn
        saw.position.copy(this.player.group.position).add(offset)
        if (!this.whirlOn) continue
        // Damage enemies on touch
        for (const e of this.enemies) {
          if (!e.alive) continue
          const hitDist = 1.0 // horizontal radius for contact
          const sp = saw.position.clone(); sp.y = 0
          const ep = e.mesh.position.clone(); ep.y = 0
          if (sp.distanceToSquared(ep) < hitDist * hitDist) {
            const dmg = this.whirlDamage * dt
            e.hp -= dmg
            this.onEnemyDamaged(e, dmg)
            const nowT = this.gameTime
            if ((e.nextDmgToastTime ?? 0) <= nowT) {
              this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
              e.nextDmgToastTime = nowT + 0.15
            }
            if (e.hp <= 0) {
              e.alive = false
              this.scene.remove(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.disposeObjectDeep(e.mesh)
              if (e.face) this.disposeObjectDeep(e.face)
              this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.dropXpOnDeath(e)
            } else {
              this.audio.playImpact()
              // Brief grey tint and face ouch
              e.hitTintColor = 0xaaaaaa; e.hitTintUntil = this.gameTime + 0.05; e.faceOuchUntil = this.gameTime + 0.05
              // Knockback should push away from the player, not toward
              const awayFromPlayer = e.mesh.position.clone().sub(this.player.group.position).setY(0).normalize().multiplyScalar(0.035)
              e.mesh.position.add(awayFromPlayer)
              // Dusty magnetic hit effect (throttled per enemy)
              const now = this.gameTime
              if (!e.nextWhirlFxTime || now >= e.nextWhirlFxTime) {
                this.spawnWhirlDust(e.mesh.position.clone())
                e.nextWhirlFxTime = now + 0.08
              }
            }
          }
        }
      }
    }

    // Sata Cable Tail update (follow and flap)
    if (this.ownedWeapons.has('Sata Cable Tail') && this.sataTailGroup && this.sataTailSegments.length > 0) {
      // Keep tail anchored to player local, and just animate local offsets for a floppy feel
      const tNow = this.gameTime
      // Movement-driven flop: zero when standing still, increases with speed toward tail end
      const mv = this.input.getMoveVector()
      const moveMag = Math.min(1, Math.hypot(mv.x, mv.y))
      for (let i = 0; i < this.sataTailSegments.length; i++) {
        const seg = this.sataTailSegments[i]
        const k = i / (this.sataTailSegments.length - 1)
        const endWeight = k * k // more at tail end; near base ~0
        const sway = Math.sin(tNow * this.sataTailFreq + k * 2.3) * this.sataTailAmp * endWeight * moveMag
        const lift = Math.cos(tNow * (this.sataTailFreq * 0.55) + k * 2.0) * 0.02 * endWeight * moveMag
        seg.position.set(sway, lift, -k * this.sataTailLength)
        // Slight yaw to accentuate ribbon effect
        seg.rotation.y = 0.15 * Math.sin(tNow * (this.sataTailFreq * 0.8) + k * 2.6) * endWeight * moveMag
      }
      // Damage tick: distance check around segments
      const dps = this.sataTailDps
      for (const e of this.enemies) {
        if (!e.alive) continue
        const p = e.mesh.position.clone(); p.y = 0
        // Quick reject relative to player position (tail never far from player)
        const pr = this.player.group.position.clone(); pr.y = 0
        if (p.distanceToSquared(pr) > (this.sataTailLength + 1.2) ** 2) continue
        for (const seg of this.sataTailSegments) {
          const wp = seg.getWorldPosition(new THREE.Vector3()); wp.y = 0
          const dist = p.distanceTo(wp)
            if (dist < 0.5) {
              const dmg = dps * dt
              e.hp -= dmg
              this.onEnemyDamaged(e, dmg)
              e.hitTintColor = ((e.baseColorHex ?? 0xffffff) & 0xf0f0f0) >>> 0
              e.hitTintUntil = this.gameTime + 0.06
              const nowT = this.gameTime
              if ((e.nextDmgToastTime ?? 0) <= nowT) {
                this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
                e.nextDmgToastTime = nowT + 0.15
              }
            if (e.hp <= 0) {
              e.alive = false
              this.scene.remove(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.disposeObjectDeep(e.mesh)
              if (e.face) this.disposeObjectDeep(e.face)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.dropXpOnDeath(e)
              // Zap effect on kill
              this.spawnZapEffect(wp, e.mesh.position.clone())
            } else {
            // Minor zap on hit + brief yellow tint and face ouch
            this.spawnZapEffect(wp, e.mesh.position.clone(), 0.5)
            e.hitTintColor = 0xffff66; e.hitTintUntil = this.gameTime + 0.06; e.faceOuchUntil = this.gameTime + 0.06
            }
            break
          }
        }
      }
    }

    // Paint.exe update
    if (this.ownedWeapons.has('Paint.exe') && this.paintLevel > 0) {
      this.paintTimer += dt
      const phase = this.paintOn ? this.paintOnDuration : this.paintOffDuration
      if (this.paintTimer >= phase) { this.paintTimer = 0; this.paintOn = !this.paintOn }
      const playerXZ = this.player.group.position.clone(); playerXZ.y = 0
      // Emit paint swaths only while on
      if (this.paintOn) {
        // On mobile, cap the number of live swaths to reduce churn
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        const maxSwaths = isMobile ? 40 : 80
        if (this.paintSwaths.length > maxSwaths) {
          const old = this.paintSwaths.shift()!
          this.scene.remove(old.mesh)
          old.mesh.scale.set(1,1,1)
          this.paintDiskPool.push(old.mesh)
        }
        if (!Number.isFinite(this.lastPaintPos.x)) this.lastPaintPos.copy(playerXZ)
        if (playerXZ.distanceToSquared(this.lastPaintPos) >= this.paintGap * this.paintGap) {
          // Round disk under player
          const r = this.paintRadius * (0.85 + Math.random() * 0.3)
          // Acquire from pool
          let disk = this.paintDiskPool.pop()
          if (!disk) disk = new THREE.Mesh(this.sharedPaintGeom, this.sharedPaintMat)
          // scale shared geometry to radius
          disk.scale.setScalar(r)
          disk.rotation.x = -Math.PI / 2
          disk.position.copy(playerXZ).setY(0.02)
          this.scene.add(disk)
          this.paintSwaths.push({ pos: playerXZ.clone(), t: this.gameTime, mesh: disk, radius: r })
          this.lastPaintPos.copy(playerXZ)
        }
      }
      // Expire old swaths and apply damage to enemies standing on them
      for (let i = this.paintSwaths.length - 1; i >= 0; i--) {
        const s = this.paintSwaths[i]
        if (this.gameTime - s.t > this.paintDuration) {
          this.scene.remove(s.mesh)
          s.mesh.scale.set(1, 1, 1)
          this.paintDiskPool.push(s.mesh)
          this.paintSwaths.splice(i, 1)
          continue
        }
        // Damage
        for (const e of this.enemies) {
          if (!e.alive) continue
          const ep = e.mesh.position.clone(); ep.y = 0
          const dist = ep.distanceTo(s.pos)
          if (dist <= s.radius) {
            const dmg = this.paintDps * dt
            e.hp -= dmg
            // Permanently paint enemies green-ish when touched
            e.baseColorHex = 0x3c9e87
            // Damage toast (throttle per enemy)
            const nowT = this.gameTime
            if ((e.nextDmgToastTime ?? 0) <= nowT) {
              this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
              e.nextDmgToastTime = nowT + 0.15
            }
            if (e.hp <= 0) {
              e.alive = false
             this.scene.remove(e.mesh)
             if (e.face) this.scene.remove(e.face)
             this.disposeObjectDeep(e.mesh)
             if (e.face) this.disposeObjectDeep(e.face)
                             this.onEnemyDown()
               this.score += 1
               this.updateHud()
               this.dropXpOnDeath(e)
            }
          }
        }
      }
    }

          // Special weapons passive timers
      // Speed boost in Kernel Panic
      const speedMul = this.kernelPanic ? 1.4 : 1.0
      for (const e of this.enemies) if (e.alive) e.speed = (e.baseSpeed ?? e.speed) * speedMul

      // Jeeves climbing behavior (lightweight)
      if (this.currentTheme === 'jeeves') {
        const cs = this.obstacleCellSize
        for (const e of this.enemies) {
          if (!e.alive || !e.canClimb) continue
          const pos = e.mesh.position
          // Determine obstacle under/near
          const key = `${Math.floor(pos.x / cs)},${Math.floor(pos.z / cs)}`
          const neighbors = [key]
          const [cx, cz] = key.split(',').map(Number)
          const around = [[0,0],[1,0],[-1,0],[0,1],[0,-1]]
          neighbors.length = 0; for (const d of around) neighbors.push(`${cx+d[0]},${cz+d[1]}`)
          let over = false
          for (const nk of neighbors) {
            const arr = this.themeObstacleCells.get(nk)
            if (!arr) continue
            for (const m of arr) {
              const par: any = (m.geometry as any)?.parameters || {}
              const hx = (par.width ? par.width / 2 : 2), hz = (par.depth ? par.depth / 2 : 2)
              const dx = pos.x - m.position.x, dz = pos.z - m.position.z
              if (Math.abs(dx) < hx && Math.abs(dz) < hz) { over = true; break }
            }
            if (over) break
          }
          const yTop = over ? 2.5 : 0.5 // climb height
          if (over) {
            if (e.climbState === 'ground' || e.climbState === undefined) { e.climbState = 'ascending'; e.climbTargetY = yTop }
            if (e.climbState === 'ascending') {
              pos.y = Math.min(yTop, pos.y + dt * 3)
              if (pos.y >= yTop - 1e-3) { e.climbState = 'onTop'; e.climbUntil = this.gameTime + 0.6 }
            } else if (e.climbState === 'onTop') {
              if ((e.climbUntil ?? 0) <= this.gameTime) e.climbState = 'descending'
            } else if (e.climbState === 'descending') {
              pos.y = Math.max(0, pos.y - dt * 3)
              if (pos.y <= 0.01) e.climbState = 'ground'
            }
          } else {
            // Not over obstacle; ensure on ground
            if (pos.y > 0) { pos.y = Math.max(0, pos.y - dt * 3); if (pos.y <= 0.01) e.climbState = 'ground' }
          }
        }
      }

      if (this.ownedWeapons.has('Dial-up Burst')) {
      this.modemWaveTimer += dt
      if (this.modemWaveTimer >= this.modemWaveInterval) {
        this.modemWaveTimer = 0
        // Single shockwave per cycle
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

    // Spawning waves and difficulty ramp with cadence modulation
    this.spawnAccumulator += dt
    const minute = Math.floor(this.gameTime / 60)
    // Detect wave transition and schedule cull of older waves
    if (minute !== this.lastWaveMinute) {
      if (minute > this.lastWaveMinute) this.onWaveStart(minute)
      this.lastWaveMinute = minute
    }
    // Baseline spawn interval gets faster over time (softened for perf)
    let baseInterval = Math.max(0.6, 2.0 - this.gameTime * 0.03)
    if (this.kernelPanic) baseInterval *= 0.45 // much faster spawns
    // Gentle sine modulation (~10% swing)
    this.spawnPhase += dt * 0.8
    const sineMod = 1 + 0.1 * Math.sin(this.spawnPhase)
    // Ensure a hard ceiling on interval so it never stalls
    const modInterval = Math.max(0.3, baseInterval * sineMod)
    // Occasional micro-bursts: short-lived faster spawning
    if (this.microBurstLeft <= 0 && Math.random() < 0.001) {
      // 1–2 seconds of quicker spawns
      this.microBurstLeft = 1 + Math.random() * 1
    }
    const burstFactor = this.microBurstLeft > 0 ? 0.65 : 1
    if (this.microBurstLeft > 0) this.microBurstLeft -= dt
    const effectiveInterval = Math.max(0.45, modInterval * burstFactor)
    if (this.spawnAccumulator >= effectiveInterval) {
      this.spawnAccumulator = 0
      // Slow the ramp of simultaneous spawns for perf
      const baseCount = 2 + Math.min(6, Math.floor(this.gameTime / 30))
      // During micro-bursts, add a couple extra with slight delays
      const extra = this.microBurstLeft > 0 ? 1 : 0
      const total = baseCount + extra
      // Enforce global cap by limiting scheduled spawns
      const remainingCapacity = Math.max(0, this.maxActiveEnemies - this.aliveEnemies)
      const toSpawn = Math.min(total, remainingCapacity)
      for (let i = 0; i < toSpawn; i++) {
        const delay = i < baseCount ? 0 : (i - baseCount + 1) * 120
        if (delay === 0) this.spawnEnemyByWave(minute)
        else setTimeout(() => this.spawnEnemyByWave(minute), delay)
      }
    }

    // Update enemies with different behaviors (throttle far ones); track onscreen time
    for (const e of this.enemies) {
      if (!e.alive) continue
      // Skip detailed updates for very distant enemies every other frame
      const toCam = this.camera.position.clone().sub(e.mesh.position)
      const far = toCam.lengthSq() > 60 * 60
      // Update lastOnscreenAt if visible in frustum (more robust than NDC margin)
      const onScreen = this._frustum.containsPoint(e.mesh.position)
      if (onScreen) e.lastOnscreenAt = this.gameTime
      if (far && ((this.frameId ?? 0) % 2 === 1)) continue
      e.timeAlive += dt
      const toPlayer = this.player.group.position.clone().sub(e.mesh.position)
      toPlayer.y = 0
      let dir = toPlayer.clone().normalize()
      // Elite aggressive enemies are faster
      if (e.eliteAggressive) dir.multiplyScalar(1.2)
      // Anti-clump hesitation: smooth decel -> brief pause -> accel cycles
      const nowTime = this.gameTime
      if (e.hesitateState == null) {
        e.hesitateState = 'moving'
        e.hesitateTimer = 0
        e.speedScale = 1
        // Schedule first hesitation randomly between 2–6s
        e.nextHesitateAt = nowTime + 2 + Math.random() * 4
      }
      e.hesitateTimer = (e.hesitateTimer ?? 0) + dt
      if ((e.nextHesitateAt ?? 0) > 0 && nowTime >= (e.nextHesitateAt ?? 0)) {
        // Begin deceleration phase over ~0.4s
        e.hesitateState = 'decel'
        e.hesitateTimer = 0
        e.hesitateDur = 0.4 + Math.random() * 0.2
        e.nextHesitateAt = -1
      }
      if (e.hesitateState === 'decel') {
        const durr = e.hesitateDur ?? 0.5
        const t = Math.min(1, (e.hesitateTimer ?? 0) / durr)
        e.speedScale = 1 - t * t // ease-out
        if (t >= 1) { e.hesitateState = 'paused'; e.hesitateTimer = 0; e.hesitateDur = 0.15 + Math.random() * 0.25 }
      } else if (e.hesitateState === 'paused') {
        e.speedScale = 0
        // While paused, slightly random-walk direction to spread clumps
        const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)
        dir.add(jitter).normalize()
        if ((e.hesitateTimer ?? 0) >= (e.hesitateDur ?? 0.25)) {
          e.hesitateState = 'accel'
          e.hesitateTimer = 0
          e.hesitateDur = 0.35 + Math.random() * 0.2
        }
      } else if (e.hesitateState === 'accel') {
        const durr = e.hesitateDur ?? 0.4
        const t = Math.min(1, (e.hesitateTimer ?? 0) / durr)
        e.speedScale = t * t // ease-in
        if (t >= 1) {
          e.hesitateState = 'moving'
          e.hesitateTimer = 0
          e.hesitateDur = undefined
          // Schedule the next hesitation with randomness (2–6s)
          e.nextHesitateAt = nowTime + 2 + Math.random() * 4
          e.speedScale = 1
        }
      } else {
        e.speedScale = 1
      }
      // Apply temporary slow from Dial-up Burst
      if ((e.burstSlowUntil ?? 0) > this.gameTime) {
        e.speedScale *= e.burstSlowFactor ?? 0.7
      }
      if (e.type === 'runner') {
        // Accelerate over time, but ~20% slower overall
        const baseRunnerSpeed = (2.8 + Math.min(3, this.gameTime * 0.02)) * 0.8
        // Introduce brief pauses for wave-2 runners (spawnWave === 1)
        if (e.behaviorState === undefined) {
          const isWaveTwo = e.spawnWave === 1
          e.behaviorState = 'running'
          e.behaviorTimer = 0
          // Wave 2 pauses slightly more; later waves pause less
          e.behaviorRunDuration = isWaveTwo
            ? 0.8 + Math.random() * 0.55 // 0.8–1.35s running
            : 1.1 + Math.random() * 0.7  // 1.1–1.8s running
          e.behaviorPauseDuration = isWaveTwo
            ? 0.35 + Math.random() * 0.2  // 0.35–0.55s pause
            : 0.15 + Math.random() * 0.2  // 0.15–0.35s pause
        }
        // Advance behavior timer and toggle states
        e.behaviorTimer! += dt
        if (e.behaviorState === 'running' && e.behaviorTimer! >= (e.behaviorRunDuration ?? 1.2)) {
          e.behaviorState = 'paused'
          e.behaviorTimer = 0
          // Resample next pause for subtle variation
          const isWaveTwo = e.spawnWave === 1
          e.behaviorPauseDuration = isWaveTwo
            ? 0.35 + Math.random() * 0.2
            : 0.15 + Math.random() * 0.2
        } else if (e.behaviorState === 'paused' && e.behaviorTimer! >= (e.behaviorPauseDuration ?? 0.25)) {
          e.behaviorState = 'running'
          e.behaviorTimer = 0
          // Resample next run duration
          const isWaveTwo = e.spawnWave === 1
          e.behaviorRunDuration = isWaveTwo
            ? 0.8 + Math.random() * 0.55
            : 1.1 + Math.random() * 0.7
        }
        e.speed = e.behaviorState === 'paused' ? 0 : baseRunnerSpeed
      } else if (e.type === 'zigzag') {
        const perp = new THREE.Vector3(-dir.z, 0, dir.x)
        dir.addScaledVector(perp, Math.sin(e.timeAlive * 6) * 0.6).normalize()
      } else if (e.type === 'tank') {
        // Boo-like shy tank: creeps when looked at; chases when not
        if (e.booShy === undefined) e.booShy = true
        if (e.booShy) {
          const toEnemy = e.mesh.position.clone().sub(this.camera.position).setY(0).normalize()
          const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize()
          const facing = camForward.dot(toEnemy) > 0.85
          if (facing) e.speed = Math.min(e.speed, 0.4)
          else e.speed = Math.max(e.speed, 2.2)
        }
      } else if (e.type === 'shooter') {
        // Blend upstream ring strafing with bravery toggle
        const dist = toPlayer.length()
        if (e.shooterAggressive) {
          if (dist < 1.2) e.speed *= 0.9
        } else {
          const prefer = 7
          const band = 1.2
          if (dist < prefer - band) {
            dir.multiplyScalar(-1)
          } else if (dist > prefer + band) {
            // keep dir toward
          } else {
            dir = new THREE.Vector3(-dir.z, 0, dir.x)
            if (Math.sin(e.timeAlive * 1.5) < 0) dir.multiplyScalar(-1)
          }
        }
      } else if (e.type === 'spinner') {
        // spins while moving toward player
        e.mesh.rotation.y += dt * 6
      } else if (e.type === 'splitter') {
        // on low HP, split into two runners
        if (e.hp < 2 && e.alive) {
          e.alive = false
          this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
          this.scene.remove(e.mesh)
          this.onEnemyDown()
          for (let i = 0; i < 2; i++) {
            const child = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffdd55 }))
            child.position.copy(e.mesh.position).add(new THREE.Vector3((Math.random()-0.5)*0.8, 0.35, (Math.random()-0.5)*0.8))
            this.scene.add(child)
            const baseColor = ((child.material as THREE.MeshBasicMaterial).color.getHex?.() ?? 0xffdd55) as number
            this.enemies.push({ mesh: child, alive: true, speed: 3.0, hp: 2, type: 'runner', timeAlive: 0, spawnWave: e.spawnWave, baseColorHex: baseColor })
            this.aliveEnemies++
          }
          continue
        }
      } else if (e.type === 'bomber') {
        // New: Flanking bomber. Circles to side then dashes toward predicted player pos.
        const dist = toPlayer.length()
        if (!e.bomberPhase) { e.bomberPhase = 'flank'; e.baseSpeed = 2.4 }
        if (e.bomberPhase === 'flank') {
          // Orbit-ish move with slight inward pull
          const perp = new THREE.Vector3(-dir.z, 0, dir.x)
          dir.addScaledVector(perp, 0.9).addScaledVector(toPlayer.normalize(), 0.25).normalize()
          e.speed = (e.baseSpeed ?? 2.4)
          // When within range, switch to dash
          if (dist < 5) { e.bomberPhase = 'dash'; e.dashRemaining = 0.45 }
        } else if (e.bomberPhase === 'dash') {
          e.speed = 5.5
          e.dashRemaining! -= dt
          if (e.dashRemaining! <= 0) { e.bomberPhase = 'flank' }
        }
        // On close proximity, explode
        if (dist < 1.2) {
          e.alive = false
          this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
          this.spawnStylishExplosion(e.mesh)
          this.onEnemyDown()
          // Reduced bomber damage to 1 (unchanged) but add brief stun knockback feel
          this.player.hp = Math.max(0, this.player.hp - 1)
          this.updateHPBar()
          if (this.player.hp <= 0) { this.onPlayerDeath(); return }
        }
      } else if (e.type === 'sniper') {
        // keeps long distance
        const dist = toPlayer.length()
        if (dist < 9) dir.multiplyScalar(-1)
      } else if (e.type === 'weaver') {
        // Combine upstream weave with enhanced weave speed
        const perp = new THREE.Vector3(-dir.z, 0, dir.x)
        const t = e.timeAlive
        const wav = Math.sin(t * 3) * 0.8
        dir.addScaledVector(perp, wav).normalize()
        e.speed = 2.8
      } else if (e.type === 'charger') {
        // Winds up, then dashes at high speed, then recovers
        if (e.behaviorState === undefined) {
          e.behaviorState = 'windup'
          e.behaviorTimer = 0
          e.baseSpeed = 2.3
        }
        e.behaviorTimer! += dt
        if (e.behaviorState === 'windup') {
          e.speed = (e.baseSpeed ?? 2.3) * 0.4
          if (e.behaviorTimer! > 0.6) {
            e.behaviorState = 'dash'
            e.behaviorTimer = 0
            e.dashRemaining = 0.45
          }
        } else if (e.behaviorState === 'dash') {
          e.speed = 6.0
          e.dashRemaining! -= dt
          if (e.dashRemaining! <= 0) {
            e.behaviorState = 'recover'
            e.behaviorTimer = 0
          }
        } else if (e.behaviorState === 'recover') {
          e.speed = (e.baseSpeed ?? 2.3) * 0.7
          if (e.behaviorTimer! > 0.5) {
            e.behaviorState = 'windup'
            e.behaviorTimer = 0
          }
        }
      } else if (e.type === 'orbiter') {
        // Arcing swoop near player; otherwise orbit with slight inward pull
        if (e.behaviorState === undefined) {
          e.behaviorState = 'orbit'
          e.orbitDir = Math.random() < 0.5 ? 1 : -1
          e.baseSpeed = 2.4
          e.behaviorPhase = Math.random() < 0.5 ? 1 : -1
        }
        const dist = toPlayer.length()
        const perp = new THREE.Vector3(-dir.z, 0, dir.x)
        if (dist < 5) {
          if (Math.random() < 0.02) e.behaviorPhase = (((e.behaviorPhase ?? 1) * -1) as 1 | -1)
          dir.addScaledVector(perp, (e.behaviorPhase ?? 1) * 0.9).addScaledVector(toPlayer.normalize(), 0.6).normalize()
          e.speed = (e.baseSpeed ?? 2.4) * 1.35
        } else {
          dir.addScaledVector(perp, e.orbitDir! * 0.9).addScaledVector(toPlayer.normalize(), 0.25).normalize()
          e.speed = e.baseSpeed!
        }
      } else if (e.type === 'teleport') {
        // Periodically teleports to a ring near the player, then lunges briefly
        if (e.nextTeleportTime === undefined) e.nextTeleportTime = this.gameTime + 2 + Math.random() * 2
        if (this.gameTime >= e.nextTeleportTime) {
          const angle = Math.random() * Math.PI * 2
          const radius = 6 + Math.random() * 2
          const px = this.player.group.position.x + Math.cos(angle) * radius
          const pz = this.player.group.position.z + Math.sin(angle) * radius
          e.mesh.position.set(px, e.mesh.position.y, pz)
          if (e.face) e.face.position.set(px, e.face.position.y, pz)
          e.nextTeleportTime = this.gameTime + 2.5 + Math.random() * 2.5
          e.behaviorState = 'dash'
          e.dashRemaining = 0.3
        }
        // On fresh spawn, optionally carry a short initial burst that decays quickly
        if ((e as any).dashRemaining === undefined && e.timeAlive < 0.5 && (e as any).spawnBurstApplied !== true) {
          ;(e as any).dashRemaining = 0.35
          ;(e as any).spawnBurstApplied = true
        }
        if (e.behaviorState === 'dash' && e.dashRemaining! > 0 || (e as any).dashRemaining > 0) {
          e.dashRemaining! -= dt
          e.speed = 4.5
        } else {
          e.speed = 2.3
        }
      } else if (e.type === 'brute') {
        // New: Slammer. Wind up, then ground slam that knocks back player slightly if close
        if (!e.nextSlamAt) e.nextSlamAt = this.gameTime + 2 + Math.random() * 2
        if (e.slamWindupUntil && this.gameTime < e.slamWindupUntil) {
          e.speed = 0.7
        } else if (this.gameTime >= (e.nextSlamAt ?? 0)) {
          // Perform slam
          const radius = 2.6
          const center = e.mesh.position.clone()
          // Visual ring
          const ringGeom = new THREE.RingGeometry(radius * 0.7, radius * 0.72, 24)
          const ringMat = new THREE.MeshBasicMaterial({ color: 0xdd6666, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
          const ring = new THREE.Mesh(ringGeom, ringMat)
          ring.rotation.x = -Math.PI / 2
          ring.position.copy(center).setY(0.03)
          this.scene.add(ring)
          const start = performance.now()
          const dur = 220
          const anim = () => {
            const t = (performance.now() - start) / dur
            if (t >= 1) { this.scene.remove(ring); ringGeom.dispose(); (ring.material as any).dispose?.(); return }
            ring.geometry.dispose()
            ring.geometry = new THREE.RingGeometry(radius * (0.65 + 0.25 * t), radius * (0.67 + 0.27 * t), 28)
            ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)
            requestAnimationFrame(anim)
          }
          anim()
          // Apply effect to player
          const d = this.player.group.position.distanceTo(center)
          if (d < radius) {
            this.player.hp = Math.max(0, this.player.hp - 1)
            this.updateHPBar()
            const away = this.player.group.position.clone().sub(center).setY(0).normalize()
            this.player.group.position.add(away.multiplyScalar(Math.max(0.1, (radius - d) * 0.15)))
            this.audio.playOuch()
            if (this.player.hp <= 0) { this.onPlayerDeath(); return }
          }
          e.nextSlamAt = this.gameTime + 2.2 + Math.random() * 1.6
          e.slamWindupUntil = this.gameTime + 0.4
          e.speed = 0.7
        } else {
          // Normal slow approach
          e.speed = 1.6
        }
      }
      // Apply brief tint if recently hit
      if ((e.hitTintUntil ?? 0) > this.gameTime && e.hitTintColor != null) {
        ;(e.mesh.material as THREE.MeshBasicMaterial).color.setHex(e.hitTintColor!)
      } else if (e.baseColorHex != null) {
        ;(e.mesh.material as THREE.MeshBasicMaterial).color.setHex(e.baseColorHex!)
      }
      // Boo behavior: when looked at, creep slowly; when not, chase fast
      if (e.booWave10) {
        const toEnemy = e.mesh.position.clone().sub(this.camera.position).setY(0).normalize()
        const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).setY(0).normalize()
        const facing = camForward.dot(toEnemy) > 0.85
        const speedScale = Math.max(0, Math.min(1, e.speedScale ?? 1))
        const mult = facing ? 0.1 : 1.6
        e.mesh.position.add(dir.multiplyScalar(e.speed * speedScale * mult * dt))
      } else {
        const speedScale = Math.max(0, Math.min(1, e.speedScale ?? 1))
        let mult = 1
        // Giant enrage: if recently hit several times, surge speed for a short time
        if (e.type === 'giant') {
          if ((e.lastHitAt ?? -999) > this.gameTime - 0.8) {
            e.recentHits = (e.recentHits ?? 0) + 0 // maintained elsewhere when hit
            if ((e.giantEnrageUntil ?? 0) > this.gameTime) mult = 1.8
          } else {
            e.recentHits = 0
          }
        }
        e.mesh.position.add(dir.multiplyScalar(e.speed * speedScale * mult * dt))
      }

      // Collide with player
      if (e.mesh.position.distanceToSquared(this.player.group.position) < (this.player.radius + 0.5) ** 2) {
        if (this.invulnTimer <= 0) {
          e.alive = false
          this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
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
        // Draw ouch or normal face
        if (e.faceTex && e.faceCanvas) {
          const now = this.gameTime
          if ((e.faceOuchUntil ?? 0) > now) {
            // quick >.< face
            const ctx = e.faceCanvas.getContext('2d')!
            ctx.clearRect(0,0,e.faceCanvas.width,e.faceCanvas.height)
            ctx.fillStyle = '#ffcc88'
            ctx.fillRect(0,0,e.faceCanvas.width,e.faceCanvas.height)
            ctx.fillStyle = '#000'
            ctx.font = '20px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText('>.<', e.faceCanvas.width/2, e.faceCanvas.height/2)
            e.faceTex.needsUpdate = true
          }
        }
        if (e.type === 'giant' && e.faceTex && e.faceCanvas) {
          const nowMs = performance.now()
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
          const interval = isMobile ? 200 : 120
          if ((e.nextFaceUpdate ?? 0) <= nowMs) {
            const frame = Math.floor(e.timeAlive * 10)
            this.drawAnimatedFace(e.faceCanvas, frame)
            e.faceTex.needsUpdate = true
            e.nextFaceUpdate = nowMs + interval
          }
        }
      }
    }

    // Offscreen cull for enemies 2+ waves old
    const currentWave = Math.floor(this.gameTime / 60)
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (currentWave - e.spawnWave < 1) continue
      // Never cull if currently onscreen
      const visibleNow = this._frustum.containsPoint(e.mesh.position)
      if (visibleNow) continue
      const lastSeen = e.lastOnscreenAt ?? this.gameTime
      if (this.gameTime - lastSeen > this.offscreenCullSeconds) {
        e.alive = false
          this.scene.remove(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.disposeObjectDeep(e.mesh)
          if (e.face) this.disposeObjectDeep(e.face)
        this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
      }
    }

    // Rebuild spatial hash for enemies near projectiles
    this.spatialMap.clear()
    const cs = this.spatialCellSize
    const keyFor = (v: THREE.Vector3) => `${Math.floor(v.x / cs)},${Math.floor(v.z / cs)}`
    for (const e of this.enemies) {
      if (!e.alive) continue
      const k = keyFor(e.mesh.position)
      let arr = this.spatialMap.get(k)
      if (!arr) { arr = []; this.spatialMap.set(k, arr) }
      arr.push(e)
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
      // Update velocity for rockets (homing), then integrate
      if (p.kind === 'rocket') {
        // Pick a near target occasionally
        let nearest: Enemy | null = null
        let best = Infinity
        for (const e of this.enemies) {
          if (!e.alive) continue
          const d2 = e.mesh.position.distanceToSquared(p.mesh.position)
          if (d2 < best) { best = d2; nearest = e }
        }
        if (nearest) {
          const desired = nearest.mesh.position.clone().sub(p.mesh.position).setY(0).normalize().multiplyScalar(this.rocketSpeed)
          p.velocity.lerp(desired, this.rocketTurn)
          p.mesh.lookAt(nearest.mesh.position.clone().setY(p.mesh.position.y))
        }
      }
      p.mesh.position.addScaledVector(p.velocity, dt)

      // Bullet vs Jeeves obstacles (AABB test, stop bullet)
      if (this.currentTheme === 'jeeves') {
        const csj = this.obstacleCellSize
        const pk = `${Math.floor(p.mesh.position.x / csj)},${Math.floor(p.mesh.position.z / csj)}`
        const neighbors = [pk]
        const [pcx, pcz] = pk.split(',').map(Number)
        const around = [[1,0],[-1,0],[0,1],[0,-1]]
        for (const [dx, dz] of around) neighbors.push(`${pcx+dx},${pcz+dz}`)
        let blocked = false
        for (const nk of neighbors) {
          const obs = this.themeObstacleCells.get(nk)
          if (!obs) continue
          for (const m of obs) {
            const par: any = (m.geometry as any)?.parameters || {}
            const hx = (par.width ? par.width / 2 : 2)
            const hz = (par.depth ? par.depth / 2 : 2)
            const dx = p.mesh.position.x - m.position.x
            const dz = p.mesh.position.z - m.position.z
            if (Math.abs(dx) < hx && Math.abs(dz) < hz) { blocked = true; break }
          }
          if (blocked) break
        }
        if (blocked) {
          p.alive = false
          this.scene.remove(p.mesh)
          continue
        }
      }

      // Swept collision against enemies via spatial hash
      const a = prev.clone(); const b = p.mesh.position.clone()
      const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x)
      const minz = Math.min(a.z, b.z), maxz = Math.max(a.z, b.z)
      const kx0 = Math.floor((minx - 0.6) / cs), kx1 = Math.floor((maxx + 0.6) / cs)
      const kz0 = Math.floor((minz - 0.6) / cs), kz1 = Math.floor((maxz + 0.6) / cs)
      let hit = false
      for (let gx = kx0; gx <= kx1 && !hit; gx++) for (let gz = kz0; gz <= kz1 && !hit; gz++) {
        const arr = this.spatialMap.get(`${gx},${gz}`)
        if (!arr) continue
        for (const e of arr) {
          if (!e.alive) continue
          const c = e.mesh.position.clone()
          a.y = b.y = c.y = 0
          const ab = b.clone().sub(a)
          const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())))
          const closest = a.clone().add(ab.multiplyScalar(t))
          const d2 = closest.distanceToSquared(c)
          if (d2 < 0.55 ** 2) {
            const dmg = p.damage
            e.hp -= dmg
            this.onEnemyDamaged(e, dmg)
            const nowT = this.gameTime
            if ((e.nextDmgToastTime ?? 0) <= nowT) {
              this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
              e.nextDmgToastTime = nowT + 0.15
            }
            if (e.hp <= 0) {
              e.alive = false
              this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
              this.spawnExplosion(e.mesh)
              if (e.face) this.scene.remove(e.face)
              this.onEnemyDown()
              this.score += 1
              this.updateHud()
              this.dropXpOnDeath(e)
              if (Math.random() < 0.25) this.dropPickup(e.mesh.position.clone())
            } else {
              this.audio.playImpact()
            }
            if (p.pierce > 0) {
              p.pierce -= 1
            } else {
              if (p.kind === 'rocket') this.explodeAt(p.mesh.position.clone(), this.rocketBlastRadius, p.damage)
              p.alive = false
              this.scene.remove(p.mesh)
            }
            hit = true
            break
          }
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
        const inMagnet = dist < this.xpMagnetRadius
        const shouldPull = inMagnet || this.vacuumActive
        if (shouldPull) {
          toP.normalize()
          const pull = this.vacuumActive ? (this.vacuumPull + dist * 2) : (this.xpMagnetRadius - dist + 0.4) * 6
          pk.mesh.position.add(toP.multiplyScalar(pull * dt))
        }
      }
      if (pk.mesh.position.distanceToSquared(this.player.group.position) < (this.player.radius + 0.6) ** 2) {
        pk.alive = false
        this.scene.remove(pk.mesh)
        this.applyPickup(pk)
      }
    }

    // Apply magnet/vacuum to XP orbs after movement step
    for (const orb of this.xpOrbs) {
      if (!orb.alive) continue
      const toPlayer = this.player.group.position.clone().sub(orb.mesh.position)
      toPlayer.y = 0
      const d = toPlayer.length()
      const inMagnet = d < this.xpMagnetRadius
      const shouldPull = inMagnet || this.vacuumActive
      if (shouldPull) {
        toPlayer.normalize()
        const pull = this.vacuumActive ? (this.vacuumPull + d * 2) : (this.xpMagnetRadius - d + 0.4) * 6
        orb.mesh.position.add(toPlayer.multiplyScalar(pull * dt))
      }
    }

    // Auto-expire vacuum after time
    if (this.vacuumActive && this.gameTime >= this.vacuumEndTime) this.vacuumActive = false

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

    // Update frustum from current camera
    this._frustumMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this._frustum.setFromProjectionMatrix(this._frustumMat)
    if (!this.contextLost) this.renderer.render(this.scene, this.camera)
    // Lightweight perf overlay
    if (this.debugPerfOverlay) {
      const now = performance.now()
      if (now >= this.perfOverlayNextUpdate) {
        this.perfOverlayNextUpdate = now + 250
        if (!this.perfOverlayEl) {
          const el = document.createElement('div')
          el.style.position = 'fixed'; el.style.left = '8px'; el.style.bottom = '8px'
          el.style.background = 'rgba(0,0,0,0.4)'; el.style.color = '#9be3ff'; el.style.padding = '6px 8px'
          el.style.border = '1px solid #1f2a44'; el.style.borderRadius = '6px'; el.style.font = '12px ui-monospace, monospace'
          el.style.zIndex = '40'
          document.body.appendChild(el)
          this.perfOverlayEl = el
        }
        const meshes = this.scene.children.length
        const info = this.renderer.info
        const mem = info?.memory || { geometries: 0, textures: 0 }
        const calls = info?.render?.calls ?? 0
        const enemiesAlive = this.enemies.filter(e => e.alive).length
        this.perfOverlayEl!.innerHTML = `Wave ${Math.max(1, Math.floor(this.gameTime / 60) + 1)} · Enemies ${enemiesAlive} · Scene ${meshes} · Geo ${mem.geometries} · Tex ${mem.textures} · Calls ${calls} ${this.contextLost ? '· CONTEXT LOST' : ''}`
      }
    } else if (this.perfOverlayEl) {
      this.perfOverlayEl.remove(); this.perfOverlayEl = undefined
    }
    this.frameId++
    requestAnimationFrame(() => this.loop())
  }

  togglePause() {
    this.isPaused = !this.isPaused
    this.pauseOverlay.style.display = this.isPaused ? 'flex' : 'none'
    if (this.isPaused) this.audio.pauseMusic()
    else this.audio.resumeMusic()
    // Start/stop controller nav for pause overlay
    if (this.isPaused) {
      const actions = Array.from(this.pauseOverlay.querySelectorAll('#btn-resume, #btn-restart, #btn-mainmenu, #btn-fullscreen')) as HTMLButtonElement[]
      this.pauseNavIdx = 0
      const setSel = () => actions.forEach((b, i) => b.classList.toggle('selected', i === this.pauseNavIdx))
      setSel()
      const step = () => {
        if (!this.isPaused) { this.pauseNavRaf = 0; return }
        const gp = this.input.getActiveGamepad()
        const up = !!gp && ((gp.axes?.[1] ?? 0) < -0.5 || gp.buttons?.[12]?.pressed)
        const down = !!gp && ((gp.axes?.[1] ?? 0) > 0.5 || gp.buttons?.[13]?.pressed)
        const a = !!gp && gp.buttons?.[0]?.pressed
        if (up && !this.pauseNavPrevUp) { this.pauseNavIdx = (this.pauseNavIdx - 1 + actions.length) % actions.length; setSel() }
        if (down && !this.pauseNavPrevDown) { this.pauseNavIdx = (this.pauseNavIdx + 1) % actions.length; setSel() }
        if (a && !this.pauseNavPrevA) actions[this.pauseNavIdx]?.click()
        this.pauseNavPrevUp = up; this.pauseNavPrevDown = down; this.pauseNavPrevA = a
        this.pauseNavRaf = requestAnimationFrame(step)
      }
      if (!this.pauseNavRaf) this.pauseNavRaf = requestAnimationFrame(step)
    } else if (this.pauseNavRaf) {
      cancelAnimationFrame(this.pauseNavRaf)
      this.pauseNavRaf = 0
      this.pauseNavPrevUp = this.pauseNavPrevDown = this.pauseNavPrevA = false
    }
  }

  // Daily Disk mode
  isDaily = false
  dailyId = ''
  dailyWavePlan: EnemyType[] = []
  // Debug custom wave plan
  debugUseWavePlan = false
  debugWavePlan: EnemyType[] = []

  private getNewYorkDate() {
    // Compute date in America/New_York without libs by offset approximation
    const now = new Date()
    // Use Intl to get NY components
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    const parts = fmt.formatToParts(now)
    const y = parts.find(p => p.type === 'year')!.value
    const m = parts.find(p => p.type === 'month')!.value
    const d = parts.find(p => p.type === 'day')!.value
    const h = Number(parts.find(p => p.type === 'hour')!.value)
    // Roll date at 03:00 NY time
    let dateStr = `${y}-${m}-${d}`
    if (h < 3) {
      const prev = new Date(now)
      prev.setUTCDate(prev.getUTCDate() - 1)
      const partsPrev = fmt.formatToParts(prev)
      const y2 = partsPrev.find(p => p.type === 'year')!.value
      const m2 = partsPrev.find(p => p.type === 'month')!.value
      const d2 = partsPrev.find(p => p.type === 'day')!.value
      dateStr = `${y2}-${m2}-${d2}`
    }
    return dateStr
  }

  private seedRng(seed: number) {
    // xorshift32
    let x = seed | 0
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5
      return (x >>> 0) / 0xffffffff
    }
  }

  private hashString(s: string) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h >>> 0
  }

  private buildDailyPlan(id: string) {
    const rnd = this.seedRng(this.hashString(id))
    // Build 15 minutes worth of wave types by sampling from our existing pools
    const pools: EnemyType[][] = [
      ['runner'],
      ['zigzag'],
      ['spinner','shooter'],
      ['charger','splitter'],
      ['orbiter','bomber'],
      ['teleport','sniper'],
      ['weaver'],
      ['brute'],
    ]
    const plan: EnemyType[] = []
    for (let minute = 0; minute < 15; minute++) {
      const pool = pools[Math.floor(rnd() * pools.length)]
      plan[minute] = pool[Math.floor(rnd() * pool.length)]
    }
    this.dailyWavePlan = plan
  }

  // ALT TITLE: build a small 3D scene with floppies and a drive slot
  private showAltTitle() {
    if (this.altTitleActive) return
    this.altTitleActive = true
    // Hide classic title UI
    this.titleOverlay.style.display = 'none'
		// Group anchored near origin in front of camera
    const g = new THREE.Group()
    this.altTitleGroup = g
    this.scene.add(g)
		// Hide gameplay scene elements explicitly (ground, player, billboards)
    this.altHiddenScene = { ground: false, player: false, bills: [] }
    if (this.groundMesh) { this.altHiddenScene.ground = this.groundMesh.visible; this.groundMesh.visible = false }
    if (this.grid) { (this.grid as any)._prevVisible = this.grid.visible; this.grid.visible = false }
		if (this.player?.group) { this.altHiddenScene.player = this.player.group.visible; this.player.group.visible = false }
    const bills = [this.billboardGeocities, this.billboardYahoo, this.billboardDialup, (this as any).billboardJeeves]
		this.altHiddenScene.bills = bills.map((b) => (b ? (b.visible || false) : false))
		bills.forEach((b) => { if (b) b.visible = false })
    // Scale based on aspect/width only (avoid UA checks so Z Fold/large phones don't shrink)
    const aspectNow = window.innerWidth / window.innerHeight
    const narrowPortrait = (aspectNow < 0.65) && (window.innerWidth <= 520)
    const baseScale = narrowPortrait ? 2 : 4
    g.scale.set(baseScale, baseScale, baseScale)
    // Center bundle: our floppies are around z≈+0.66, so shift group back to center vertically
    g.position.set(0, 0, -0.66)
    // Nudge drive and slot to stay centered with floppies group
    const driveYOffset = 0.2
    // Temporarily switch to a pure top-down view by rotating isoPivot to identity
    this.altPrevIsoRot = this.isoPivot.rotation.clone()
    this.altPrevIsoPos = this.isoPivot.position.clone()
    this.isoPivot.rotation.set(0, 0, 0)
    this.isoPivot.position.set(0, 0, 0)
    this.camera.position.set(0, 10, 0)
    this.camera.lookAt(0, 0, 0)
		// Hide UI while Alt Title is active (DOM sits above canvas)
		this.altHiddenDom = []
		const hide = (el?: HTMLElement | null) => { if (el) { if (!this.altHiddenDom!.includes(el)) this.altHiddenDom!.push(el); el.style.display = 'none' } }
		hide(this.hud)
		hide(this.optionsFab)
		hide(this.changelogFab)
		// Keep fullscreen visible even on Alt Title
		hide(this.hpBar)
		hide(this.inventory)
		hide(this.xpBar)
		hide(this.hitCounterEl)
		hide(this.pauseTouchBtn)
		// Elements that may have been created outside of field refs
		hide(document.querySelector('#wave') as HTMLElement)
		// Add opaque full-screen background in world, aligned to camera each frame
		const frustumWidth = (this.camera.right - this.camera.left)
		const frustumHeight = (this.camera.top - this.camera.bottom)
		const bgMat = new THREE.MeshBasicMaterial({ color: 0x0d0f1a, side: THREE.DoubleSide })
		bgMat.depthTest = false
		bgMat.depthWrite = false
		const bgGeom = new THREE.PlaneGeometry(frustumWidth * 3.0, frustumHeight * 3.0)
		const bg = new THREE.Mesh(bgGeom, bgMat)
		bg.name = 'alt-bg-plane'
		bg.renderOrder = 1000
		bg.position.copy(this.camera.position)
		bg.quaternion.copy(this.camera.quaternion)
		bg.position.add(new THREE.Vector3(0, 0, -1.0).applyQuaternion(this.camera.quaternion))
		this.scene.add(bg)
		this.altBgMesh = bg
    // Keep everything on default layer; rely on oversized opaque background + DOM hides
    // Ensures we don't accidentally hide needed DOM buttons
    // Debounce A/Enter so we don't select immediately on entry
    this.altEnterDebounceUntil = performance.now() + 600
    // Drive slot (simple box with inset)
    const driveMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c5 })
    driveMat.depthTest = false
    driveMat.depthWrite = false
    const drive = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.2, 0.6), driveMat)
    drive.position.set(0, 0.1 + driveYOffset, 0)
    // Tilt drive up slightly toward camera (~15deg)
    drive.rotation.x = THREE.MathUtils.degToRad(15)
    drive.renderOrder = 1001
    // Front label texture: "Disk Survivor"
    const frontCanvas = document.createElement('canvas'); frontCanvas.width = 512; frontCanvas.height = 128
    const fctx = frontCanvas.getContext('2d')!
    fctx.fillStyle = '#0a0a0a'; fctx.fillRect(0, 0, frontCanvas.width, frontCanvas.height)
    fctx.fillStyle = '#e7efe4'; fctx.font = 'bold 60px monospace'; fctx.textAlign = 'center'; fctx.textBaseline = 'middle'
    fctx.fillText('DISK SURVIVOR', frontCanvas.width / 2, frontCanvas.height / 2)
    const frontTex = new THREE.CanvasTexture(frontCanvas)
    const frontMat = new THREE.MeshBasicMaterial({ map: frontTex })
    const frontGeom = new THREE.PlaneGeometry(4.2, 0.6)
    const frontLabel = new THREE.Mesh(frontGeom, frontMat)
    frontLabel.position.set(0, 0.65, 0.31)
    drive.add(frontLabel)
    const slotMat = new THREE.MeshBasicMaterial({ color: 0x222 })
    slotMat.depthTest = false
    slotMat.depthWrite = false
    const slot = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 0.2), slotMat)
    slot.position.set(0, 0.18 + driveYOffset, 0.31)
    slot.renderOrder = 1001
    g.add(drive, slot)
    this.altDriveMesh = slot
    // Floppy stack
    const floppiesGroup = new THREE.Group()
    floppiesGroup.position.y = 0 // align vertically with drive so bundle centers together
    g.add(floppiesGroup)
    const makeFloppy = (label: 'START' | 'DAILY' | 'DEBUG' | 'BOARD') => {
      // Per-face materials: top uses provided 128x128 texture; sides/bottom use label-specific color
             const texName = label === 'START' ? 'start.png' : label === 'DAILY' ? 'dailydisk.png' : label === 'BOARD' ? 'leaderboards.png' : 'debugmode.png'
      const loader = new THREE.TextureLoader()
      const texTop = loader.load(`/textures/title/${texName}`)
      ;(texTop as any).colorSpace = THREE.SRGBColorSpace
      texTop.minFilter = THREE.LinearFilter
      texTop.magFilter = THREE.NearestFilter
      texTop.wrapS = texTop.wrapT = THREE.ClampToEdgeWrapping
      const sideColor = label === 'DAILY' ? 0x508c55 : label === 'START' ? 0xffccaa : label === 'BOARD' ? 0xecc05d : 0xc1c1c1
      const matTop = new THREE.MeshBasicMaterial({ map: texTop })
      const matSide = new THREE.MeshBasicMaterial({ color: sideColor })
      const matBottom = new THREE.MeshBasicMaterial({ color: sideColor })
      // Slight shading on sides to emphasize thickness
      matSide.color.offsetHSL(0, 0, -0.1)
      // Ensure materials render with depth so side faces show
      ;[matTop, matSide, matBottom].forEach((m) => { m.depthTest = true; m.depthWrite = true; (m as any).transparent = false })
      // Thicken disk a touch so bottom face is readable during insert
      const geom = new THREE.BoxGeometry(1.8, 0.08, 1.8)
      // Default groups are 6 in order: +x, -x, +y, -y, +z, -z
      // Remap into materials array [top, bottom, side] to ensure bottom face uses the solid color
      const groups: { start: number; count: number; materialIndex: number }[] = []
      geom.clearGroups()
      // top (+y): index 2 → material 0 (texture)
      groups.push({ start: 2 * 6, count: 6, materialIndex: 0 })
      // bottom (-y): index 3 → material 1 (solid)
      groups.push({ start: 3 * 6, count: 6, materialIndex: 1 })
      // sides: +x, -x, +z, -z → material 2 (solid darker)
      groups.push({ start: 0 * 6, count: 6, materialIndex: 2 })
      groups.push({ start: 1 * 6, count: 6, materialIndex: 2 })
      groups.push({ start: 4 * 6, count: 6, materialIndex: 2 })
      groups.push({ start: 5 * 6, count: 6, materialIndex: 2 })
      for (const ginfo of groups) geom.addGroup(ginfo.start, ginfo.count, ginfo.materialIndex)
      const body = new THREE.Mesh(geom, [matTop, matBottom, matSide])
			body.renderOrder = 1001
      // No overlay text label (top texture already includes text)
      return body
    }
    const items: ('START'|'DAILY'|'DEBUG'|'BOARD')[] = ['BOARD','DEBUG','DAILY','START']
    this.altFloppies = []
    for (let i = 0; i < items.length; i++) {
      const label = items[i]
      const m = makeFloppy(label)
      const angle = (i * 0.06)
      // Center the selected disk and fan others; 0 is centered, 1 right, 2 left, 3 far right
      const offsetsX = [0, 0.62, -0.62, 1.24]
      const offsetsY = [0.90, -0.10, -0.12, -0.14]
      const offsetsZ = [0.60, -0.20, -0.28, -0.36]
      const baseX = offsetsX[i] ?? (i * 0.62)
      const baseY = 0.05 + (i * 0.16) + (offsetsY[i] ?? 0)
      const baseZ = 0.66 - (i * 0.04) + (offsetsZ[i] ?? 0)
      m.position.set(baseX, baseY, baseZ)
      // Idle vertical orientation (thin side)
      m.rotation.set(0, 0, 0)
      // Slightly smaller so four fit nicely
      m.scale.setScalar(1.9)
      m.rotation.y = angle
      floppiesGroup.add(m)
      this.altFloppies.push({ mesh: m, label: label as any, target: m.position.clone(), targetRot: m.rotation.y, floatPhase: Math.random() * Math.PI * 2 })
    }
		// Input: swipe/left-right cycles
		const onChoose = (lbl: 'START'|'DAILY'|'DEBUG'|'BOARD') => {
      const sel = this.altFloppies[0].mesh
		// Insert animation into drive
		const start = sel.position.clone()
		const slotPos = this.altDriveMesh ? this.altDriveMesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.3, 0.31)
		// Convert world slot position into group-local for consistent animation target
		const endWorld = new THREE.Vector3(slotPos.x, slotPos.y + 0.02, slotPos.z + 0.08)
		const end = g.worldToLocal(endWorld.clone())
    this.altInsertAnim = { m: sel, t: 0, dur: 620, start, end, startR: sel.rotation.y, endR: 0, startRX: 0, endRX: -Math.PI / 2, onDone: () => {
      this.disposeAltBg()
			this.scene.remove(this.altTitleGroup!)
			this.altTitleGroup = undefined
			this.altTitleActive = false
			// Remove background plane and restore hidden UI
			this.disposeAltBg()
			if (this.altHiddenDom) { for (const el of this.altHiddenDom) el.style.display = ''; this.altHiddenDom = undefined }
			// Restore camera layers
			this.camera.layers.set(0)
			// Remove swipe listeners
			if (this.altTouchOnDown) window.removeEventListener('pointerdown', this.altTouchOnDown)
			if (this.altTouchOnMove) window.removeEventListener('pointermove', this.altTouchOnMove)
			if (this.altTouchOnUp) window.removeEventListener('pointerup', this.altTouchOnUp)
        if (lbl === 'START') {
          // Start as usual
          this.titleOverlay.style.display = 'none'; this.showTitle = false; this.audio.startMusic('default' as ThemeKey)
        } else if (lbl === 'DAILY') {
          this.isDaily = true; this.dailyId = this.getNewYorkDate(); this.buildDailyPlan(this.dailyId)
          this.titleOverlay.style.display = 'none'; this.showTitle = false; this.audio.startMusic('default' as ThemeKey)
        } else if (lbl === 'BOARD') {
          // Open leaderboards overlay
          this.showLeaderboards()
        } else {
          this.showDebugPanel()
        }
        // Ensure opaque background is removed before gameplay
			this.disposeAltBg()
        // Restore iso camera orientation
        if (this.altPrevIsoRot) this.isoPivot.rotation.copy(this.altPrevIsoRot)
        if (this.altPrevIsoPos) this.isoPivot.position.copy(this.altPrevIsoPos)
      } }
    }
    const cycle = (dir: number) => this.cycleAltFloppies(dir)
    // Hook minimal input: left/right arrows and A/Enter
    const onKey = (e: KeyboardEvent) => {
      if (!this.altTitleActive) { window.removeEventListener('keydown', onKey); return }
      if (e.key === 'ArrowRight') cycle(1)
      else if (e.key === 'ArrowLeft') cycle(-1)
      else if (e.key === 'Enter') onChoose(this.altFloppies[0].label as 'START'|'DAILY'|'DEBUG'|'BOARD')
    }
		window.addEventListener('keydown', onKey)
		// Touch swipe for mobile: detect horizontal swipes
    this.altTouchOnDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      this.altSwipeStartX = e.clientX
      this.altSwipeActive = true
      this.altSwipeDidCycle = false
      this.altDragging = true
      // Initialize drag immediately so first frame moves
      this.altDragDX = 0.001
      // Maximize swipe hit area
      this.altPrevTouchAction = (document.body.style as any).touchAction
      ;(document.body.style as any).touchAction = 'none'
      this.altTapStartTime = performance.now()
    }
				this.altTouchOnMove = (e: PointerEvent) => {
			if (!this.altSwipeActive || e.pointerType !== 'touch') return
      const dx = e.clientX - this.altSwipeStartX
      // On first touch frame after down, ensure drag is initialized so card moves immediately
      if (!this.altDragging) this.altDragging = true
      // Record drag for render-loop application
      this.altDragDX = THREE.MathUtils.clamp(dx / 140, -0.8, 0.8)
		}
    this.altTouchOnUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const dx = e.clientX - this.altSwipeStartX
      const dtap = performance.now() - this.altTapStartTime
      const threshold = 40
      if (Math.abs(dx) > threshold) {
        // Decide direction by drag
        this.cycleAltFloppies(dx > 0 ? -1 : 1)
      } else if (dtap < 250) {
        // Treat as tap: run selection dance then insert
        const selF = this.altFloppies[0]
        const makeInsert = () => onChoose(selF.label as any)
		  this.altSelectDance = { m: selF.mesh, t: 0, dur: 400, startScale: selF.mesh.scale.x, startRZ: selF.mesh.rotation.z, makeInsert }
        setTimeout(() => this.disposeAltBg(), 700)
      }
      // Ease card back to stack alignment
      this.altDragging = false
      this.altDragDX = 0
      if (this.altFloppies[0]) { const f = this.altFloppies[0]; f.mesh.rotation.z = 0 }
      this.altSwipeActive = false
      ;(document.body.style as any).touchAction = this.altPrevTouchAction || ''
    }
		window.addEventListener('pointerdown', this.altTouchOnDown, { passive: true } as any)
		window.addEventListener('pointermove', this.altTouchOnMove, { passive: true } as any)
		window.addEventListener('pointerup', this.altTouchOnUp, { passive: true } as any)
  }

  private cycleAltFloppies(dir: number) {
    if (this.altFloppies.length === 0) return
    // Reverse cycling so cards flow left-to-right visually
    if (dir > 0) this.altFloppies.unshift(this.altFloppies.pop()!)
    else this.altFloppies.push(this.altFloppies.shift()!)
    for (let i = 0; i < this.altFloppies.length; i++) {
			const f = this.altFloppies[i]
      // Selected disk centered; others fanned left/right
      const offsetsX = [0, 0.62, -0.62, 1.24]
      const offsetsY = [0.90, -0.10, -0.12, -0.14]
      const offsetsZ = [0.60, -0.20, -0.28, -0.36]
      const baseX = offsetsX[i] ?? (i * 0.62)
      const baseY = 0.05 + (i * 0.16) + (offsetsY[i] ?? 0)
      const baseZ = 0.66 - (i * 0.04) + (offsetsZ[i] ?? 0)
			f.target.set(baseX, baseY, baseZ)
      f.targetRot = (i * 0.06)
      // Keep disks vertical during idle (thin side)
      f.mesh.rotation.x = 0
		}
  }

  private chooseAltFloppy(lbl: 'START'|'DAILY'|'DEBUG'|'BOARD') {
    if (!this.altFloppies[0]) return
    const sel = this.altFloppies[0].mesh
    const start = sel.position.clone()
    const end = new THREE.Vector3(0, 2.5, 0.3)
	this.altInsertAnim = { m: sel, t: 0, dur: 620, start, end, startR: sel.rotation.y, endR: 0, startRX: 0, endRX: -Math.PI / 2, onDone: () => {
		this.disposeAltBg()
		if (this.altTitleGroup) this.scene.remove(this.altTitleGroup)
		this.altTitleGroup = undefined
		this.altTitleActive = false
			// Remove background plane and restore hidden UI
		if (this.altBgMesh) { this.scene.remove(this.altBgMesh); this.altBgMesh.geometry.dispose(); (this.altBgMesh.material as THREE.Material).dispose(); this.altBgMesh = undefined }
		if (this.altHiddenDom) { for (const el of this.altHiddenDom) el.style.display = ''; this.altHiddenDom = undefined }
		// Remove swipe listeners and restore touch-action
			// Restore gameplay scene visibility
        if (this.altHiddenScene) {
				if (this.groundMesh) this.groundMesh.visible = this.altHiddenScene.ground
				if (this.player?.group) this.player.group.visible = this.altHiddenScene.player
        const bills = [this.billboardGeocities, this.billboardYahoo, this.billboardDialup, (this as any).billboardJeeves]
				bills.forEach((b, i) => { if (b) b.visible = !!this.altHiddenScene!.bills[i] })
          if (this.grid && (this.grid as any)._prevVisible !== undefined) this.grid.visible = !!(this.grid as any)._prevVisible
				this.altHiddenScene = undefined
			}
      if (this.altTouchOnDown) window.removeEventListener('pointerdown', this.altTouchOnDown)
		if (this.altTouchOnMove) window.removeEventListener('pointermove', this.altTouchOnMove)
		if (this.altTouchOnUp) window.removeEventListener('pointerup', this.altTouchOnUp)
		;(document.body.style as any).touchAction = this.altPrevTouchAction || ''
      // Restore iso camera orientation
      if (this.altPrevIsoRot) this.isoPivot.rotation.copy(this.altPrevIsoRot)
      if (this.altPrevIsoPos) this.isoPivot.position.copy(this.altPrevIsoPos)
		if (lbl === 'START') {
			this.titleOverlay.style.display = 'none'; this.showTitle = false; this.audio.startMusic('default' as ThemeKey)
		} else if (lbl === 'DAILY') {
			this.isDaily = true; this.dailyId = this.getNewYorkDate(); this.buildDailyPlan(this.dailyId)
			this.titleOverlay.style.display = 'none'; this.showTitle = false; this.audio.startMusic('default' as ThemeKey)
		} else {
			this.showDebugPanel()
		}
	} }
  }

  fireSideBullet(dir: THREE.Vector3) {
    const start = new THREE.Vector3()
    this.player.weaponAnchor.getWorldPosition(start)
    const mesh = new THREE.Mesh(this.sharedSideBulletGeom, this.sharedSideBulletMat)
    mesh.position.copy(start)
    mesh.position.y = 0.5
    this.scene.add(mesh)
    this.projectiles.push({ mesh, velocity: dir.clone().multiplyScalar(12), alive: true, ttl: 1.6, damage: this.projectileDamage * this.sideBulletDamageMultiplier, pierce: this.projectilePierce, last: mesh.position.clone(), kind: 'side' })
  }

  emitShockwave() {
    // Damage nearby enemies in ring (supports multi-pulse)
    // Visual ring (animate scale/opacity; avoid geometry rebuild)
    let ring = this.poolRings.pop()
    if (!ring) {
      const ringGeom = new THREE.RingGeometry(1, 1.2, 64)
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
      ring = new THREE.Mesh(ringGeom, ringMat)
    }
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(this.player.group.position).setY(0.02)
    ring.scale.set(this.modemWaveRadius * 0.2, this.modemWaveRadius * 0.2, 1)
    this.scene.add(ring)
    const start = performance.now()
    const duration = 420
    const anim = () => {
      const t = (performance.now() - start) / duration
      if (t >= 1) { this.scene.remove(ring); this.poolRings.push(ring!); return }
      const s = this.modemWaveRadius * (0.2 + 0.8 * t)
      ring.scale.set(s, s, 1)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t)
      requestAnimationFrame(anim)
    }
    anim()
    // Play thump
    this.audio.playShockwave()
    const applyPulse = () => {
      for (const e of this.enemies) {
        if (!e.alive) continue
        const d = e.mesh.position.distanceTo(this.player.group.position)
        if (d < this.modemWaveRadius) {
          const dmg = this.modemWaveDamage + Math.floor(this.gameTime / 60)
          e.hp -= dmg
          this.onEnemyDamaged(e, dmg)
          const nowT = this.gameTime
          if ((e.nextDmgToastTime ?? 0) <= nowT) {
            this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
            e.nextDmgToastTime = nowT + 0.15
          }
          // Knockback away from player, stronger near center
          const dir = e.mesh.position.clone().sub(this.player.group.position).setY(0).normalize()
          const strength = Math.max(0.12, (this.modemWaveRadius - d) * 0.08)
          e.mesh.position.add(dir.multiplyScalar(strength))
          // Hop effect
          const startY = e.mesh.position.y
          const hopPeak = 0.35
          const hopStart = performance.now()
          const hopDur = 180
          const hop = () => {
            const ht = (performance.now() - hopStart) / hopDur
            if (ht >= 1) { e.mesh.position.y = startY; return }
            const y = Math.sin(Math.PI * Math.min(1, ht)) * hopPeak
            e.mesh.position.y = startY + y
            requestAnimationFrame(hop)
          }
          hop()
          // Brief slow
          e.burstSlowUntil = this.gameTime + 0.6
          e.burstSlowFactor = 0.6
          if (e.hp <= 0) {
            e.alive = false
            this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
            this.spawnExplosion(e.mesh)
            if (e.face) this.scene.remove(e.face)
            this.onEnemyDown()
            this.score += 1
            this.dropXpOnDeath(e)
          } else {
            this.audio.playImpact()
          }
        }
      }
    }
    applyPulse()
  }

  launchRocket() {
    // Rocket; homing handled in main projectile loop to avoid timers
    const start = new THREE.Vector3()
    this.player.weaponAnchor.getWorldPosition(start)
    const mesh = new THREE.Mesh(this.sharedRocketGeom, this.sharedRocketMat)
    mesh.position.copy(start)
    mesh.position.y = 0.6
    this.scene.add(mesh)
    const rocket: Projectile = { mesh, velocity: new THREE.Vector3(), alive: true, ttl: 5.0, damage: this.rocketDamage, pierce: 0, last: mesh.position.clone(), kind: 'rocket' }
    this.projectiles.push(rocket)
  }

  spawnEnemyByWave(minute: number) {
    // Decide type by minute
    let type: EnemyType = 'slime'
    // Debug custom plan override
    if (this.debugUseWavePlan && this.debugWavePlan[minute] != null) {
      type = this.debugWavePlan[minute]
    } else if (this.isDaily && this.dailyWavePlan[minute] != null) {
      type = this.dailyWavePlan[minute]
    } else if (minute >= 10) {
      // Post-wave 10: cycle earlier waves with twists so each feels unique
      const cycle = (minute - 10) % 6 // cycles through 0..5 mapping to waves 4..9 flavors
      switch (cycle) {
        case 0: {
          const pool: EnemyType[] = ['spinner', 'shooter']
          type = pool[Math.floor(Math.random() * pool.length)]
          // Twist applied later: slight speed buff
          break
        }
        case 1: {
          const pool: EnemyType[] = ['charger', 'splitter']
          type = pool[Math.floor(Math.random() * pool.length)]
          break
        }
        case 2: {
          const pool: EnemyType[] = ['orbiter', 'bomber']
          type = pool[Math.floor(Math.random() * pool.length)]
          break
        }
        case 3: {
          const pool: EnemyType[] = ['teleport', 'sniper']
          type = pool[Math.floor(Math.random() * pool.length)]
          break
        }
        case 4: type = 'weaver'; break
        case 5: type = 'brute'; break
      }
    } else if (minute >= 9) {
      type = 'brute'       // wave 10
    } else if (minute >= 8) {
      type = 'weaver'      // wave 9
    } else if (minute >= 7) {
      const pool: EnemyType[] = ['teleport', 'sniper'] // wave 8 flavors
      type = pool[Math.floor(Math.random() * pool.length)]
    } else if (minute >= 6) {
      const pool: EnemyType[] = ['orbiter', 'bomber'] // wave 7 flavors
      type = pool[Math.floor(Math.random() * pool.length)]
    } else if (minute >= 5) {
      const pool: EnemyType[] = ['charger', 'splitter'] // wave 6 flavors
      type = pool[Math.floor(Math.random() * pool.length)]
    } else if (minute >= 4) {
      const pool: EnemyType[] = ['spinner', 'shooter'] // wave 5 flavors
      type = pool[Math.floor(Math.random() * pool.length)]
    } else if (minute >= 3) {
      type = 'tank'
    } else if (minute >= 2) {
      type = 'zigzag'
    } else if (minute >= 1) {
      type = 'runner'
    }

    // Record representative type for this wave minute the first time we choose it
    if (!this.waveTypes[minute]) this.waveTypes[minute] = type
    let spawnPos = this.pickOffscreenSpawn(3, 8)

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
      case 'spinner':
        geom = new THREE.TetrahedronGeometry(0.55)
        color = 0x66e0ff
        hp = 3 + Math.floor(this.gameTime / 30)
        speed = 3.2
        break
      case 'splitter':
        geom = new THREE.OctahedronGeometry(0.6)
        color = 0xffaa33
        hp = 5 + Math.floor(this.gameTime / 28)
        speed = 2.6
        break
      case 'bomber':
        geom = new THREE.DodecahedronGeometry(0.58)
        color = 0xcc4455
        hp = 4 + Math.floor(this.gameTime / 30)
        speed = 2.9
        break
      case 'sniper':
        geom = new THREE.ConeGeometry(0.45, 0.9, 12)
        color = 0x44ffaa
        hp = 4 + Math.floor(this.gameTime / 28)
        speed = 2.7
        break
      case 'weaver':
        geom = new THREE.TorusKnotGeometry(0.35, 0.09, 64, 8)
        color = 0xaa66ff
        hp = 5 + Math.floor(this.gameTime / 26)
        speed = 3.1
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
      case 'charger':
        geom = new THREE.CapsuleGeometry(0.35, 0.6, 6, 10)
        color = 0xffaa33
        hp = 6 + Math.floor(this.gameTime / 22)
        speed = 2.3
        break
      case 'orbiter':
        geom = new THREE.TorusGeometry(0.42, 0.15, 12, 24)
        color = 0x33ddff
        hp = 5 + Math.floor(this.gameTime / 25)
        speed = 2.4
        break
      case 'teleport':
        geom = new THREE.OctahedronGeometry(0.5, 0)
        color = 0xcc66ff
        hp = 5 + Math.floor(this.gameTime / 24)
        speed = 2.3
        break
      case 'brute':
        geom = new THREE.BoxGeometry(0.9, 0.9, 0.9)
        color = 0xdd3333
        hp = 10 + Math.floor(this.gameTime / 18)
        speed = 1.6
        break
      default:
        geom = new THREE.SphereGeometry(0.5, 12, 12)
        color = 0xaa55ff
        hp = 2 + Math.floor(this.gameTime / 40)
        speed = 2.2
    }
          const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color }))
      mesh.position.copy(spawnPos)
      this.scene.add(mesh)

      // Some enemies can climb walls in Jeeves
      const canClimb = (type === 'runner' || type === 'charger' || type === 'shooter')
 
      // Create larger face billboard that tracks the player
    const faceTex = this.makeFaceTexture(type)
    const faceSize = type === 'brute' ? 1.2 : 0.9
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(faceSize, faceSize),
      new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
    )
    face.position.set(spawnPos.x, 0.95, spawnPos.z)
    this.scene.add(face)

    const shooterAggressive = type === 'shooter' ? Math.random() < 0.5 : undefined
    // Unique spawn burst for teleport type: initial speed boost with quick decay
    if (type === 'teleport' || type === 'weaver') {
      // Nudge spawn position a bit farther than baseline to reinforce offscreen entry
      const toPlayer = this.player.group.position.clone().sub(spawnPos).setY(0)
      const farther = toPlayer.length() > 0 ? spawnPos.clone().add(toPlayer.normalize().multiplyScalar(-1.5)) : spawnPos
      spawnPos = farther
    }
    const baseColor = ((mesh.material as THREE.MeshBasicMaterial).color.getHex?.() ?? 0xffffff) as number
         const enemy: Enemy = { mesh, alive: true, speed, hp, type, timeAlive: 0, face, spawnWave: minute, shooterAggressive, baseSpeed: speed, baseColorHex: baseColor, canClimb, climbState: 'ground' }
    // Boo behavior: wave 10 (minute 9) and wave 4 (minute 3)
    if (minute === 9 || minute === 3) enemy.booWave10 = true
    // Rare elite: ~1 in 500
    if (Math.random() < 1 / 500) { enemy.eliteAggressive = true; hp += 2; enemy.hp = hp }
    // Post-10 twists: modest buffs per cycle so waves feel unique
    if (minute >= 10) {
      const cycle = (minute - 10) % 6
      if (cycle === 0) enemy.speed *= 1.1 // spinner/shooter faster
      if (cycle === 1) enemy.hp += 1       // charger/splitter tankier
      if (cycle === 2) enemy.baseSpeed = (enemy.baseSpeed ?? enemy.speed) * 1.15 // orbiter/bomber faster orbit/approach
      if (cycle === 3) enemy.speed *= 1.15 // teleport/sniper faster between actions
      if (cycle === 4) enemy.hp += 2       // weaver tougher
      if (cycle === 5) enemy.hp += 3       // brute much tougher
    }
    if (type === 'teleport') {
      // Mark a brief high-speed phase on spawn
      ;(enemy as any).dashRemaining = 0.35
    }
    this.enemies.push(enemy)
    this.aliveEnemies++
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
    const angry = type === 'runner' || type === 'tank' || type === 'shooter' || type === 'charger' || type === 'brute'
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
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    canvas.width = isMobile ? 64 : 128; canvas.height = isMobile ? 64 : 128
    const tex = new THREE.CanvasTexture(canvas)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true }))
    face.position.set(x, 2.1, z)
    this.scene.add(face)
    this.drawAnimatedFace(canvas, 0)

    const minute = Math.floor(this.gameTime / 60)
    const baseColor = ((mesh.material as THREE.MeshBasicMaterial).color.getHex?.() ?? 0xffffff) as number
    this.enemies.push({ mesh, alive: true, speed, hp, type: 'giant', timeAlive: 0, face, faceTex: tex, faceCanvas: canvas, nextFaceUpdate: performance.now(), spawnWave: minute, baseColorHex: baseColor })
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
    // Flash + sound
    const df = document.createElement('div')
    df.className = 'death-flash'
    document.body.appendChild(df)
    ;(df.style as any).animation = 'deathPulse 700ms ease-out 1'
    setTimeout(() => df.remove(), 720)
    this.audio.playDeathMoan()
    this.overlay.innerHTML = ''
    this.overlay.style.display = 'flex'
    this.submitLocked = false
    const wrap = document.createElement('div')
    wrap.className = 'go-wrap'
    wrap.style.animation = 'popFade 360ms ease-out'
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
      <div id="go-buttons" style="display:flex; gap:8px; margin-top:10px;">
        <button id="submit-btn" class="card" style="flex:1; text-align:center;"><strong>Submit</strong></button>
        <button id="restart-btn" class="card" style="flex:1; text-align:center;"><strong>Restart</strong></button>
      </div>
      <div id="share-wrap" style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
        <div class="carddesc">Share your run</div>
        <pre id="share-preview" style="margin:0; padding:8px; background:rgba(255,255,255,0.04); border:1px solid #1f2a44; border-radius:6px; font-family: ui-monospace, monospace; font-size:12px; white-space:pre-wrap;"></pre>
        <div style="display:flex; gap:8px;">
          <button id="copy-btn" class="card" style="flex:1; text-align:center;"><strong>Copy</strong></button>
          <button id="share-btn" class="card" style="flex:1; text-align:center;"><strong>Share</strong></button>
        </div>
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
    // Initialize share preview and buttons
    this.sharePreviewEl = goCard.querySelector('#share-preview') as HTMLPreElement
    this.lastShareText = this.buildShareText()
    if (this.sharePreviewEl) this.sharePreviewEl.textContent = this.lastShareText
    const copyBtn = goCard.querySelector('#copy-btn') as HTMLButtonElement
    const shareBtn = goCard.querySelector('#share-btn') as HTMLButtonElement
    const doCopy = async () => {
      try {
        await navigator.clipboard.writeText(this.lastShareText || this.buildShareText())
        copyBtn.innerHTML = '<strong>Copied!</strong>'
        setTimeout(() => (copyBtn.innerHTML = '<strong>Copy</strong>'), 900)
      } catch {}
    }
    if (copyBtn) copyBtn.onclick = doCopy
    if (shareBtn) shareBtn.onclick = async () => {
      const text = this.lastShareText || this.buildShareText()
      const nav: any = navigator
      if (nav && typeof nav.share === 'function') {
        try { await nav.share({ text }) } catch {}
      } else {
        await doCopy()
      }
    }
    submitBtn.onclick = async () => {
      if (this.submitLocked) return
      this.submitLocked = true
      submitBtn.disabled = true
      const name = (nameInput.value || '').slice(0, 20)
      try { localStorage.setItem('player.name', name) } catch {}
      const timeSurvived = Math.floor(this.gameTime)
      const score = this.score
      this.lastSubmittedInfo = { name, timeSurvived, score }
      await this.submitLeaderboard(name, timeSurvived, score)
      const entries = await this.refreshLeaderboard()
      // If we can find the player's rank in the current slice, update share preview with rank
      if (entries && this.lastSubmittedInfo) {
        const idx = entries.findIndex((e) => e.name === this.lastSubmittedInfo!.name && e.timeSurvived === this.lastSubmittedInfo!.timeSurvived && e.score === this.lastSubmittedInfo!.score)
        if (idx >= 0) {
          this.lastShareText = this.buildShareText(idx + 1)
          if (this.sharePreviewEl) this.sharePreviewEl.textContent = this.lastShareText
        }
      }
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
    // Initialize controller selection on Game Over buttons and add own nav loop
    const goBtns = Array.from(goCard.querySelectorAll('#go-buttons .card')) as HTMLButtonElement[]
    if (goBtns.length > 0) {
      this.uiSelectIndex = 0
      goBtns.forEach((b, i) => b.classList.toggle('selected', i === this.uiSelectIndex))
      let prevLeft = false, prevRight = false, prevA = false
      const navLoop = () => {
        if (this.overlay.style.display !== 'flex') return
        const pad = this.input.getActiveGamepad()
        const left = !!pad && (pad.axes?.[0] ?? 0) < -0.5 || !!pad && !!pad.buttons?.[14]?.pressed
        const right = !!pad && (pad.axes?.[0] ?? 0) > 0.5 || !!pad && !!pad.buttons?.[15]?.pressed
        const a = !!pad && !!pad.buttons?.[0]?.pressed
        if (left && !prevLeft) {
          this.uiSelectIndex = (this.uiSelectIndex - 1 + goBtns.length) % goBtns.length
          goBtns.forEach((b, i) => b.classList.toggle('selected', i === this.uiSelectIndex))
        }
        if (right && !prevRight) {
          this.uiSelectIndex = (this.uiSelectIndex + 1) % goBtns.length
          goBtns.forEach((b, i) => b.classList.toggle('selected', i === this.uiSelectIndex))
        }
        if (a && !prevA) {
          const chosen = goBtns[this.uiSelectIndex]
          if (chosen) chosen.click()
          return
        }
        prevLeft = left; prevRight = right; prevA = a
        requestAnimationFrame(navLoop)
      }
      requestAnimationFrame(navLoop)
    }
  }

  onEnemyDown() {
    this.audio.playEnemyDown()
    this.hitCount += 1
    this.updateHitCounter()
  }
  private async toggleFullscreen() {
    try {
      const doc: any = document
      const el: any = document.documentElement
      const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement)
      if (!isFull) {
        if (el.requestFullscreen) await el.requestFullscreen()
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
        else if (el.msRequestFullscreen) await el.msRequestFullscreen()
      } else {
        if (doc.exitFullscreen) await doc.exitFullscreen()
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
        else if (doc.msExitFullscreen) await doc.msExitFullscreen()
      }
      setTimeout(() => {
        this.onResize()
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      }, 150)
    } catch {}
  }

  private showDamageToastAt(pos: THREE.Vector3, amount: number, color = '#ffed8a') {
    if (!this.debugShowDamage) return
    const screen = this.worldToScreen(pos)
    const el = document.createElement('div')
    const shown = Math.max(1, Math.round(amount))
    el.textContent = `-${shown}`
    const style = el.style as CSSStyleDeclaration
    style.position = 'fixed'
    style.left = `${screen.x}px`
    style.top = `${screen.y}px`
    style.transform = 'translate(-50%, -50%)'
    style.color = color
    style.fontFamily = 'ui-monospace, monospace'
    style.fontSize = '13px'
    style.textShadow = '0 0 6px rgba(0,0,0,0.6)'
    style.pointerEvents = 'none'
    style.zIndex = '30'
    style.opacity = '1'
    style.transition = 'opacity 500ms, transform 500ms'
    document.body.appendChild(el)
    requestAnimationFrame(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%, -90%)' })
    setTimeout(() => el.remove(), 520)
  }

  private worldToScreen(p: THREE.Vector3) {
    const v = p.clone()
    this._tmpProj.copy(v)
    this._tmpProj.project(this.camera)
    const x = (this._tmpProj.x * 0.5 + 0.5) * window.innerWidth
    const y = (-this._tmpProj.y * 0.5 + 0.5) * window.innerHeight
    return { x, y }
  }

  private spawnExplosion(source: THREE.Mesh) {
    const pos = source.position.clone()
    const color = ((source.material as any)?.color?.getHex?.() ?? 0xffffff) as number
    this.scene.remove(source)
    const shardCount = 10
    const shards: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = []
    for (let i = 0; i < shardCount; i++) {
      let m = this.shardPool.pop()
      if (!m) m = new THREE.Mesh(this.sharedShardGeom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }))
      else (m.material as THREE.MeshBasicMaterial).color.setHex(color)
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
      else for (const s of shards) { this.scene.remove(s.m); this.shardPool.push(s.m) }
    }
    tick()
  }

  // More dramatic explosion for bomber
  private spawnStylishExplosion(source: THREE.Mesh) {
    const pos = source.position.clone()
    const color = ((source.material as any)?.color?.getHex?.() ?? 0xff8855) as number
    this.scene.remove(source)
    // Core flash
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }))
    flash.position.copy(pos).setY(0.7)
    this.scene.add(flash)
    // Shock ring
    const ringGeom = new THREE.RingGeometry(0.2, 0.22, 48)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    const ring = new THREE.Mesh(ringGeom, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(pos).setY(0.05)
    this.scene.add(ring)
    // Shards
    const shardCount = 14
    const shards: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = []
    for (let i = 0; i < shardCount; i++) {
      let m = this.shardPool.pop()
      if (!m) m = new THREE.Mesh(this.sharedShardGeom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }))
      else (m.material as THREE.MeshBasicMaterial).color.setHex(color)
      m.position.copy(pos)
      m.position.y = 0.7
      this.scene.add(m)
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize()
      const speed = 3.5 + Math.random() * 2.5
      shards.push({ m, v: dir.multiplyScalar(speed), life: 0.35 })
    }
    const start = performance.now()
    const dur = 260
    const tick = () => {
      const t = (performance.now() - start) / dur
      if (t <= 1) {
        const r = 0.2 + 1.9 * t
        ring.geometry.dispose()
        ring.geometry = new THREE.RingGeometry(r * 0.98, r, 64)
        ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t)
        ;(flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 * (1 - t))
      }
      // Shards animate slightly longer than the ring
      const dt = 1 / 60
      let alive = false
      for (const s of shards) {
        if (s.life <= 0) continue
        s.m.position.addScaledVector(s.v, dt)
        s.v.multiplyScalar(0.9)
        ;(s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / 0.35)
        s.life -= dt
        alive = alive || s.life > 0
      }
      if (t < 1 || alive) requestAnimationFrame(tick)
      else {
        this.scene.remove(ring); ringGeom.dispose(); (ring.material as any).dispose?.()
        this.scene.remove(flash); (flash.geometry as any).dispose?.(); (flash.material as any).dispose?.()
        for (const s of shards) { this.scene.remove(s.m); this.shardPool.push(s.m) }
      }
    }
    tick()
  }

  private spawnZapEffect(a: THREE.Vector3, b: THREE.Vector3, intensity = 1) {
    // Brighter, thicker lightning bolt with branching
    const drawBolt = (from: THREE.Vector3, to: THREE.Vector3, width: number, color: number, lifeMs: number) => {
      const segs = 8
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= segs; i++) {
        const t = i / segs
        const p = new THREE.Vector3().lerpVectors(from, to, t)
        if (i > 0 && i < segs) {
          const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3)
          p.addScaledVector(jitter, intensity)
        }
        pts.push(p)
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, 0.95 * intensity), linewidth: width as any, blending: THREE.AdditiveBlending })
      const line = new THREE.Line(geo, mat)
      this.scene.add(line)
      const start = performance.now()
      const fade = () => {
        const t = (performance.now() - start) / lifeMs
        ;(line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - t)
        if (t < 1) requestAnimationFrame(fade)
        else { this.scene.remove(line); geo.dispose(); (line.material as THREE.Material).dispose?.() }
      }
      fade()
    }
    drawBolt(a, b, 3, 0xccffff, 180)
    // Small branch
    const mid = new THREE.Vector3().lerpVectors(a, b, 0.6)
    const branch = mid.clone().add(new THREE.Vector3((Math.random()-0.5)*0.6, (Math.random()-0.5)*0.3, (Math.random()-0.5)*0.6))
    drawBolt(mid, branch, 2, 0x88eeff, 140)
  }

  private spawnWhirlDust(center: THREE.Vector3) {
    // Small magnetic/dusty poofs using pooled quads
    const count = 8
    const lifeMs = 220
    const particles: { m: THREE.Mesh; v: THREE.Vector3; born: number }[] = []
    for (let i = 0; i < count; i++) {
      let quad = this.poolQuads.pop()
      if (!quad) {
        const g = new THREE.PlaneGeometry(0.15, 0.15)
        const m = new THREE.MeshBasicMaterial({ color: 0x66ffcc, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
        quad = new THREE.Mesh(g, m)
        quad.rotation.x = -Math.PI / 2
      }
      quad.position.copy(center).setY(0.12)
      this.scene.add(quad)
      const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()
      const speed = 0.6 + Math.random() * 0.6
      particles.push({ m: quad, v: dir.multiplyScalar(speed), born: performance.now() })
    }
    const tick = () => {
      let any = false
      const now = performance.now()
      for (const p of particles) {
        const t = (now - p.born) / lifeMs
        if (t >= 1) { this.scene.remove(p.m); this.poolQuads.push(p.m); continue }
        any = true
        p.m.position.addScaledVector(p.v, 1 / 60)
        ;(p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - t))
      }
      if (any) requestAnimationFrame(tick)
    }
    tick()
  }

  private explodeAt(center: THREE.Vector3, radius: number, baseDamage: number) {
    // Visual flash ring similar to shockwave
    const ringGeom = new THREE.RingGeometry(radius * 0.6, radius * 0.62, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    const ring = new THREE.Mesh(ringGeom, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(center).setY(0.03)
    this.scene.add(ring)
    const start = performance.now()
    const duration = 280
    const anim = () => {
      const t = (performance.now() - start) / duration
      if (t >= 1) { this.scene.remove(ring); ringGeom.dispose(); (ring.material as THREE.Material).dispose?.(); return }
      const r = radius * (0.6 + 0.4 * t)
      ring.geometry.dispose()
      ring.geometry = new THREE.RingGeometry(r * 0.98, r, 48)
      ;(ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t)
      requestAnimationFrame(anim)
    }
    anim()
    // Apply damage and minor knockback
    for (const e of this.enemies) {
      if (!e.alive) continue
      const d = e.mesh.position.distanceTo(center)
      if (d < radius) {
        const dmg = Math.ceil(baseDamage * 0.8)
        e.hp -= dmg
        const nowT = this.gameTime
        if ((e.nextDmgToastTime ?? 0) <= nowT) {
          this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
          e.nextDmgToastTime = nowT + 0.15
        }
        const dir = e.mesh.position.clone().sub(center).setY(0).normalize()
        e.mesh.position.add(dir.multiplyScalar(Math.max(0.08, (radius - d) * 0.05)))
        if (e.hp <= 0) {
          e.alive = false
          this.spawnExplosion(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.onEnemyDown()
          this.score += 1
          this.dropXpOnDeath(e)
        } else {
          this.audio.playImpact()
        }
      }
    }
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
      if (this.lassoMesh && this.gameTime >= this.lassoNextGeomAt) {
        this.lassoNextGeomAt = this.gameTime + 0.08
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
        const dmg = this.lassoDamage
        e.hp -= dmg
        const nowT = this.gameTime
        if ((e.nextDmgToastTime ?? 0) <= nowT) {
          this.showDamageToastAt(e.mesh.position.clone().setY(0.8), dmg)
          e.nextDmgToastTime = nowT + 0.15
        }
        if (e.hp <= 0) {
          e.alive = false
          this.spawnExplosion(e.mesh)
          if (e.face) this.scene.remove(e.face)
          this.onEnemyDown()
          this.score += 1
          this.updateHud()
          this.dropXpOnDeath(e)
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
    // Improve radius and cycle, and add pulses on milestones
    this.burstLevel += 1
    this.modemWaveRadius = Math.min(8.0, this.modemWaveRadius + 0.7)
    this.modemWaveInterval = Math.max(0.9, this.modemWaveInterval - 0.2)
    this.modemWaveDamage += 2
    // Every two levels (Lv2, Lv4), add another pulse up to 3 total
    if (this.burstLevel === 2 || this.burstLevel === 4) {
      this.modemWavePulses = Math.min(3, this.modemWavePulses + 1)
    }
  }

  private levelUpRocket() {
    this.rocketLevel += 1
    // Primary scaling knobs: bigger AoE, more frequent, and damage
    this.rocketDamage += 1
    this.rocketBlastRadius = Math.min(5.0, this.rocketBlastRadius + 0.4)
    this.rocketInterval = Math.max(0.9, this.rocketInterval * 0.92)
    // Add a second rocket from level 2 onward
    if (this.rocketLevel >= 2) {
      const fire = () => this.launchRocket()
      // Launch a second rocket with a small stagger
      setTimeout(fire, 150)
    }
    // Slightly improve speed/turn with level, but keep conservative to avoid landmine behavior at Lv1
    this.rocketSpeed = Math.min(5, this.rocketSpeed + 0.4)
    this.rocketTurn = Math.min(0.25, this.rocketTurn + 0.02)
  }

  private levelUpDotMatrix() {
    this.sideBulletDamageMultiplier = Math.min(2.0, this.sideBulletDamageMultiplier + 0.2)
  }

  private levelUpWhirl() {
    this.whirlLevel += 1
    this.whirlRadius = Math.min(3.8, this.whirlRadius + 0.3)
    this.whirlDamage += 6
    this.whirlSpeed = Math.min(4.2, this.whirlSpeed + 0.2)
    // Add more saws at key levels up to 6
    if (this.whirlSaws.length < 6 && (this.whirlLevel === 2 || this.whirlLevel === 4)) {
      const createSaw = () => new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 16), new THREE.MeshBasicMaterial({ color: 0xffcc66 }))
      const s = createSaw()
      this.scene.add(s)
      this.whirlSaws.push(s)
    }
  }

  private levelUpSataTail() {
    this.sataTailLevel += 1
    // Prioritize damage scaling, then modest length increase
    this.sataTailDps += 6
    this.sataTailLength = Math.min(4.0, this.sataTailLength + 0.25)
    // Reposition segments along new length
    if (this.sataTailSegments.length > 0) {
      const segs = this.sataTailSegments.length
      for (let i = 0; i < segs; i++) {
        const k = i / (segs - 1)
        this.sataTailSegments[i].position.z = -k * this.sataTailLength
      }
    }
  }

  private levelUpPaint() {
    this.paintLevel += 1
    // Increase uptime (on more than off), increase DPS a bit, and extend paint life modestly
    this.paintOnDuration = Math.min(2.5, this.paintOnDuration + 0.25)
    this.paintOffDuration = Math.max(0.35, this.paintOffDuration - 0.15)
    this.paintDps += 5
    this.paintDuration = Math.min(4.5, this.paintDuration + 0.35)
    this.paintRadius = Math.min(3.0, this.paintRadius + 0.25)
    this.paintGap = Math.max(0.18, this.paintGap - 0.02)
  }

  private async submitLeaderboard(name: string, timeSurvived: number, score: number) {
    try {
      const payload: any = { name, timeSurvived, score }
      if (this.isDaily) { payload.mode = 'daily'; payload.dailyId = this.dailyId }
      await fetch('/.netlify/functions/leaderboard-submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
    } catch {}
  }

  private async refreshLeaderboard() {
    try {
      const qs = this.isDaily ? `?mode=daily&dailyId=${encodeURIComponent(this.dailyId)}` : ''
      const res = await fetch('/.netlify/functions/leaderboard-top' + qs)
      const data = await res.json()
      const list = this.overlay.querySelector('#lb-list') as HTMLDivElement
      if (!list) {
        const entriesOnly = (data?.entries ?? []) as { name: string; timeSurvived: number; score: number }[]
        return entriesOnly
      }
      const entries = (data?.entries ?? []) as { name: string; timeSurvived: number; score: number }[]
      list.innerHTML = entries.map((e: any, i: number) => `
        <div style="display:flex; justify-content:space-between; gap:8px;">
          <span>${String(i + 1).padStart(2, '0')}. ${escapeHtml(e.name ?? '')}</span>
          <span>${(e.timeSurvived ?? 0)}s • ${e.score ?? 0}</span>
        </div>
      `).join('') || '<div class="carddesc">No entries yet</div>'
      return entries
    } catch {
      // Fallback: nothing
    }
  }

  private buildShareText(rank?: number): string {
    const modeLabel = this.isDaily ? 'Daily Disk' : 'Disk Survivor'
    const waveNum = Math.max(1, Math.floor(this.gameTime / 60) + 1)
    const secs = Math.max(0, Math.floor(this.gameTime))
    const rankText = typeof rank === 'number' && rank > 0 ? ` 🎯#${rank}` : ''
    const header = `${modeLabel} 🌊${waveNum} 🕚${secs}${rankText}`
    const weaponsLine = this.weaponOrder.filter((w) => this.ownedWeapons.has(w)).map((w) => this.weaponToEmoji(w)).join('')
    const wavesLine = this.getWaveEmojiLine(waveNum)
    return [header, weaponsLine, wavesLine].join('\n')
  }

  private getWaveEmojiLine(waveCount: number): string {
    const parts: string[] = []
    for (let m = 0; m < waveCount; m++) {
      let t = this.waveTypes[m]
      if (!t) t = this.predictTypeForMinute(m)
      parts.push(this.enemyTypeToBlockEmoji(t))
    }
    return parts.join('')
  }

  private enemyTypeToBlockEmoji(t: EnemyType): string {
    switch (t) {
      case 'runner': return '🟨'
      case 'spinner': return '🟦'
      case 'splitter': return '🟧'
      case 'bomber': return '🟥'
      case 'sniper': return '🟩'
      case 'weaver': return '🟪'
      case 'zigzag': return '🟩'
      case 'tank': return '🟥'
      case 'shooter': return '🟦'
      case 'charger': return '🟧'
      case 'orbiter': return '🟦'
      case 'teleport': return '🟪'
      case 'brute': return '🟥'
      case 'slime': return '🟪'
      case 'giant': return '🟥'
      default: return '⬜️'
    }
  }

  private weaponToEmoji(name: string): string {
    switch (name) {
      case 'CRT Beam': return '📺'
      case 'Dot Matrix': return '🖨️'
      case 'Dial-up Burst': return '📞'
      case 'SCSI Rocket': return '🚀'
      case 'Tape Whirl': return '📼'
      case 'Sata Cable Tail': return '🔌'
      case 'Magic Lasso': return '🪢'
      case 'Shield Wall': return '🛡️'
      case 'Paint.exe': return '🎨'
      default: return ''
    }
  }

  private predictTypeForMinute(minute: number): EnemyType {
    if (this.debugUseWavePlan && this.debugWavePlan[minute] != null) return this.debugWavePlan[minute]
    if (this.isDaily && this.dailyWavePlan[minute] != null) return this.dailyWavePlan[minute]
    if (minute >= 10) {
      const cycle = (minute - 10) % 6
      switch (cycle) {
        case 0: return 'spinner'
        case 1: return 'charger'
        case 2: return 'orbiter'
        case 3: return 'teleport'
        case 4: return 'weaver'
        case 5: return 'brute'
      }
    }
    if (minute >= 9) return 'brute'
    if (minute >= 8) return 'weaver'
    if (minute >= 7) return 'teleport'
    if (minute >= 6) return 'orbiter'
    if (minute >= 5) return 'charger'
    if (minute >= 4) return 'spinner'
    if (minute >= 3) return 'tank'
    if (minute >= 2) return 'zigzag'
    if (minute >= 1) return 'runner'
    return 'slime'
  }

  private async showChangelog() {
    const wrap = document.createElement('div')
    wrap.className = 'card'
    wrap.style.minWidth = '420px'
    wrap.style.maxWidth = '70vw'
    wrap.style.maxHeight = '70vh'
    wrap.style.display = 'flex'
    ;(wrap.style as any).flexDirection = 'column'
    wrap.style.overflow = 'hidden'
    const title = document.createElement('strong')
    title.textContent = 'Change Log'
    const desc = document.createElement('div')
    desc.className = 'carddesc'
    desc.style.margin = '8px 0 12px'
    desc.textContent = 'Recent versions and notes'
    const pre = document.createElement('pre')
    ;(pre.style as any).whiteSpace = 'pre-wrap'
    pre.style.fontFamily = 'ui-monospace, monospace'
    pre.style.fontSize = '12px'
    pre.style.lineHeight = '1.4'
    pre.style.margin = '0'
    const content = document.createElement('div')
    content.style.flex = '1 1 auto'
    content.style.overflow = 'auto'
    content.appendChild(pre)
    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.justifyContent = 'flex-end'
    btnRow.style.marginTop = '12px'
    const closeBtn = document.createElement('button') as HTMLButtonElement
    closeBtn.className = 'card'
    closeBtn.style.width = 'auto'
    closeBtn.style.minHeight = 'unset'
    closeBtn.style.padding = '6px 10px'
    closeBtn.innerHTML = '<strong>Close</strong>'
    closeBtn.onclick = () => { this.changelogOverlay.style.display = 'none' }
    btnRow.appendChild(closeBtn)
    wrap.append(title, desc, content, btnRow)
    this.changelogOverlay.innerHTML = ''
    this.changelogOverlay.appendChild(wrap)
    this.changelogOverlay.style.display = 'flex'
    try {
      const raw = String(changelogRaw ?? '')
      pre.textContent = raw
      pre.style.paddingTop = '8px'
      requestAnimationFrame(() => {
        content.scrollTop = 0
        wrap.scrollTop = 0
      })
    } catch {
      pre.textContent = 'Unable to load CHANGELOG.md'
    }
    // Controller B closes the changelog
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'b') closeBtn.click() }
    const onAnim = () => {
      const pad = this.input.getActiveGamepad()
      if (pad && pad.buttons[1]?.pressed) closeBtn.click()
      if (this.changelogOverlay.style.display === 'flex') requestAnimationFrame(onAnim)
    }
    window.addEventListener('keydown', onKey, { once: true })
    requestAnimationFrame(onAnim)
  }

  private async showLeaderboards() {
    const overlay = document.createElement('div') as HTMLDivElement
    overlay.className = 'overlay'
    const wrap = document.createElement('div') as HTMLDivElement
    wrap.className = 'card'
    wrap.style.minWidth = '520px'
    wrap.style.maxWidth = '80vw'
    wrap.style.maxHeight = '80vh'
    wrap.style.display = 'flex'
    ;(wrap.style as any).flexDirection = 'column'
    wrap.style.overflow = 'hidden'

    const title = document.createElement('strong')
    title.textContent = 'Leaderboards'
    const desc = document.createElement('div')
    desc.className = 'carddesc'
    desc.style.margin = '6px 0 10px'
    desc.textContent = 'Main leaderboard and Daily Disk by date'

    const mainBox = document.createElement('div') as HTMLDivElement
    mainBox.className = 'card'
    mainBox.style.padding = '10px'
    const mainTitle = document.createElement('div')
    mainTitle.innerHTML = '<strong>Main</strong>'
    const mainSub = document.createElement('div') as HTMLDivElement
    mainSub.className = 'carddesc'
    mainSub.textContent = 'Top 13 by time survived'
    const mainList = document.createElement('div') as HTMLDivElement
    mainList.className = 'carddesc'
    mainList.style.display = 'grid'
    mainList.style.gap = '4px'
    mainList.style.marginTop = '8px'
    mainList.style.fontFamily = 'ui-monospace, monospace'
    mainList.textContent = 'Loading…'
    mainBox.append(mainTitle, mainSub, mainList)

    const dailyBox = document.createElement('div') as HTMLDivElement
    dailyBox.className = 'card'
    dailyBox.style.padding = '10px'
    const dailyHead = document.createElement('div') as HTMLDivElement
    dailyHead.style.display = 'flex'
    dailyHead.style.alignItems = 'center'
    dailyHead.style.gap = '8px'
    const dailyLabel = document.createElement('strong')
    dailyLabel.textContent = 'Daily Disk'
    const dateInput = document.createElement('input') as HTMLInputElement
    dateInput.type = 'date'
    dateInput.value = this.getNewYorkDate()
    dailyHead.append(dailyLabel, dateInput)
    const dailySub = document.createElement('div') as HTMLDivElement
    dailySub.className = 'carddesc'
    dailySub.textContent = 'Choose a date to view the daily board'
    const dailyList = document.createElement('div') as HTMLDivElement
    dailyList.className = 'carddesc'
    dailyList.style.display = 'grid'
    dailyList.style.gap = '4px'
    dailyList.style.marginTop = '8px'
    dailyList.style.fontFamily = 'ui-monospace, monospace'
    dailyList.textContent = 'Loading…'
    dailyBox.append(dailyHead, dailySub, dailyList)

    const btnRow = document.createElement('div') as HTMLDivElement
    btnRow.style.display = 'flex'
    btnRow.style.justifyContent = 'flex-end'
    btnRow.style.gap = '8px'
    btnRow.style.marginTop = '10px'
    const backBtn = document.createElement('button') as HTMLButtonElement
    backBtn.className = 'card'
    backBtn.style.width = 'auto'
    backBtn.style.minHeight = 'unset'
    backBtn.style.padding = '6px 10px'
    backBtn.innerHTML = '<strong>Back</strong>'
    backBtn.onclick = () => overlay.remove()
    btnRow.appendChild(backBtn)

    wrap.append(title, desc, mainBox, dailyBox, btnRow)
    overlay.appendChild(wrap)
    this.root.appendChild(overlay)
    overlay.style.display = 'flex'

    const pad = (n: number) => String(n).padStart(2, '0')
    const render = (entries: any[]) => entries.map((e: any, i: number) => `<div style=\"display:flex; justify-content:space-between; gap:8px;\"><span>${pad(i + 1)}. ${escapeHtml((e.name ?? '').slice(0, 18))}</span><span>${(e.timeSurvived ?? 0)}s • ${e.score ?? 0}</span></div>`).join('')

    const fetchMain = async () => {
      try {
        const r = await fetch('/.netlify/functions/leaderboard-top')
        const j = await r.json()
        mainList.innerHTML = render(j.entries || []) || '<div class="carddesc">No entries yet.</div>'
      } catch {
        mainList.textContent = 'Failed to load.'
      }
    }
    const fetchDaily = async (d: string) => {
      try {
        const r = await fetch(`/.netlify/functions/leaderboard-top?mode=daily&dailyId=${encodeURIComponent(d)}`)
        const j = await r.json()
        dailyList.innerHTML = render(j.entries || []) || '<div class="carddesc">No entries yet.</div>'
      } catch {
        dailyList.textContent = 'Failed to load.'
      }
    }

    await fetchMain()
    await fetchDaily(dateInput.value)
    dateInput.onchange = () => { fetchDaily(dateInput.value) }
  }

  private showBestiary() {
    const overlay = document.createElement('div') as HTMLDivElement
    overlay.className = 'overlay'
    const wrap = document.createElement('div') as HTMLDivElement
    wrap.className = 'card'
    // Override default card width so our grid can expand
    wrap.style.width = 'auto'
    wrap.style.minWidth = '720px'
    wrap.style.maxWidth = '86vw'
    wrap.style.maxHeight = '86vh'
    wrap.style.display = 'grid'
    ;(wrap.style as any).gridTemplateColumns = '240px 1fr'
    wrap.style.gap = '10px'

    const left = document.createElement('div') as HTMLDivElement
    left.style.display = 'flex'
    ;(left.style as any).flexDirection = 'column'
    left.style.gap = '6px'
    const title = document.createElement('strong'); title.textContent = 'Bug Report'
    const desc = document.createElement('div'); desc.className = 'carddesc'; desc.textContent = 'Known specimens in the wild'
    const list = document.createElement('div') as HTMLDivElement
    list.style.overflow = 'auto'; list.style.maxHeight = '60vh'; list.style.display = 'grid'; list.style.gap = '4px'
    left.append(title, desc, list)

    const right = document.createElement('div') as HTMLDivElement
    right.style.display = 'grid'; (right.style as any).gridTemplateRows = '1fr auto'
    right.style.minHeight = '420px'
    const view = document.createElement('div') as HTMLDivElement
    view.style.background = 'rgba(0,0,0,0.15)'; view.style.border = '1px solid #1f2a44'; view.style.borderRadius = '6px'
    view.style.position = 'relative'
    const blurb = document.createElement('div') as HTMLDivElement
    blurb.className = 'carddesc'
    blurb.style.marginTop = '8px'
    blurb.style.minHeight = '44px'
    const btnRow = document.createElement('div') as HTMLDivElement
    btnRow.style.display = 'flex'; btnRow.style.justifyContent = 'flex-end'; btnRow.style.gap = '8px'; btnRow.style.marginTop = '8px'
    const backBtn = document.createElement('button') as HTMLButtonElement
    backBtn.className = 'card'; backBtn.innerHTML = '<strong>Back</strong>'
    backBtn.onclick = () => overlay.remove()
    btnRow.appendChild(backBtn)
    right.append(view, blurb, btnRow)

    wrap.append(left, right)
    overlay.appendChild(wrap)
    this.root.appendChild(overlay)
    overlay.style.display = 'flex'

    const enemies: EnemyType[] = ['runner','zigzag','tank','shooter','spinner','splitter','bomber','sniper','weaver','charger','orbiter','teleport','brute','slime','giant']
    const bios: Record<EnemyType, string> = {
      runner: 'Worm.exe — fast propagation via unsecured ports. Limited armor.',
      zigzag: 'Glitch Sprite — jittery movement that confuses aim assist modules.',
      tank: 'Ransom.BIT — slow encryption engine with intimidating presence. Shy when observed.',
      shooter: 'AdBot — spams popups from a distance; sometimes gets brave.',
      spinner: 'CPU Miner — spins cycles relentlessly while closing distance.',
      splitter: 'ForkBomb — divides under pressure; each child continues the attack.',
      bomber: 'Trojan Courier — flanks to deliver a damaging payload up close.',
      sniper: 'Keylogger — prefers long range; retreats when approached.',
      weaver: 'Rootkit — weaves around defenses with slippery patterns.',
      charger: 'DDoS Burst — brief windup before overwhelming surge.',
      orbiter: 'Phishing Ring — circles target; draws closer before the sting.',
      teleport: 'Backdoor — relocates near target, then lunges.',
      brute: 'Boot Sector Ogre — heavy slam that corrupts nearby sectors.',
      slime: 'Adware Goo — basic nuisance with low integrity.',
      giant: 'MegaVirus — hulking threat; enrages under sustained fire.'
    } as any

    // Basic preview renderer
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'; canvas.style.inset = '0'; canvas.style.width = '100%'; canvas.style.height = '100%'
    view.appendChild(canvas)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    // Scene and camera must be created before first resize to avoid TDZ
    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    const pivot = new THREE.Group(); scene.add(pivot)
    cam.position.set(0, 2.1, 3.6); cam.lookAt(0, 0.6, 0); pivot.add(cam)
    const light = new THREE.AmbientLight(0xffffff, 0.9); scene.add(light)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x111522 }))
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0; scene.add(ground)
    const rsz = () => {
      const w = Math.max(1, view.clientWidth)
      const h = Math.max(1, view.clientHeight)
      renderer.setSize(w, h, false)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
    rsz(); new ResizeObserver(rsz).observe(view)

    let currentMesh: THREE.Object3D | undefined
    const buildEnemyMesh = (t: EnemyType) => {
      // Reuse geometry/color mapping from spawner
      let geom: THREE.BufferGeometry; let color = 0xaa55ff
      switch (t) {
        case 'runner': geom = new THREE.SphereGeometry(0.6, 16, 16); color = 0xffdd55; break
        case 'spinner': geom = new THREE.TetrahedronGeometry(0.75); color = 0x66e0ff; break
        case 'splitter': geom = new THREE.OctahedronGeometry(0.8); color = 0xffaa33; break
        case 'bomber': geom = new THREE.DodecahedronGeometry(0.8); color = 0xcc4455; break
        case 'sniper': geom = new THREE.ConeGeometry(0.6, 1.2, 14); color = 0x44ffaa; break
        case 'weaver': geom = new THREE.TorusKnotGeometry(0.5, 0.12, 80, 10); color = 0xaa66ff; break
        case 'zigzag': geom = new THREE.IcosahedronGeometry(0.65, 0); color = 0x55ffaa; break
        case 'tank': geom = new THREE.BoxGeometry(0.9, 0.9, 0.9); color = 0xff6699; break
        case 'shooter': geom = new THREE.ConeGeometry(0.5, 1.0, 12); color = 0x66aaff; break
        case 'charger': geom = new THREE.CapsuleGeometry(0.5, 0.8, 8, 12) as any; color = 0xffaa33; break
        case 'orbiter': geom = new THREE.TorusGeometry(0.6, 0.2, 14, 28); color = 0x33ddff; break
        case 'teleport': geom = new THREE.OctahedronGeometry(0.7, 0); color = 0xcc66ff; break
        case 'brute': geom = new THREE.BoxGeometry(1.2, 1.2, 1.2); color = 0xdd3333; break
        case 'giant': geom = new THREE.SphereGeometry(1.3, 16, 16); color = 0xff44aa; break
        default: geom = new THREE.SphereGeometry(0.6, 16, 16); color = 0xaa55ff
      }
      const group = new THREE.Group()
      const body = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color }))
      body.position.set(0, 0.6, 0)
      group.add(body)
      // Add face plane similar to gameplay, but have it rotate with the model (not billboard)
      try {
        const faceTex = this.makeFaceTexture(t)
        geom.computeBoundingSphere()
        const radius = Math.max(0.45, (geom.boundingSphere?.radius ?? 0.6))
        const faceSize = t === 'brute' ? 1.2 : Math.min(1.2, radius * 1.6)
        const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
        faceMat.depthTest = false
        faceMat.depthWrite = false
        const face = new THREE.Mesh(new THREE.PlaneGeometry(faceSize, faceSize), faceMat)
        face.name = 'bestiary-face'
        const faceHeight = t === 'brute' ? 1.1 : Math.max(0.7, radius * 1.2)
        const frontOffset = Math.min(1.2, radius * 1.05)
        face.position.set(0, faceHeight, frontOffset)
        // Orient so its front is +Z; it will rotate with the group
        face.rotation.y = 0
        group.add(face)
      } catch {}
      return group
    }

    const select = (t: EnemyType) => {
      blurb.textContent = bios[t] || ''
      if (currentMesh) { scene.remove(currentMesh as any); this.disposeObjectDeep(currentMesh as any) }
      currentMesh = buildEnemyMesh(t)
      if (currentMesh) { scene.add(currentMesh as any) }
    }

    // Populate list
    enemies.forEach((t, i) => {
      const b = document.createElement('button') as HTMLButtonElement
      b.className = 'card'; b.style.width = '100%'; b.innerHTML = `<strong>${t.toUpperCase()}</strong>`
      b.style.minHeight = '34px'; b.style.padding = '6px'
      b.onclick = () => select(t)
      list.appendChild(b)
      if (i === 0) select(t)
    })

    const tick = () => {
      if (currentMesh) {
        currentMesh.rotation.y += 0.01
      }
      renderer.render(scene, cam)
      if (overlay.parentElement) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  private updateHitCounter() {
    if (!this.hitCounterEl) return
    const digits = String(this.hitCount).padStart(6, '0')
    this.hitCounterEl.innerHTML = `
      <div class="hc-wrap">
        <span class="hc-label">${this.hitCounterFlip ? 'TO MY GUN' : 'VISITORS'}</span>
        ${digits.split('').map((d) => `<span class="hc-digit">${d}</span>`).join('')}
      </div>
    `
  }

  private onWaveStart(newMinute: number) {
    // After a short delay, remove most enemies from two waves prior (no XP, no score)
    const targetWave = newMinute - 2
    if (targetWave < 0) return
    const delayMs = Math.max(0, Math.floor(this.waveCullDelaySeconds * 1000))
    setTimeout(() => this.cullEnemiesFromWave(targetWave), delayMs)
  }

  private cullEnemiesFromWave(waveMinute: number) {
    const group = this.enemies.filter((e) => e.alive && e.spawnWave === waveMinute)
    if (group.length === 0) return
    // Desired survivors; prefer to only remove offscreen enemies
    const keepCount = Math.min(group.length, Math.max(1, Math.floor(group.length * this.waveCullKeepFraction)))
    const needRemove = Math.max(0, group.length - keepCount)
    if (needRemove <= 0) return

    // Build frustum at call time
    this._frustumMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    this._frustum.setFromProjectionMatrix(this._frustumMat)

    // Candidates: enemies currently NOT visible
    const offscreen = group.filter((e) => !this._frustum.containsPoint(e.mesh.position))
    // Remove only up to offscreen length; if fewer than needed, remove all offscreen and leave visible ones
    const removeCount = Math.min(needRemove, offscreen.length)
    if (removeCount === 0) return
    // Prefer to remove farthest offscreen first
    const playerPos = this.player.group.position
    offscreen.sort((a, b) => b.mesh.position.distanceToSquared(playerPos) - a.mesh.position.distanceToSquared(playerPos))
    const toRemove = offscreen.slice(0, removeCount)
    for (const enemy of toRemove) {
      enemy.alive = false
      this.scene.remove(enemy.mesh)
      if (enemy.face) this.scene.remove(enemy.face)
      this.disposeObjectDeep(enemy.mesh)
      if (enemy.face) this.disposeObjectDeep(enemy.face)
      this.aliveEnemies = Math.max(0, this.aliveEnemies - 1)
    }
    this.enemies = this.enemies.filter((e) => e.alive)
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
