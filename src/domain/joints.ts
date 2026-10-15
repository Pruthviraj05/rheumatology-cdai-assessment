/**
 * Canonical joint registry — the single source of truth for every joint in the module.
 *
 * The 3D scene, the 2D chart, the examination list, the counting logic and the report all
 * read from here. Joint IDs are stable, anatomical and independent of any mesh or asset:
 * replacing the 3D model never requires touching the clinical logic.
 *
 * CDAI 28-joint set (bilateral): shoulders 2, elbows 2, wrists 2, MCP 1–5 10, PIP 1–5 10
 * (the thumb interphalangeal joint is counted as "PIP 1"), knees 2 = 28.
 * Everything else (TMJ, spine, hips, ankles, DIP, MTP) is available for the pain map and
 * for documentation but never contributes to TJC28 / SJC28.
 */

export type Side = 'L' | 'R' | 'C'
export type View = 'front' | 'back'

export type JointGroup =
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'mcp'
  | 'pip'
  | 'knee'
  | 'tmj'
  | 'spine'
  | 'hip'
  | 'ankle'
  | 'dip'
  | 'mtp'

export type Panel2D = 'body' | 'handR' | 'handL' | 'footR' | 'footL'

export interface JointDef {
  /** Stable anatomical identifier, e.g. `wrist_r`, `mcp2_l`. Never changes. */
  readonly id: string
  readonly name: string
  readonly shortName: string
  readonly group: JointGroup
  readonly side: Side
  /** Digit number 1–5 for MCP / PIP / DIP / MTP joints. */
  readonly digit?: 1 | 2 | 3 | 4 | 5
  /** Part of the 28-joint count used by TJC28 / SJC28. */
  readonly cdai28: boolean
  /** Anchor in model space (metres, patient faces +z, patient's left is +x). */
  readonly position: readonly [number, number, number]
  /** Which body view shows this joint on the 2D body panel (hand/foot panels are separate). */
  readonly bodyView: View | 'both'
  readonly map2d: { readonly panel: Panel2D; readonly x: number; readonly y: number }
  /** Position in the standard examination sequence. */
  readonly order: number
}

const SIDE_SIGN = { R: -1, L: 1, C: 0 } as const
const SIDE_NAME = { R: 'Right', L: 'Left', C: '' } as const

export const DIGIT_NAMES = { 1: 'thumb', 2: 'index', 3: 'middle', 4: 'ring', 5: 'little' } as const

/** Hand-local geometry (metres): u = lateral offset (outward positive), v = distance below wrist crease. */
const HAND_GEOMETRY = {
  1: { u: 0.062, mcp: 0.085, pip: 0.138 },
  2: { u: 0.034, mcp: 0.098, pip: 0.152, dip: 0.187 },
  3: { u: 0.009, mcp: 0.102, pip: 0.162, dip: 0.2 },
  4: { u: -0.017, mcp: 0.095, pip: 0.15, dip: 0.186 },
  5: { u: -0.04, mcp: 0.084, pip: 0.13, dip: 0.16 },
} as const

/** Toe positions: medial offset (metres) from the foot midline. */
const MTP_MEDIAL_OFFSET = { 1: 0.032, 2: 0.016, 3: 0, 4: -0.016, 5: -0.032 } as const

export const WRIST_X = 0.385
export const WRIST_Y = 0.87
const HAND_2D_SCALE_Y = 800
const HAND_2D_SCALE_X = 1150
const BODY_2D = { cx: 150, kx: 260, top: 28, ky: 330, yMax: 1.82 }

export function bodyPanelPoint(x: number, y: number, view: View): { x: number; y: number } {
  const sign = view === 'front' ? 1 : -1
  return { x: BODY_2D.cx + x * BODY_2D.kx * sign, y: BODY_2D.top + (BODY_2D.yMax - y) * BODY_2D.ky }
}

const round = (n: number) => Math.round(n * 1000) / 1000
const r1 = (n: number) => Math.round(n * 10) / 10

interface BuildCtx {
  list: JointDef[]
}

