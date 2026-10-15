/**
 * Interactive 3D body — react-three-fiber.
 *
 * The geometry here is a clearly-labelled PROCEDURAL PROTOTYPE (capsules and spheres); it is
 * not anatomically accurate. It is deliberately decoupled from the clinical logic: joints are
 * addressed only by registry ID, and marker appearance is derived from recorded findings by
 * `markerKind`. Swapping in a licensed anatomical GLB means replacing <ProceduralBody /> and
 * mapping each registry joint to its anchor — nothing in /domain changes.
 *
 * Smoothness: render-on-demand frame loop, shared geometries/materials, memoised markers,
 * adaptive DPR while interacting, damped controls and exponential camera easing.
 */
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { AdaptiveDpr, OrbitControls } from '@react-three/drei'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { EMPTY_FINDING, type AssessmentData, type JointFinding } from '../domain/assessment'
import { JOINTS, JOINT_BY_ID, REGIONS, WRIST_X, WRIST_Y, type JointDef, type RegionId } from '../domain/joints'
import { KIND_META, PAIN_COLOR, SELECTED_COLOR, UNEXAMINED_STROKE, markerKind, type MarkerKind } from '../ui/status'

export type ViewName = 'front' | 'back' | 'left' | 'right'

export interface SceneController {
  setView(view: ViewName): void
  focusRegion(id: RegionId): void
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
}

const FULL = REGIONS.find((r) => r.id === 'full')!

const DIRS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0), // patient's left is +x
  right: new THREE.Vector3(-1, 0, 0),
}

function viewFromCamera(cam: THREE.Camera, target: THREE.Vector3): ViewName | null {
  const dx = cam.position.x - target.x
  const dz = cam.position.z - target.z
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI // 0 = front, 180 = back, +90 = patient's left
  const within = (c: number) => Math.abs(((deg - c + 540) % 360) - 180) <= 28
  if (within(0)) return 'front'
  if (within(180)) return 'back'
  if (within(90)) return 'left'
  if (within(-90)) return 'right'
  return null
}

// ---------------------------------------------------------------------------------------
// Procedural body — merged into ONE geometry (one draw call) with per-part vertex colours.
// ---------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0)
const SKIN = new THREE.Color('#cfd8e3')
const SKIN_JOINT = new THREE.Color('#bcc7d4')

const p3 = (id: string): [number, number, number] => {
  const j = JOINT_BY_ID[id].position
  return [j[0], j[1], 0]
}

