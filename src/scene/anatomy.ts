/**
 * Procedural anatomical body — pure geometry, no React.
 *
 * Builds two merged, vertex-coloured BufferGeometries (one draw call each):
 *   • skin  — lofted torso, shaped head/face/ears, muscle-shaped tapered limbs, detailed hands
 *             (palm, thenar eminence, three phalanges per finger, knuckles, nails) and feet
 *             (heel, arch, five toes, malleoli).
 *   • bones — simplified skeleton for the X-ray view: skull + mandible, curved spine, rib cage,
 *             sternum, clavicles, scapulae, pelvis, long bones with epiphyses, carpals,
 *             metacarpals and phalanges, patellae, tarsals, metatarsals and toe phalanges.
 *
 * Every joint anchor comes from the canonical registry (domain/joints.ts), so the surface and the
 * skeleton always line up with the clinical markers. This is still a stylised model — it is not a
 * medically accurate anatomical asset.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { JOINT_BY_ID, WRIST_X, WRIST_Y } from '../domain/joints'

type V3 = readonly [number, number, number]

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Size-based level of detail: a part's tessellation scales with its physical size, so tiny parts
 * (phalanges, toes, vertebrae) use few segments while the torso and head stay smooth.
 */
export function segmentsFor(requested: number, size: number): number {
  if (size < 0.008) return Math.min(requested, 7)
  if (size < 0.015) return Math.min(requested, 9)
  if (size < 0.03) return Math.min(requested, 12)
  return requested
}

export const SKIN_COLORS = {
  base: new THREE.Color('#e2c4b0'),
  shade: new THREE.Color('#d2ad97'),
  joint: new THREE.Color('#d7b29c'),
  nail: new THREE.Color('#efd6cf'),
}
export const BONE_COLORS = {
  base: new THREE.Color('#ece4cf'),
  joint: new THREE.Color('#d9ccad'),
  cartilage: new THREE.Color('#c9d8dc'),
}

export class GeometryBuilder {
  private readonly parts: THREE.BufferGeometry[] = []
  private readonly tmp = new THREE.Object3D()

  /** Add an already-positioned geometry. */
  custom(geo: THREE.BufferGeometry, color: THREE.Color) {
    this.push(geo, color)
  }

  private push(geo: THREE.BufferGeometry, color: THREE.Color) {
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv')
    if (geo.getAttribute('uv1')) geo.deleteAttribute('uv1')
    const n = geo.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.toArray(col, i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.parts.push(geo)
  }

  private place(geo: THREE.BufferGeometry, pos: V3, quat?: THREE.Quaternion, scale?: V3) {
    this.tmp.position.set(pos[0], pos[1], pos[2])
    this.tmp.quaternion.copy(quat ?? new THREE.Quaternion())
    this.tmp.scale.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1)
    this.tmp.updateMatrix()
    geo.applyMatrix4(this.tmp.matrix)
    return geo
  }

  /** Ellipsoid with radii (x, y, z), optionally rotated. */
  ellipsoid(center: V3, radii: V3, color: THREE.Color, seg = 16, quat?: THREE.Quaternion) {
    const n = segmentsFor(seg, Math.max(radii[0], radii[1], radii[2]))
    const g = new THREE.SphereGeometry(1, n, Math.max(5, Math.round(n * 0.65)))
    this.push(this.place(g, center, quat, radii), color)
  }

  /** Ellipsoid whose long (y) axis runs from a to b. */
  along(a: V3, b: V3, width: number, depth: number, color: THREE.Color, seg = 14) {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const len = dir.length()
    const mid = va.add(vb).multiplyScalar(0.5)
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
    this.ellipsoid([mid.x, mid.y, mid.z], [width, len / 2, depth], color, seg, q)
  }