function add(ctx: BuildCtx, def: Omit<JointDef, 'order' | 'map2d'> & { map2d?: JointDef['map2d'] }) {
  const [x, y] = def.position
  const map2d = def.map2d ?? { panel: 'body' as const, ...bodyPanelPoint(x, y, def.bodyView === 'back' ? 'back' : 'front') }
  ctx.list.push({ ...def, map2d: { ...map2d, x: r1(map2d.x), y: r1(map2d.y) }, order: ctx.list.length + 1 })
}

function build(): JointDef[] {
  const ctx: BuildCtx = { list: [] }
  const sides = ['R', 'L'] as const

  const large = (
    group: 'shoulder' | 'elbow' | 'wrist' | 'knee',
    label: string,
    pos: (s: number) => [number, number, number],
  ) => {
    for (const side of sides) {
      const s = SIDE_SIGN[side]
      add(ctx, {
        id: `${group}_${side.toLowerCase()}`,
        name: `${SIDE_NAME[side]} ${label}`,
        shortName: label[0].toUpperCase() + label.slice(1),
        group,
        side,
        cdai28: true,
        position: pos(s),
        bodyView: 'both',
        // Wrists are charted on the hand panels so a hand is examined as one unit.
        map2d: group === 'wrist' ? { panel: side === 'R' ? 'handR' : 'handL', x: 100, y: 14 } : undefined,
      })
    }
  }

  // --- CDAI 28-joint set, in examination order -------------------------------------------
  large('shoulder', 'shoulder', (s) => [s * 0.2, 1.45, 0.05])
  large('elbow', 'elbow', (s) => [s * 0.3, 1.15, 0.03])
  large('wrist', 'wrist', (s) => [s * WRIST_X, WRIST_Y, 0.03])

  for (const group of ['mcp', 'pip'] as const) {
    for (const side of sides) {
      const s = SIDE_SIGN[side]
      for (const digit of [1, 2, 3, 4, 5] as const) {
        const g = HAND_GEOMETRY[digit]
        const v = group === 'mcp' ? g.mcp : g.pip
        const isThumbIp = group === 'pip' && digit === 1
        add(ctx, {
          id: `${group}${digit}_${side.toLowerCase()}`,
          name: isThumbIp
            ? `${SIDE_NAME[side]} thumb IP (counted as PIP 1)`
            : `${SIDE_NAME[side]} ${group.toUpperCase()} ${digit} (${DIGIT_NAMES[digit]})`,
          shortName: isThumbIp ? 'Thumb IP (PIP 1)' : `${group.toUpperCase()} ${digit} · ${DIGIT_NAMES[digit]}`,
          group,
          side,
          digit,
          cdai28: true,
          position: [round(s * WRIST_X + s * g.u), round(WRIST_Y - v), 0],
          bodyView: 'both',
          map2d: { panel: side === 'R' ? 'handR' : 'handL', x: 100 + s * g.u * HAND_2D_SCALE_X, y: 28 + v * HAND_2D_SCALE_Y },
        })
      }
    }
  }

  large('knee', 'knee', (s) => [s * 0.115, 0.5, 0.05])

  // --- Pain-map / documentation joints (never counted in CDAI28) --------------------------
  for (const side of sides) {
    const s = SIDE_SIGN[side]
    add(ctx, {
      id: `tmj_${side.toLowerCase()}`,
      name: `${SIDE_NAME[side]} temporomandibular joint`,
      shortName: 'TMJ',
      group: 'tmj',
      side,
      cdai28: false,
      position: [s * 0.1, 1.67, 0],
      bodyView: 'front',
    })
  }
  add(ctx, {
    id: 'cervical_spine',
    name: 'Cervical spine',
    shortName: 'Cervical spine',
    group: 'spine',
    side: 'C',
    cdai28: false,
    position: [0, 1.57, -0.045],
    bodyView: 'back',
  })
  add(ctx, {
    id: 'lumbar_spine',
    name: 'Lumbar spine',
    shortName: 'Lumbar spine',
    group: 'spine',
    side: 'C',
    cdai28: false,
    position: [0, 1.06, -0.1],
    bodyView: 'back',
  })
  for (const side of sides) {
    const s = SIDE_SIGN[side]
    add(ctx, {
      id: `hip_${side.toLowerCase()}`,
      name: `${SIDE_NAME[side]} hip`,
      shortName: 'Hip',
      group: 'hip',
      side,
      cdai28: false,
      position: [s * 0.11, 0.93, 0.09],
      bodyView: 'both',
    })
  }
  for (const side of sides) {
    const s = SIDE_SIGN[side]
    add(ctx, {
      id: `ankle_${side.toLowerCase()}`,
      name: `${SIDE_NAME[side]} ankle`,
      shortName: 'Ankle',
      group: 'ankle',
      side,
      cdai28: false,
      position: [s * 0.11, 0.1, 0.04],
      bodyView: 'both',
      // The ankle is charted on the foot panel so a foot is examined as one unit.
      map2d: { panel: side === 'R' ? 'footR' : 'footL', x: 80, y: 168 },
    })
  }
  for (const side of sides) {
    const s = SIDE_SIGN[side]
    for (const digit of [2, 3, 4, 5] as const) {
      const g = HAND_GEOMETRY[digit]
      add(ctx, {
        id: `dip${digit}_${side.toLowerCase()}`,
        name: `${SIDE_NAME[side]} DIP ${digit} (${DIGIT_NAMES[digit]})`,
        shortName: `DIP ${digit} · ${DIGIT_NAMES[digit]}`,
        group: 'dip',
        side,
        digit,
        cdai28: false,
        position: [round(s * WRIST_X + s * g.u), round(WRIST_Y - g.dip), 0],
        bodyView: 'both',
        map2d: { panel: side === 'R' ? 'handR' : 'handL', x: 100 + s * g.u * HAND_2D_SCALE_X, y: 28 + g.dip * HAND_2D_SCALE_Y },
      })
    }
  }
  for (const side of sides) {
    const s = SIDE_SIGN[side]
    for (const digit of [1, 2, 3, 4, 5] as const) {
      const med = MTP_MEDIAL_OFFSET[digit]
      add(ctx, {
        id: `mtp${digit}_${side.toLowerCase()}`,
        name: `${SIDE_NAME[side]} MTP ${digit}`,
        shortName: `MTP ${digit}`,
        group: 'mtp',
        side,
        digit,
        cdai28: false,
        position: [round(s * (0.11 - med)), 0.035, 0.15],
        bodyView: 'both',
        map2d: { panel: side === 'R' ? 'footR' : 'footL', x: 80 - s * med * 1500, y: 62 },
      })
    }
  }

  return ctx.list
}