function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const tmp = new THREE.Object3D()

  const push = (geo: THREE.BufferGeometry, pos: readonly number[], color: THREE.Color, quat?: THREE.Quaternion, scale?: readonly number[]) => {
    tmp.position.set(pos[0], pos[1], pos[2])
    tmp.quaternion.copy(quat ?? new THREE.Quaternion())
    tmp.scale.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1)
    tmp.updateMatrix()
    geo.applyMatrix4(tmp.matrix)
    const n = geo.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.toArray(col, i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    parts.push(geo)
  }
  const sphere = (pos: readonly number[], r: number, color = SKIN, scale?: readonly number[], seg = 14) =>
    push(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), pos, color, undefined, scale)
  const limb = (a: readonly number[], b: readonly number[], r: number, color = SKIN) => {
    const va = new THREE.Vector3(a[0], a[1], a[2])
    const vb = new THREE.Vector3(b[0], b[1], b[2])
    const dir = vb.clone().sub(va)
    const len = dir.length()
    const mid = va.clone().add(vb).multiplyScalar(0.5)
    push(
      new THREE.CapsuleGeometry(r, Math.max(len - 2 * r, 0.001), 3, 10),
      [mid.x, mid.y, mid.z],
      color,
      new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()),
    )
  }
  const box = (pos: readonly number[], size: readonly number[]) => push(new THREE.BoxGeometry(size[0], size[1], size[2]), pos, SKIN)

  // head, neck, trunk, pelvis
  sphere([0, 1.72, 0], 0.108, SKIN, [0.92, 1.12, 1], 20)
  limb([0, 1.5, 0], [0, 1.62, 0], 0.048)
  push(new THREE.CapsuleGeometry(0.12, 0.34, 4, 16), [0, 1.22, 0], SKIN, undefined, [1.9, 1, 0.9])
  sphere([0, 0.97, 0], 0.12, SKIN, [1.7, 0.95, 1], 18)

  for (const side of ['r', 'l'] as const) {
    const s = side === 'r' ? -1 : 1
    // arm
    sphere([s * 0.2, 1.45, 0], 0.062)
    limb(p3(`shoulder_${side}`), p3(`elbow_${side}`), 0.046)
    limb(p3(`elbow_${side}`), p3(`wrist_${side}`), 0.038)
    sphere(p3(`elbow_${side}`), 0.044, SKIN_JOINT, undefined, 12)
    sphere([s * WRIST_X, WRIST_Y, 0], 0.032, SKIN_JOINT, undefined, 12)
    // hand
    box([s * (WRIST_X + 0.011), WRIST_Y - 0.047, 0], [0.1, 0.1, 0.016])
    for (const d of [1, 2, 3, 4, 5] as const) {
      const mcp = p3(`mcp${d}_${side}`)
      const pip = p3(`pip${d}_${side}`)
      const dip = d === 1 ? null : p3(`dip${d}_${side}`)
      const last = dip ?? pip
      limb(mcp, pip, 0.0085)
      if (dip) limb(pip, dip, 0.0085)
      limb(last, [last[0], last[1] - (d === 1 ? 0.03 : 0.024), 0], 0.0085)
    }
    // leg
    limb(p3(`hip_${side}`), p3(`knee_${side}`), 0.076)
    limb(p3(`knee_${side}`), p3(`ankle_${side}`), 0.056)
    sphere(p3(`knee_${side}`), 0.062, SKIN_JOINT, undefined, 12)
    box([s * 0.11, 0.035, 0.07], [0.1, 0.06, 0.26])
  }

  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  if (!merged) throw new Error('Could not build body geometry')
  merged.computeBoundingSphere()
  return merged
}

const ProceduralBody = memo(function ProceduralBody() {
  const geometry = useMemo(buildBodyGeometry, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    // The body occludes markers on its far side for picking as well as for rendering.
    <mesh
      geometry={geometry}
      onClick={(e) => e.stopPropagation()}
      onPointerOver={(e) => e.stopPropagation()}
    >
      <meshStandardMaterial vertexColors roughness={0.82} metalness={0} />
    </mesh>
  )
})

// ---------------------------------------------------------------------------------------
// Joint markers
// ---------------------------------------------------------------------------------------

const SPHERE = new THREE.SphereGeometry(1, 16, 12)

function useMaterials() {
  return useMemo(() => {
    const basic = (color: string, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) =>
      new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra })
    const core = {} as Record<MarkerKind, THREE.MeshBasicMaterial>
    ;(Object.keys(KIND_META) as MarkerKind[]).forEach((k) => (core[k] = basic(KIND_META[k].color)))
    return {
      core,
      hullSelected: basic(SELECTED_COLOR, { side: THREE.BackSide }),
      hullUnexamined: basic(UNEXAMINED_STROKE, { side: THREE.BackSide }),
      hullDefault: basic('#ffffff', { side: THREE.BackSide }),
      pain: basic(PAIN_COLOR, { transparent: true, opacity: 0.5, depthWrite: false }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
    }
  }, [])
}

type Mats = ReturnType<typeof useMaterials>

const DECLUTTER_IDS = new Set(JOINTS.filter((j) => ['dip', 'mtp'].includes(j.group)).map((j) => j.id))
const SMALL_IDS = new Set(JOINTS.filter((j) => ['mcp', 'pip', 'dip', 'mtp'].includes(j.group)).map((j) => j.id))

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
      return 0.02
    case 'mcp':
    case 'pip':
      return 0.0135
    default:
      return 0.0115
  }
}