  /** Smooth tapered limb: open cone from a (radius ra) to b (radius rb) with rounded ends. */
  taper(a: V3, b: V3, ra: number, rb: number, color: THREE.Color, seg = 16, caps = true) {
    const va = new THREE.Vector3(...a)
    const vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const len = dir.length()
    if (len < 1e-5) return
    const mid = va.clone().add(vb).multiplyScalar(0.5)
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
    seg = segmentsFor(seg, Math.max(ra, rb))
    const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, true)
    this.push(this.place(g, [mid.x, mid.y, mid.z], q), color)
    if (caps) {
      this.ellipsoid(a, [ra, ra, ra], color, seg)
      this.ellipsoid(b, [rb, rb, rb], color, seg)
    }
  }

  /** Lofted closed surface through horizontal elliptical rings, listed from top to bottom. */
  loft(rings: { y: number; rx: number; rz: number; cx?: number; cz?: number }[], color: THREE.Color, seg = 40) {
    const pos: number[] = []
    const idx: number[] = []
    rings.forEach((r) => {
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2
        pos.push((r.cx ?? 0) + r.rx * Math.cos(t), r.y, (r.cz ?? 0) + r.rz * Math.sin(t))
      }
    })
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * seg + j
        const b = i * seg + ((j + 1) % seg)
        const c = (i + 1) * seg + j
        const d = (i + 1) * seg + ((j + 1) % seg)
        idx.push(a, b, c, b, d, c) // outward winding for top-to-bottom rings
      }
    }
    // caps
    const capTop = pos.length / 3
    const first = rings[0]
    pos.push(first.cx ?? 0, first.y, first.cz ?? 0)
    const capBottom = capTop + 1
    const last = rings[rings.length - 1]
    pos.push(last.cx ?? 0, last.y, last.cz ?? 0)
    for (let j = 0; j < seg; j++) {
      idx.push(capTop, (j + 1) % seg, j)
      const base = (rings.length - 1) * seg
      idx.push(capBottom, base + j, base + ((j + 1) % seg))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    this.push(g, color)
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)
    this.parts.forEach((p) => p.dispose())
    if (!merged) throw new Error('Could not merge anatomy geometry')
    merged.computeBoundingSphere()
    merged.computeBoundingBox()
    return merged
  }
}

const p = (id: string, z = 0): V3 => {
  const j = JOINT_BY_ID[id].position
  return [j[0], j[1], z]
}
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const FINGERS = [1, 2, 3, 4, 5] as const
const SIDES = ['r', 'l'] as const
const sign = (side: 'r' | 'l') => (side === 'r' ? -1 : 1)

// ---------------------------------------------------------------------------------------
// Skin
// ---------------------------------------------------------------------------------------