export const JOINTS: readonly JointDef[] = Object.freeze(build())
export const JOINT_BY_ID: Readonly<Record<string, JointDef>> = Object.freeze(
  Object.fromEntries(JOINTS.map((j) => [j.id, j])),
)
export const CDAI28_JOINTS: readonly JointDef[] = JOINTS.filter((j) => j.cdai28)
export const PAIN_MAP_ONLY_JOINTS: readonly JointDef[] = JOINTS.filter((j) => !j.cdai28)

export function isValidJointId(id: unknown): id is string {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(JOINT_BY_ID, id)
}

// ---------------------------------------------------------------------------------------
// Navigation groups used by the examination list
// ---------------------------------------------------------------------------------------

export interface JointGroupDef {
  id: string
  label: string
  cdai28: boolean
  groups: JointGroup[]
  /** Optional restriction to a side. */
  jointIds: string[]
}

function idsFor(groups: JointGroup[], filter?: (j: JointDef) => boolean): string[] {
  return JOINTS.filter((j) => groups.includes(j.group) && (!filter || filter(j))).map((j) => j.id)
}

export const NAV_GROUPS: readonly JointGroupDef[] = [
  { id: 'shoulders', label: 'Shoulders', cdai28: true, groups: ['shoulder'], jointIds: idsFor(['shoulder']) },
  { id: 'elbows', label: 'Elbows', cdai28: true, groups: ['elbow'], jointIds: idsFor(['elbow']) },
  { id: 'wrists', label: 'Wrists', cdai28: true, groups: ['wrist'], jointIds: idsFor(['wrist']) },
  { id: 'mcp-r', label: 'Right hand · MCP 1–5', cdai28: true, groups: ['mcp'], jointIds: idsFor(['mcp'], (j) => j.side === 'R') },
  { id: 'mcp-l', label: 'Left hand · MCP 1–5', cdai28: true, groups: ['mcp'], jointIds: idsFor(['mcp'], (j) => j.side === 'L') },
  { id: 'pip-r', label: 'Right hand · PIP 1–5', cdai28: true, groups: ['pip'], jointIds: idsFor(['pip'], (j) => j.side === 'R') },
  { id: 'pip-l', label: 'Left hand · PIP 1–5', cdai28: true, groups: ['pip'], jointIds: idsFor(['pip'], (j) => j.side === 'L') },
  { id: 'knees', label: 'Knees', cdai28: true, groups: ['knee'], jointIds: idsFor(['knee']) },
  { id: 'head-spine', label: 'TMJ & spine', cdai28: false, groups: ['tmj', 'spine'], jointIds: idsFor(['tmj', 'spine']) },
  { id: 'hips', label: 'Hips', cdai28: false, groups: ['hip'], jointIds: idsFor(['hip']) },
  { id: 'ankles', label: 'Ankles', cdai28: false, groups: ['ankle'], jointIds: idsFor(['ankle']) },
  { id: 'dip', label: 'DIP joints', cdai28: false, groups: ['dip'], jointIds: idsFor(['dip']) },
  { id: 'mtp', label: 'Forefoot · MTP 1–5', cdai28: false, groups: ['mtp'], jointIds: idsFor(['mtp']) },
]