interface MarkerProps {
  joint: JointDef
  finding: JointFinding
  selected: boolean
  dimmed: boolean
  mats: Mats
  onSelect(id: string): void
  onHover(id: string | null): void
  register(id: string, g: THREE.Group | null): void
}

const Marker3D = memo(function Marker3D({ joint, finding, selected, dimmed, mats, onSelect, onHover, register }: MarkerProps) {
  const [hover, setHoverState] = useState(false)
  const setHover = (v: boolean) => {
    setHoverState(v)
    onHover(v ? joint.id : null)
  }
  const kind = markerKind(finding)
  const r = markerRadius(joint)
  const pain = finding.pain === 'yes'
  const hull = selected ? mats.hullSelected : kind === 'unexamined' || kind === 'partial' ? mats.hullUnexamined : mats.hullDefault

  const important = selected || kind !== 'unexamined' || pain
  const groupRef = useRef<THREE.Group | null>(null)
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.userData.important = important
      if (important) groupRef.current.visible = true
    }
  }, [important])

  useEffect(() => {
    if (!hover) return
    document.body.style.cursor = 'pointer'
    return () => {
      document.body.style.cursor = ''
    }
  }, [hover])

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return // was a drag/rotate, not a click
    e.stopPropagation()
    onSelect(joint.id)
  }

  return (
    <group
      position={joint.position as unknown as [number, number, number]}
      ref={(g) => {
        groupRef.current = g
        register(joint.id, g)
      }}
    >
      <mesh
        geometry={SPHERE}
        material={mats.hit}
        scale={Math.max(r * 2.1, 0.028)}
        onClick={click}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
      />
      {pain && <mesh geometry={SPHERE} material={mats.pain} scale={r * 1.95} raycast={() => null} />}
      <mesh geometry={SPHERE} material={hull} scale={r * (selected ? 1.7 : 1.28)} raycast={() => null} />
      <mesh
        geometry={SPHERE}
        material={mats.core[kind]}
        scale={r * (selected ? 1.18 : 1) * (dimmed ? 0.7 : 1)}
        raycast={() => null}
      />
    </group>
  )
})