function buildSkin(detail: number): THREE.BufferGeometry {
  const b = new GeometryBuilder()
  const C = SKIN_COLORS
  const seg = Math.round(18 * detail)

  // Head: cranium, face/jaw, nose, ears — a calm mannequin face (no painted features)
  b.ellipsoid([0, 1.728, -0.006], [0.083, 0.104, 0.098], C.base, seg + 8)
  b.ellipsoid([0, 1.66, 0.026], [0.064, 0.062, 0.072], C.base, seg + 4)
  b.along([0, 1.724, 0.088], [0, 1.69, 0.102], 0.011, 0.012, C.base, 10)
  for (const side of SIDES) {
    const s = sign(side)
    b.ellipsoid([s * 0.03, 1.735, 0.084], [0.011, 0.006, 0.004], C.shade, 8) // closed eyelids
    b.ellipsoid([s * 0.086, 1.712, -0.004], [0.011, 0.026, 0.017], C.shade, 10) // ears
  }

  // Neck and trapezius
  b.taper([0, 1.6, -0.01], [0, 1.515, -0.012], 0.047, 0.056, C.base, seg)
  for (const side of SIDES) {
    const s = sign(side)
    b.along([s * 0.035, 1.555, -0.02], [s * 0.17, 1.465, -0.01], 0.03, 0.035, C.base, 12)
  }

  // Torso: lofted from neck base to pelvis
  b.loft(
    [
      { y: 1.515, rx: 0.07, rz: 0.055, cz: -0.012 },
      { y: 1.488, rx: 0.15, rz: 0.075, cz: -0.008 },
      { y: 1.46, rx: 0.19, rz: 0.088 },
      { y: 1.42, rx: 0.2, rz: 0.1, cz: 0.004 },
      { y: 1.35, rx: 0.198, rz: 0.115, cz: 0.008 },
      { y: 1.28, rx: 0.19, rz: 0.118, cz: 0.008 },
      { y: 1.2, rx: 0.175, rz: 0.11, cz: 0.004 },
      { y: 1.12, rx: 0.158, rz: 0.1 },
      { y: 1.05, rx: 0.155, rz: 0.098 },
      { y: 0.99, rx: 0.17, rz: 0.102, cz: -0.002 },
      { y: 0.93, rx: 0.186, rz: 0.106, cz: -0.004 },
      { y: 0.87, rx: 0.182, rz: 0.1, cz: -0.006 },
      { y: 0.82, rx: 0.15, rz: 0.085, cz: -0.004 },
      { y: 0.795, rx: 0.08, rz: 0.05 },
    ],
    C.base,
    Math.round(40 * detail),
  )
  // Pectorals, glutes, abdomen definition
  for (const side of SIDES) {
    const s = sign(side)
    b.ellipsoid([s * 0.085, 1.33, 0.09], [0.08, 0.055, 0.02], C.base, seg) // pectorals (subtle)
    b.ellipsoid([s * 0.08, 0.87, -0.06], [0.085, 0.085, 0.06], C.base, seg)
  }

  // Arms
  for (const side of SIDES) {
    const s = sign(side)
    const sh = p(`shoulder_${side}`)
    const el = p(`elbow_${side}`)
    const wr = p(`wrist_${side}`)
    b.ellipsoid([s * 0.2, 1.44, 0], [0.06, 0.068, 0.062], C.base, seg) // deltoid
    b.taper(sh, el, 0.05, 0.039, C.base, seg)
    b.along(lerp3(sh, el, 0.25), lerp3(sh, el, 0.8), 0.044, 0.05, C.base, seg) // biceps / triceps
    b.ellipsoid(el, [0.04, 0.04, 0.04], C.joint, seg)
    b.taper(el, wr, 0.038, 0.026, C.base, seg)
    b.along(lerp3(el, wr, 0.08), lerp3(el, wr, 0.55), 0.041, 0.035, C.base, seg) // forearm flexors
    b.ellipsoid(wr, [0.029, 0.022, 0.018], C.joint, seg)
  }

  // Hands (palms forward, thumbs lateral — anatomical position)
  for (const side of SIDES) {
    const s = sign(side)
    const wx = s * WRIST_X
    b.ellipsoid([wx + s * 0.01, WRIST_Y - 0.052, 0], [0.047, 0.05, 0.0125], C.base, seg) // palm
    b.ellipsoid([wx + s * 0.035, WRIST_Y - 0.045, 0.006], [0.02, 0.033, 0.013], C.base, 12) // thenar eminence
    b.ellipsoid([wx - s * 0.025, WRIST_Y - 0.05, 0.004], [0.015, 0.035, 0.01], C.base, 12) // hypothenar
    for (const d of FINGERS) {
      const mcp = p(`mcp${d}_${side}`)
      const pip = p(`pip${d}_${side}`)
      const radius = d === 1 ? 0.0105 : d === 5 ? 0.0075 : 0.0088
      if (d === 1) {
        const base: V3 = [wx + s * 0.045, WRIST_Y - 0.028, 0.004]
        b.taper(base, mcp, 0.013, radius + 0.001, C.base, 12)
        b.ellipsoid(mcp, [radius + 0.0015, radius + 0.0015, radius + 0.0015], C.joint, 12)
        b.taper(mcp, pip, radius, radius * 0.92, C.base, 12)
        const tip: V3 = [pip[0] + s * 0.002, pip[1] - 0.03, 0]
        b.ellipsoid(pip, [radius * 0.96, radius * 0.96, radius * 0.96], C.joint, 12)
        b.taper(pip, tip, radius * 0.9, radius * 0.75, C.base, 12)
        b.ellipsoid([tip[0], tip[1] + 0.006, -0.006], [0.0062, 0.009, 0.0022], C.nail, 8)
        continue
      }
      const dip = p(`dip${d}_${side}`)
      const tip: V3 = [dip[0], dip[1] - 0.024, 0]
      b.ellipsoid(mcp, [radius + 0.002, radius + 0.002, radius + 0.002], C.joint, 12) // knuckle
      b.taper(mcp, pip, radius, radius * 0.94, C.base, 12)
      b.ellipsoid(pip, [radius * 1.02, radius * 1.02, radius * 1.02], C.joint, 12)
      b.taper(pip, dip, radius * 0.92, radius * 0.86, C.base, 12)
      b.ellipsoid(dip, [radius * 0.9, radius * 0.9, radius * 0.9], C.joint, 12)
      b.taper(dip, tip, radius * 0.84, radius * 0.72, C.base, 12)
      b.ellipsoid([tip[0], tip[1] + 0.006, -0.0055], [radius * 0.62, 0.0075, 0.0018], C.nail, 8) // nail (dorsal)
    }
  }

  // Legs
  for (const side of SIDES) {
    const s = sign(side)
    const hip = p(`hip_${side}`)
    const kn = p(`knee_${side}`)
    const an = p(`ankle_${side}`)
    b.taper([hip[0], hip[1] - 0.02, 0], kn, 0.088, 0.058, C.base, seg)
    b.along(lerp3(hip, kn, 0.15), lerp3(hip, kn, 0.85), 0.07, 0.075, C.base, seg) // quadriceps
    b.ellipsoid([kn[0], kn[1], 0.035], [0.03, 0.034, 0.02], C.joint, 12) // patella
    b.ellipsoid(kn, [0.058, 0.055, 0.058], C.joint, seg)
    b.taper(kn, an, 0.054, 0.034, C.base, seg)
    b.along(lerp3(kn, an, 0.12), lerp3(kn, an, 0.55), 0.052, 0.058, C.base, seg) // calf
    b.ellipsoid([an[0] - s * 0.032, an[1] - 0.012, 0], [0.014, 0.017, 0.016], C.joint, 10) // medial malleolus
    b.ellipsoid([an[0] + s * 0.032, an[1] - 0.02, -0.004], [0.014, 0.017, 0.016], C.joint, 10) // lateral malleolus
    b.ellipsoid([an[0], 0.04, -0.035], [0.034, 0.04, 0.045], C.base, seg) // heel
    b.ellipsoid([an[0], 0.035, 0.055], [0.044, 0.03, 0.085], C.base, seg) // arch / midfoot
    for (const d of FINGERS) {
      const mtp = p(`mtp${d}_${side}`)
      const r = d === 1 ? 0.0135 : 0.0085 - d * 0.0004
      b.ellipsoid([mtp[0], 0.028, 0.135], [r + 0.004, 0.017, 0.022], C.base, 10)
      b.taper([mtp[0], 0.025, 0.15], [mtp[0], 0.018, d === 1 ? 0.19 : 0.178 - d * 0.003], r, r * 0.85, C.base, 10)
    }
  }

  return b.build()
}