// ---------------------------------------------------------------------------------------
// Camera focus regions (plain data — the 3D layer interprets them)
// ---------------------------------------------------------------------------------------

export type RegionId =
  | 'full'
  | 'head-neck'
  | 'upper-limbs'
  | 'hand-r'
  | 'hand-l'
  | 'trunk-spine'
  | 'hips-knees'
  | 'foot-r'
  | 'foot-l'

export interface RegionDef {
  id: RegionId
  label: string
  target: readonly [number, number, number]
  distance: number
  view: View | 'left' | 'right'
  /** Joint to select when the clinician jumps to the region (first in sequence). */
  firstJointId?: string
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'full', label: 'Full body', target: [0, 0.95, 0], distance: 3.7, view: 'front' },
  { id: 'head-neck', label: 'Head & neck', target: [0, 1.62, 0], distance: 1.15, view: 'front', firstJointId: 'tmj_r' },
  { id: 'upper-limbs', label: 'Shoulders & elbows', target: [0, 1.2, 0], distance: 2.2, view: 'front', firstJointId: 'shoulder_r' },
  { id: 'hand-r', label: 'Right hand', target: [-0.4, 0.76, 0], distance: 0.62, view: 'front', firstJointId: 'wrist_r' },
  { id: 'hand-l', label: 'Left hand', target: [0.4, 0.76, 0], distance: 0.62, view: 'front', firstJointId: 'wrist_l' },
  { id: 'trunk-spine', label: 'Spine', target: [0, 1.25, 0], distance: 1.6, view: 'back', firstJointId: 'cervical_spine' },
  { id: 'hips-knees', label: 'Hips & knees', target: [0, 0.68, 0], distance: 2.0, view: 'front', firstJointId: 'hip_r' },
  { id: 'foot-r', label: 'Right foot', target: [-0.11, 0.07, 0.08], distance: 0.75, view: 'front', firstJointId: 'ankle_r' },
  { id: 'foot-l', label: 'Left foot', target: [0.11, 0.07, 0.08], distance: 0.75, view: 'front', firstJointId: 'ankle_l' },
]