function Markers({
  data,
  selectedId,
  onSelect,
  onHover,
  highlightIds,
}: Omit<Props, 'controllerRef' | 'onViewChange'> & { onHover(id: string | null): void }) {
  const mats = useMaterials()
  const groups = useRef(new Map<string, THREE.Group>())
  const { camera } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const lastScale = useRef(1)
  const lastSmall = useRef(1)
  const lastOverview = useRef(false)

  const register = useRef((id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g)
    else groups.current.delete(id)
  }).current

  // Keep markers a comfortable on-screen size at overview distances: small finger/toe joints grow
  // as the camera pulls back (so they stay clickable); large joints stay close to true size.
  useFrame(() => {
    const dist = controls ? camera.position.distanceTo(controls.target) : 3
    const large = THREE.MathUtils.clamp(dist / 3.4, 0.75, 1.15)
    const small = THREE.MathUtils.clamp(dist / 2.2, 0.9, 1.35)
    const overview = dist > 2.1
    if (
      Math.abs(large - lastScale.current) < 0.004 &&
      Math.abs(small - lastSmall.current) < 0.004 &&
      overview === lastOverview.current
    )
      return
    lastScale.current = large
    lastSmall.current = small
    lastOverview.current = overview
    groups.current.forEach((g, id) => {
      g.scale.setScalar(SMALL_IDS.has(id) ? small : large)
      // Declutter the overview: pain-map-only finger/toe joints appear once the camera is close,
      // unless they carry a finding or are selected.
      g.visible = !(overview && DECLUTTER_IDS.has(id) && !g.userData.important)
    })
  })

  return (
    <>
      {JOINTS.map((j) => (
        <Marker3D
          key={j.id}
          joint={j}
          finding={data.joints[j.id] ?? EMPTY_FINDING}
          selected={selectedId === j.id}
          dimmed={highlightIds !== null && !highlightIds.has(j.id)}
          mats={mats}
          onSelect={onSelect}
          onHover={onHover}
          register={register}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------------------
// Camera control
// ---------------------------------------------------------------------------------------

interface Goal {
  pos: THREE.Vector3
  target: THREE.Vector3
}

function Rig({ controllerRef, onViewChange }: { controllerRef: Ref<SceneController>; onViewChange?: (v: ViewName | null) => void }) {
  const { camera, invalidate, gl } = useThree()
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const goal = useRef<Goal | null>(null)

  // Test hook (only with ?e2e in the URL): lets automated tests click real markers.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('e2e')) return
    const w = window as unknown as { __rheum?: unknown }
    w.__rheum = {
      project(id: string) {
        camera.updateMatrixWorld()
        const j = JOINT_BY_ID[id]
        const v = new THREE.Vector3(...j.position).project(camera)
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
  const viewCb = useRef(onViewChange)
  viewCb.current = onViewChange

  // Initial framing.
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

  useImperativeHandle(
    controllerRef,
    () => ({
      setView(view) {
        if (!controls) return
        const t = controls.target.clone()
        const dist = Math.max(camera.position.distanceTo(t), 0.5)
        const pos = t.clone().add(DIRS[view].clone().multiplyScalar(dist)).setY(t.y + dist * 0.12)
        goal.current = { pos, target: t }
        invalidate()
      },
      focusRegion(id) {
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
    [camera, controls, invalidate, horizontalDir],
  )

  useFrame((_, dt) => {
    if (!controls) return
    // Keep panning within a sensible box so the model cannot be lost off-screen.
    controls.target.clamp(PAN_MIN, PAN_MAX)
    const g = goal.current
    if (!g) return
    const k = 1 - Math.exp(-8 * Math.min(dt, 0.05))
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

const PAN_MIN = new THREE.Vector3(-0.9, 0, -0.6)
const PAN_MAX = new THREE.Vector3(0.9, 1.9, 0.6)

function Floor() {
  return (
    <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.46, 0.5, 64]} />
      <meshBasicMaterial color="#8aa0b8" transparent opacity={0.55} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------------------
// DOM label layer: labels are plain HTML placed by projecting joint anchors every frame.
// (No portals inside the canvas, so the 3D scene can be mounted/unmounted safely.)
// ---------------------------------------------------------------------------------------

interface LabelEntry {
  key: string
  position: readonly [number, number, number]
  /** Hide when the camera looks at the opposite side of the body. */
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
    const els = elements.current
    const facingFront = camera.position.z - (controls?.target.z ?? 0) > 0
    for (const e of entries) {
      const el = els.get(e.key)
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

export default function Body3D({ data, selectedId, onSelect, controllerRef, onViewChange, highlightIds }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const elements = useRef(new Map<string, HTMLElement>())

  const labels = useMemo(() => {
    const out: { id: string; text: string | null; code: string }[] = []
    for (const j of JOINTS) {
      const f = data.joints[j.id] ?? EMPTY_FINDING
      const kind = markerKind(f)
      const code = [
        kind === 'tender' || kind === 'swollen' || kind === 'both' ? KIND_META[kind].code : '',
        f.pain === 'yes' ? 'P' : '',
      ]
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
        return {
          key: l.id,
          position: [j.position[0], j.position[1] + markerRadius(j) * 1.6, j.position[2]] as const,
          side: j.bodyView,
        }
      }),
      { key: '__R', position: [-0.62, 0.03, 0] as const, side: 'both' as const },
      { key: '__L', position: [0.62, 0.03, 0] as const, side: 'both' as const },
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
        aria-label="Interactive 3D body model. Use the joint list or 2D chart for keyboard access."
      >
        <hemisphereLight args={['#ffffff', '#8996a6', 1.25]} />
        <directionalLight position={[2, 3, 4]} intensity={1.5} />
        <directionalLight position={[-2.5, 2, -3.5]} intensity={0.8} />
        <ProceduralBody />
        <Floor />
        <Markers data={data} selectedId={selectedId} onSelect={onSelect} onHover={setHoverId} highlightIds={highlightIds} />
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