// ---------------------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------------------

function buildBones(): THREE.BufferGeometry {
  const b = new GeometryBuilder()
  const B = BONE_COLORS

  // Skull
  b.ellipsoid([0, 1.732, -0.008], [0.072, 0.086, 0.088], B.base, 22)
  b.ellipsoid([0, 1.67, 0.035], [0.055, 0.045, 0.055], B.base, 16)
  b.ellipsoid([0, 1.632, 0.05], [0.04, 0.018, 0.035], B.base, 12) // mandible
  for (const side of SIDES) {
    const s = sign(side)
    b.ellipsoid([s * 0.03, 1.72, 0.07], [0.018, 0.016, 0.01], B.joint, 10) // orbit rims
  }

  // Spine: cervical → lumbar with gentle S-curve
  const vertebrae = 24
  for (let i = 0; i < vertebrae; i++) {
    const t = i / (vertebrae - 1)
    const y = 1.6 - t * 0.66
    const z = -0.035 - 0.022 * Math.sin(t * Math.PI * 1.2) + (t > 0.7 ? 0.02 * (t - 0.7) * 3 : 0)
    const r = 0.012 + t * 0.01
    b.ellipsoid([0, y, z], [r * 1.25, 0.009, r], B.base, 10)
    b.ellipsoid([0, y, z - r - 0.008], [0.004, 0.006, 0.01], B.joint, 6) // spinous process
  }
  b.along([0, 0.955, -0.06], [0, 0.885, -0.05], 0.035, 0.018, B.base, 12) // sacrum

  // Rib cage, sternum, clavicles, scapulae
  for (let i = 0; i < 10; i++) {
    const y = 1.41 - i * 0.027
    const w = 0.12 + Math.sin(((i + 1) / 11) * Math.PI) * 0.045
    const rib = new THREE.TorusGeometry(1, 0.055, 6, 36)
    rib.rotateX(Math.PI / 2 + 0.32) // ribs slope downward towards the front
    rib.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0.005 - i * 0.001), new THREE.Quaternion(), new THREE.Vector3(w, 0.11, 0.088 + i * 0.002)))
    b.custom(rib, B.base)
  }
  b.along([0, 1.43, 0.095], [0, 1.24, 0.1], 0.016, 0.006, B.base, 10)
  for (const side of SIDES) {
    const s = sign(side)
    b.taper([s * 0.02, 1.462, 0.06], [s * 0.18, 1.468, 0.01], 0.008, 0.009, B.base, 8)
    b.ellipsoid([s * 0.1, 1.36, -0.085], [0.06, 0.075, 0.01], B.base, 12)
  }

  // Pelvis
  for (const side of SIDES) {
    const s = sign(side)
    b.ellipsoid([s * 0.095, 0.975, -0.015], [0.07, 0.065, 0.03], B.base, 16) // ilium
    b.taper([s * 0.03, 0.865, 0.05], [s * 0.09, 0.905, 0.02], 0.012, 0.016, B.base, 8) // pubic ramus
    b.ellipsoid([s * 0.105, 0.925, 0.01], [0.03, 0.03, 0.03], B.joint, 12) // acetabulum
  }

  // Upper limbs
  for (const side of SIDES) {
    const s = sign(side)
    const sh = p(`shoulder_${side}`)
    const el = p(`elbow_${side}`)
    const wr = p(`wrist_${side}`)
    b.ellipsoid(sh, [0.024, 0.024, 0.024], B.joint, 12) // humeral head
    b.taper(sh, el, 0.011, 0.012, B.base, 10)
    b.ellipsoid(el, [0.024, 0.014, 0.014], B.joint, 10) // condyles
    b.taper([el[0] - s * 0.008, el[1], 0], [wr[0] - s * 0.012, wr[1], 0], 0.008, 0.007, B.base, 8) // ulna
    b.taper([el[0] + s * 0.008, el[1], 0], [wr[0] + s * 0.01, wr[1], 0], 0.0065, 0.0095, B.base, 8) // radius
    b.ellipsoid([wr[0] + s * 0.004, wr[1] - 0.016, 0], [0.024, 0.014, 0.008], B.joint, 10) // carpals
    for (const d of FINGERS) {
      const mcp = p(`mcp${d}_${side}`)
      const pip = p(`pip${d}_${side}`)
      const base: V3 = d === 1 ? [wr[0] + s * 0.028, wr[1] - 0.03, 0] : [wr[0] + (mcp[0] - wr[0]) * 0.45, wr[1] - 0.026, 0]
      b.taper(base, mcp, 0.0042, 0.0045, B.base, 8) // metacarpal
      b.ellipsoid(mcp, [0.0058, 0.0058, 0.0058], B.cartilage, 8)
      b.taper(mcp, pip, 0.0036, 0.0034, B.base, 8)
      b.ellipsoid(pip, [0.005, 0.005, 0.005], B.cartilage, 8)
      if (d === 1) {
        b.taper(pip, [pip[0], pip[1] - 0.026, 0], 0.003, 0.0026, B.base, 8)
      } else {
        const dip = p(`dip${d}_${side}`)
        b.taper(pip, dip, 0.0031, 0.0029, B.base, 8)
        b.ellipsoid(dip, [0.0042, 0.0042, 0.0042], B.cartilage, 8)
        b.taper(dip, [dip[0], dip[1] - 0.02, 0], 0.0026, 0.0022, B.base, 8)
      }
    }
  }

  // Lower limbs
  for (const side of SIDES) {
    const s = sign(side)
    const hip = p(`hip_${side}`, 0.01)
    const kn = p(`knee_${side}`)
    const an = p(`ankle_${side}`)
    b.ellipsoid(hip, [0.024, 0.024, 0.024], B.joint, 12) // femoral head
    b.taper([hip[0] + s * 0.03, hip[1] - 0.02, 0], [hip[0] + s * 0.012, hip[1] - 0.055, 0], 0.016, 0.014, B.base, 8) // neck / trochanter
    b.taper([hip[0] + s * 0.012, hip[1] - 0.05, 0], kn, 0.014, 0.016, B.base, 10) // femur
    b.ellipsoid([kn[0], kn[1] + 0.012, 0], [0.036, 0.018, 0.028], B.joint, 12) // femoral condyles
    b.ellipsoid([kn[0], kn[1] - 0.012, 0], [0.034, 0.012, 0.026], B.cartilage, 12) // tibial plateau
    b.ellipsoid([kn[0], kn[1], 0.038], [0.02, 0.024, 0.009], B.base, 10) // patella
    b.taper([kn[0], kn[1] - 0.02, 0], [an[0], an[1] + 0.01, 0], 0.016, 0.012, B.base, 10) // tibia
    b.taper([kn[0] + s * 0.03, kn[1] - 0.035, -0.008], [an[0] + s * 0.03, an[1] - 0.005, -0.004], 0.006, 0.0055, B.base, 8) // fibula
    b.ellipsoid([an[0], an[1] - 0.03, -0.01], [0.022, 0.018, 0.035], B.joint, 10) // talus / calcaneus
    b.ellipsoid([an[0], 0.032, -0.04], [0.02, 0.025, 0.03], B.base, 10)
    for (const d of FINGERS) {
      const mtp = p(`mtp${d}_${side}`)
      const r = d === 1 ? 0.0065 : 0.0045
      b.taper([an[0] + (mtp[0] - an[0]) * 0.4, 0.05, 0.03], [mtp[0], 0.03, 0.138], r * 0.9, r, B.base, 8) // metatarsal
      b.ellipsoid([mtp[0], 0.03, 0.142], [r + 0.0018, r + 0.0018, r + 0.0018], B.cartilage, 8)
      b.taper([mtp[0], 0.028, 0.146], [mtp[0], 0.02, d === 1 ? 0.186 : 0.172], r * 0.8, r * 0.65, B.base, 8)
    }
  }

  return b.build()
}

export interface Anatomy {
  skin: THREE.BufferGeometry
  bones: THREE.BufferGeometry
}

/** Build the anatomy. `detail` scales tessellation (0.75 for low-power devices, 1 default). */
export function buildAnatomy(detail = 1): Anatomy {
  return { skin: buildSkin(detail), bones: buildBones() }
}
