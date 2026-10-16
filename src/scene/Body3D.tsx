/**
 * Interactive 3D body — react-three-fiber.
 *
 * Anatomy comes from `anatomy.ts` (stylised procedural model: lofted torso, muscle-shaped limbs,
 * detailed hands/feet, optional skeleton for an X-ray view). It is decoupled from the clinical
 * logic: joints are addressed only by registry ID, and marker appearance is derived from the
 * recorded findings via `markerKind`. Swapping in a licensed anatomical GLB means replacing
 * <Anatomy /> — nothing in /domain changes.
 *
 * Performance
 *  • frameloop="demand": nothing renders unless the camera moves or data changes
 *  • skin and skeleton are each ONE merged, vertex-coloured geometry (1 draw call each)
 *  • all 54 joint markers are drawn with 4 InstancedMeshes (core, outline, pain halo, hit area)
 *  • adaptive DPR while interacting, damped controls, exponential camera easing
 *  • labels are a plain DOM layer positioned by projection (no portals inside the canvas)
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { AdaptiveDpr, OrbitControls } from '@react-three/drei'
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { EMPTY_FINDING, type AssessmentData } from '../domain/assessment'
import { JOINTS, JOINT_BY_ID, REGIONS, type JointDef, type RegionId } from '../domain/joints'
import { KIND_META, PAIN_COLOR, SELECTED_COLOR, UNEXAMINED_STROKE, markerKind } from '../ui/status'
import { buildAnatomy } from './anatomy'

export type ViewName = 'front' | 'back' | 'left' | 'right'

export interface SceneController {
  setView(view: ViewName): void
  focusRegion(id: RegionId): void
  /** Smoothly frame the part of the body that contains this joint. */
  focusJoint(jointId: string): void
  reset(): void
  zoom(factor: number): void
}

interface Props {
  data: AssessmentData
  selectedId: string | null
  onSelect(id: string): void
  controllerRef: Ref<SceneController>
  onViewChange?(view: ViewName | null): void
  highlightIds: ReadonlySet<string> | null
  /** X-ray: translucent skin with the skeleton visible. */
  showBones?: boolean
}

const FULL = REGIONS.find((r) => r.id === 'full')!

/** Which camera framing best shows a joint (used by the guided examination). */
function regionForJoint(j: JointDef): RegionId {
  switch (j.group) {
    case 'wrist':
    case 'mcp':
    case 'pip':
    case 'dip':
      return j.side === 'R' ? 'hand-r' : 'hand-l'
    case 'ankle':
    case 'mtp':
      return j.side === 'R' ? 'foot-r' : 'foot-l'
    case 'shoulder':
    case 'elbow':
      return 'upper-limbs'
    case 'hip':
    case 'knee':
      return 'hips-knees'
    case 'tmj':
      return 'head-neck'
    case 'spine':
      return 'trunk-spine'
  }
}

const DIRS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0), // patient's left is +x
  right: new THREE.Vector3(-1, 0, 0),
}

function viewFromCamera(cam: THREE.Camera, target: THREE.Vector3): ViewName | null {
  const deg = (Math.atan2(cam.position.x - target.x, cam.position.z - target.z) * 180) / Math.PI
  const within = (c: number) => Math.abs(((deg - c + 540) % 360) - 180) <= 28
  if (within(0)) return 'front'
  if (within(180)) return 'back'
  if (within(90)) return 'left'
  if (within(-90)) return 'right'
  return null
}

// ---------------------------------------------------------------------------------------
// Anatomy (skin + optional skeleton)
// ---------------------------------------------------------------------------------------

const Anatomy = memo(function Anatomy({ showBones }: { showBones: boolean }) {
  const detail = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4 ? 0.75 : 1
  const geo = useMemo(() => buildAnatomy(detail), [detail])
  useEffect(
    () => () => {
      geo.skin.dispose()
      geo.bones.dispose()
    },
    [geo],
  )

  const skin = useMemo(
    () =>
      // Standard (not physical) shading: near-identical look with soft lighting, much cheaper per pixel.
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
    [],
  )
  const bone = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }), [])

  useLayoutEffect(() => {
    skin.transparent = showBones
    skin.opacity = showBones ? 0.16 : 1
    skin.depthWrite = !showBones
    skin.needsUpdate = true
  }, [showBones, skin])

  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation()

  return (
    <group>
      {/* Opaque skin occludes picking of markers on the far side; in X-ray it does not. */}
      <mesh
        geometry={geo.skin}
        material={skin}
        renderOrder={showBones ? 2 : 0}
        onClick={showBones ? undefined : stop}
        onPointerOver={showBones ? undefined : stop}
        raycast={showBones ? () => null : THREE.Mesh.prototype.raycast}
      />
      <mesh geometry={geo.bones} material={bone} visible={showBones} raycast={() => null} />
    </group>
  )
})

function GroundShadow() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    grad.addColorStop(0, 'rgba(20,30,45,0.38)')
    grad.addColorStop(0.55, 'rgba(20,30,45,0.12)')
    grad.addColorStop(1, 'rgba(20,30,45,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0.02]} raycast={() => null}>
        <planeGeometry args={[0.9, 0.7]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} raycast={() => null}>
        <ringGeometry args={[0.5, 0.515, 72]} />
        <meshBasicMaterial color="#9fb0c2" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------------------
// Joint markers — 4 instanced meshes for all 54 joints
// ---------------------------------------------------------------------------------------

const N = JOINTS.length
const SPHERE = new THREE.SphereGeometry(1, 14, 10)
/** Outlines, halos and hit areas don't need the core's smoothness. */
const SPHERE_LO = new THREE.SphereGeometry(1, 12, 8)
const SMALL_IDS = new Set(JOINTS.filter((j) => ['mcp', 'pip', 'dip', 'mtp'].includes(j.group)).map((j) => j.id))
const DECLUTTER_IDS = new Set(JOINTS.filter((j) => ['dip', 'mtp'].includes(j.group)).map((j) => j.id))

function markerRadius(j: JointDef): number {
  switch (j.group) {
    case 'shoulder':
    case 'knee':
    case 'hip':
      return 0.03
    case 'elbow':
    case 'wrist':
    case 'ankle':
      return 0.024
    case 'spine':
      return 0.028
    case 'tmj':
      return 0.018
    case 'mcp':
    case 'pip':
      return 0.0125
    default:
      return 0.011
  }
}

const C_WHITE = new THREE.Color('#ffffff')
const C_SELECTED = new THREE.Color(SELECTED_COLOR)
const C_UNEXAMINED = new THREE.Color(UNEXAMINED_STROKE)
const KIND_COLORS = Object.fromEntries(Object.entries(KIND_META).map(([k, v]) => [k, new THREE.Color(v.color)])) as Record<
  keyof typeof KIND_META,
  THREE.Color
>

interface MarkerProps {
  data: AssessmentData
  selectedId: string | null
  highlightIds: ReadonlySet<string> | null
  onSelect(id: string): void
  onHover(id: string | null): void
}

function InstancedMarkers({ data, selectedId, highlightIds, onSelect, onHover }: MarkerProps) {
  const core = useRef<THREE.InstancedMesh>(null)
  const hull = useRef<THREE.InstancedMesh>(null)
  const halo = useRef<THREE.InstancedMesh>(null)
  const hit = useRef<THREE.InstancedMesh>(null)
  const { camera, invalidate } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const scale = useRef({ large: 1, small: 1, overview: false })
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const mats = useMemo(
    () => ({
      core: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      hull: new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ color: PAIN_COLOR, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
    }),
    [],
  )

  const apply = useCallback(() => {
    if (!core.current || !hull.current || !halo.current || !hit.current) return
    const m = { core: core.current, hull: hull.current, halo: halo.current, hit: hit.current }
    const { large, small, overview } = scale.current
    const put = (mesh: THREE.InstancedMesh, i: number, pos: readonly number[], s: number) => {
      dummy.position.set(pos[0], pos[1], pos[2])
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    JOINTS.forEach((j, i) => {
      const f = data.joints[j.id] ?? EMPTY_FINDING
      const kind = markerKind(f)
      const sel = j.id === selectedId
      const pain = f.pain === 'yes'
      const dim = highlightIds !== null && !highlightIds.has(j.id)
      const important = sel || kind !== 'unexamined' || pain
      const hidden = overview && DECLUTTER_IDS.has(j.id) && !important
      const r = hidden ? 0 : markerRadius(j) * (SMALL_IDS.has(j.id) ? small : large)
      put(m.core, i, j.position, r * (sel ? 1.18 : 1) * (dim ? 0.7 : 1))
      put(m.hull, i, j.position, r * (sel ? 1.75 : 1.3))
      put(m.halo, i, j.position, pain ? r * 2 : 0)
      put(m.hit, i, j.position, hidden ? 0 : Math.max(r * 2.1, 0.026))
      m.core.setColorAt(i, KIND_COLORS[kind])
      m.hull.setColorAt(i, sel ? C_SELECTED : kind === 'unexamined' || kind === 'partial' ? C_UNEXAMINED : C_WHITE)
    })
    for (const mesh of [m.core, m.hull, m.halo, m.hit]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    invalidate()
  }, [data.joints, selectedId, highlightIds, dummy, invalidate])

  useLayoutEffect(apply, [apply])

  // Keep markers a comfortable on-screen size; declutter tiny pain-map joints in the overview.
  useFrame(() => {
    const dist = controls ? camera.position.distanceTo(controls.target) : 3
    const next = {
      large: THREE.MathUtils.clamp(dist / 3.4, 0.75, 1.15),
      small: THREE.MathUtils.clamp(dist / 2.2, 0.9, 1.35),
      overview: dist > 2.1,
    }
    const cur = scale.current
    if (Math.abs(next.large - cur.large) < 0.004 && Math.abs(next.small - cur.small) < 0.004 && next.overview === cur.overview) return
    scale.current = next
    apply()
  })

  const idOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : JOINTS[e.instanceId]?.id ?? null)

  return (
    <group>
      <instancedMesh ref={halo} args={[SPHERE_LO, mats.halo, N]} raycast={() => null} renderOrder={3} />
      <instancedMesh ref={hull} args={[SPHERE_LO, mats.hull, N]} raycast={() => null} renderOrder={4} />
      <instancedMesh ref={core} args={[SPHERE, mats.core, N]} raycast={() => null} renderOrder={5} />
      <instancedMesh
        ref={hit}
        args={[SPHERE_LO, mats.hit, N]}
        onClick={(e) => {
          if (e.delta > 4) return // a drag, not a click
          const id = idOf(e)
          if (!id) return
          e.stopPropagation()
          onSelect(id)
        }}
        onPointerMove={(e) => {
          const id = idOf(e)
          if (!id) return
          e.stopPropagation()
          onHover(id)
        }}
        onPointerOut={() => onHover(null)}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------------------
// Camera rig
// ---------------------------------------------------------------------------------------

interface Goal {
  pos: THREE.Vector3
  target: THREE.Vector3
}

const PAN_MIN = new THREE.Vector3(-0.9, 0, -0.6)
const PAN_MAX = new THREE.Vector3(0.9, 1.9, 0.6)

function Rig({ controllerRef, onViewChange }: { controllerRef: Ref<SceneController>; onViewChange?: (v: ViewName | null) => void }) {
  const { camera, invalidate, gl } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const goal = useRef<Goal | null>(null)
  const viewCb = useRef(onViewChange)
  viewCb.current = onViewChange

  // Test hook (only with ?e2e in the URL): lets automated tests click real markers.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('e2e')) return
    const w = window as unknown as { __rheum?: unknown }
    w.__rheum = {
      project(id: string) {
        camera.updateMatrixWorld()
        const v = new THREE.Vector3(...JOINT_BY_ID[id].position).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      stats() {
        return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries }
      },
    }
    return () => {
      delete w.__rheum
    }
  }, [camera, gl])

  useEffect(() => {
    camera.position.set(0, FULL.target[1] + 0.25, FULL.distance)
    camera.lookAt(FULL.target[0], FULL.target[1], FULL.target[2])
    if (controls) {
      controls.target.set(...FULL.target)
      controls.update()
    }
    invalidate()
  }, [camera, controls, invalidate])

  useEffect(() => {
    if (!controls) return
    const stop = () => {
      goal.current = null
    }
    const end = () => viewCb.current?.(viewFromCamera(camera, controls.target))
    controls.addEventListener('start', stop)
    controls.addEventListener('end', end)
    return () => {
      controls.removeEventListener('start', stop)
      controls.removeEventListener('end', end)
    }
  }, [controls, camera])

  const horizontalDir = useCallback(() => {
    const t = controls?.target ?? new THREE.Vector3(...FULL.target)
    const d = camera.position.clone().sub(t)
    d.y = 0
    return d.lengthSq() < 1e-6 ? DIRS.front.clone() : d.normalize()
  }, [camera, controls])

  const frame = useCallback(
    (id: RegionId) => {
      if (!controls) return
      const region = REGIONS.find((r) => r.id === id) ?? FULL
      const t = new THREE.Vector3(...region.target)
      let dir = horizontalDir()
      if (id === 'trunk-spine') dir = DIRS.back.clone()
      else if (id === 'full' || id === 'head-neck') dir = dir.z < 0 && Math.abs(dir.x) < 0.5 ? DIRS.back.clone() : DIRS.front.clone()
      const pos = t.clone().add(dir.multiplyScalar(region.distance)).setY(t.y + region.distance * 0.1)
      goal.current = { pos, target: t }
      invalidate()
    },
    [controls, horizontalDir, invalidate],
  )

  useImperativeHandle(
    controllerRef,
    () => ({
      setView(view) {
        if (!controls) return
        const t = controls.target.clone()
        const dist = Math.max(camera.position.distanceTo(t), 0.5)
        goal.current = { pos: t.clone().add(DIRS[view].clone().multiplyScalar(dist)).setY(t.y + dist * 0.12), target: t }
        invalidate()
      },
      focusRegion: frame,
      focusJoint(jointId) {
        const j = JOINT_BY_ID[jointId]
        if (j) frame(regionForJoint(j))
      },
      reset() {
        if (!controls) return
        goal.current = {
          pos: new THREE.Vector3(0, FULL.target[1] + FULL.distance * 0.07, FULL.distance),
          target: new THREE.Vector3(...FULL.target),
        }
        invalidate()
      },
      zoom(factor) {
        if (!controls) return
        const t = controls.target.clone()
        const dir = camera.position.clone().sub(t)
        const dist = THREE.MathUtils.clamp(dir.length() * factor, 0.4, 6)
        goal.current = { pos: t.clone().add(dir.normalize().multiplyScalar(dist)), target: t }
        invalidate()
      },
    }),
    [camera, controls, invalidate, frame],
  )

  useFrame((_, dt) => {
    if (!controls) return
    controls.target.clamp(PAN_MIN, PAN_MAX)
    const g = goal.current
    if (!g) return
    const k = 1 - Math.exp(-7 * Math.min(dt, 0.05))
    camera.position.lerp(g.pos, k)
    controls.target.lerp(g.target, k)
    controls.update()
    if (camera.position.distanceToSquared(g.pos) < 1e-6 && controls.target.distanceToSquared(g.target) < 1e-6) {
      camera.position.copy(g.pos)
      controls.target.copy(g.target)
      controls.update()
      goal.current = null
      viewCb.current?.(viewFromCamera(camera, controls.target))
    }
    invalidate()
  })

  return null
}

// ---------------------------------------------------------------------------------------
// DOM label layer
// ---------------------------------------------------------------------------------------

interface LabelEntry {
  key: string
  position: readonly [number, number, number]
  side?: 'front' | 'back' | 'both'
}

function LabelProjector({ entries, elements }: { entries: LabelEntry[]; elements: { current: Map<string, HTMLElement> } }) {
  const { camera, size, invalidate } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const v = useRef(new THREE.Vector3()).current

  useEffect(() => {
    invalidate()
  }, [entries, invalidate])

  useFrame(() => {
    const facingFront = camera.position.z - (controls?.target.z ?? 0) > 0
    for (const e of entries) {
      const el = elements.current.get(e.key)
      if (!el) continue
      v.set(e.position[0], e.position[1], e.position[2]).project(camera)
      const hidden = v.z > 1 || (e.side === 'front' && !facingFront) || (e.side === 'back' && facingFront)
      el.style.visibility = hidden ? 'hidden' : 'visible'
      if (!hidden) {
        const x = ((v.x + 1) / 2) * size.width
        const y = ((1 - v.y) / 2) * size.height
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -135%)`
      }
    }
  })
  return null
}

export default function Body3D({ data, selectedId, onSelect, controllerRef, onViewChange, highlightIds, showBones = false }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const elements = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    document.body.style.cursor = hoverId ? 'pointer' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hoverId])

  const labels = useMemo(() => {
    const out: { id: string; text: string | null; code: string }[] = []
    for (const j of JOINTS) {
      const f = data.joints[j.id] ?? EMPTY_FINDING
      const kind = markerKind(f)
      const code = [kind === 'tender' || kind === 'swollen' || kind === 'both' ? KIND_META[kind].code : '', f.pain === 'yes' ? 'P' : '']
        .filter(Boolean)
        .join(' ')
      const named = j.id === selectedId || j.id === hoverId
      if (code || named) out.push({ id: j.id, text: named ? j.name : null, code })
    }
    return out
  }, [data.joints, selectedId, hoverId])

  const entries = useMemo<LabelEntry[]>(
    () => [
      ...labels.map((l) => {
        const j = JOINT_BY_ID[l.id]
        return { key: l.id, position: [j.position[0], j.position[1] + markerRadius(j) * 1.6, j.position[2]] as const, side: j.bodyView }
      }),
      { key: '__R', position: [-0.64, 0.03, 0] as const, side: 'both' as const },
      { key: '__L', position: [0.64, 0.03, 0] as const, side: 'both' as const },
    ],
    [labels],
  )

  const setEl = (key: string) => (el: HTMLElement | null) => {
    if (el) elements.current.set(key, el)
    else elements.current.delete(key)
  }

  return (
    <div className="scene-root">
      <Canvas
        className="canvas3d"
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 32, near: 0.05, far: 30, position: [0, 1.2, 3.7] }}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
        performance={{ min: 0.6 }}
        aria-label="Interactive 3D body model. The joint chart offers the same workflow for keyboard users."
      >
        <hemisphereLight args={['#fff7f0', '#8d8178', 0.95]} />
        <directionalLight position={[2.5, 3.5, 4]} intensity={1.7} color="#fff4ea" />
        <directionalLight position={[-3, 2, 2.5]} intensity={0.55} color="#dfe8ff" />
        <directionalLight position={[0, 2.6, -4]} intensity={1.0} color="#ffffff" />
        <Anatomy showBones={showBones} />
        <GroundShadow />
        <InstancedMarkers data={data} selectedId={selectedId} highlightIds={highlightIds} onSelect={onSelect} onHover={setHoverId} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          rotateSpeed={0.7}
          zoomSpeed={0.8}
          panSpeed={0.7}
          minDistance={0.4}
          maxDistance={6}
          minPolarAngle={Math.PI * 0.22}
          maxPolarAngle={Math.PI * 0.62}
          regress
        />
        <Rig controllerRef={controllerRef} onViewChange={onViewChange} />
        <LabelProjector entries={entries} elements={elements} />
        <AdaptiveDpr pixelated />
      </Canvas>
      <div className="chip-layer" aria-hidden="true">
        {labels.map((l) => (
          <div key={l.id} ref={setEl(l.id)} className={`chip3d${l.id === selectedId ? ' sel' : ''}`}>
            {l.text && <span className="chip3d-name">{l.text}</span>}
            {l.code && <span className="chip3d-code">{l.code}</span>}
          </div>
        ))}
        <div ref={setEl('__R')} className="orient3d">
          R
        </div>
        <div ref={setEl('__L')} className="orient3d">
          L
        </div>
      </div>
    </div>
  )
}
