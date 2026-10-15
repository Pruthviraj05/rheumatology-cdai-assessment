/**
 * Assessment data model and derived clinical values.
 *
 * Three independent concepts are recorded per joint:
 *   • patient-reported pain      (+ optional 0–10 intensity; never part of the CDAI)
 *   • clinician-assessed tenderness
 *   • clinician-assessed swelling
 * "unknown" always means NOT examined — it is never silently treated as a negative finding.
 *
 * Counts are always derived from the recorded findings (never stored separately), so a joint
 * cannot be counted twice and a changed finding updates the count exactly once.
 */
import { CDAI_MAX_GLOBAL, classifyCdai, computeCdai, type CdaiCategory, type CdaiResult } from './cdai'
import { CDAI28_JOINTS, JOINTS, JOINT_BY_ID, isValidJointId } from './joints'

export type PainState = 'yes' | 'no' | 'unknown'
export type TenderState = 'tender' | 'not_tender' | 'unknown'
export type SwellState = 'swollen' | 'not_swollen' | 'unknown'
export type CountSource = 'joint-exam' | 'manual'

export interface JointFinding {
  pain: PainState
  /** Integer 0–10, only meaningful when pain === 'yes'. Not used in the CDAI. */
  painIntensity: number | null
  tenderness: TenderState
  swelling: SwellState
  /** Joint cannot be assessed (e.g. prosthesis, arthrodesis, amputation). Never counted. */
  notAssessable: boolean
  note: string
}

export const EMPTY_FINDING: Readonly<JointFinding> = Object.freeze({
  pain: 'unknown',
  painIntensity: null,
  tenderness: 'unknown',
  swelling: 'unknown',
  notAssessable: false,
  note: '',
})

export interface AssessmentData {
  countSource: CountSource
  manualCounts: { tjc28: number | null; sjc28: number | null }
  /** Sparse map: a joint with no entry has not been recorded at all. */
  joints: Readonly<Record<string, JointFinding>>
  globals: { ptga: number | null; prga: number | null }
  note: string
}

export function createEmptyAssessment(): AssessmentData {
  return {
    countSource: 'joint-exam',
    manualCounts: { tjc28: null, sjc28: null },
    joints: {},
    globals: { ptga: null, prga: null },
    note: '',
  }
}

export class AssessmentValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(issues.join(' '))
    this.name = 'AssessmentValidationError'
    this.issues = issues
  }
}

// ---------------------------------------------------------------------------------------
// Finding helpers
// ---------------------------------------------------------------------------------------

export function getFinding(data: AssessmentData, jointId: string): JointFinding {
  return data.joints[jointId] ?? EMPTY_FINDING
}

function isEmpty(f: JointFinding): boolean {
  return (
    f.pain === 'unknown' &&
    f.painIntensity === null &&
    f.tenderness === 'unknown' &&
    f.swelling === 'unknown' &&
    !f.notAssessable &&
    f.note === ''
  )
}

function normalise(f: JointFinding): JointFinding {
  const next = { ...f }
  if (next.pain !== 'yes') next.painIntensity = null
  if (next.notAssessable) {
    next.tenderness = 'unknown'
    next.swelling = 'unknown'
  }
  return next
}

export function findingIssues(f: JointFinding): string[] {
  const issues: string[] = []
  if (!['yes', 'no', 'unknown'].includes(f.pain)) issues.push(`Invalid pain value "${String(f.pain)}".`)
  if (!['tender', 'not_tender', 'unknown'].includes(f.tenderness)) issues.push(`Invalid tenderness value "${String(f.tenderness)}".`)
  if (!['swollen', 'not_swollen', 'unknown'].includes(f.swelling)) issues.push(`Invalid swelling value "${String(f.swelling)}".`)
  if (f.painIntensity !== null) {
    if (!Number.isInteger(f.painIntensity) || f.painIntensity < 0 || f.painIntensity > 10) {
      issues.push('Pain intensity must be a whole number from 0 to 10.')
    } else if (f.pain !== 'yes') {
      issues.push('Pain intensity can only be recorded when pain is reported.')
    }
  }
  if (typeof f.note !== 'string') issues.push('Note must be text.')
  if (f.notAssessable && (f.tenderness !== 'unknown' || f.swelling !== 'unknown')) {
    issues.push('A joint that cannot be assessed cannot have a tenderness or swelling finding.')
  }
  return issues
}

/** Apply a partial update to one joint. Returns a new AssessmentData; the input is untouched. */
export function updateJoint(data: AssessmentData, jointId: string, patch: Partial<JointFinding>): AssessmentData {
  if (!isValidJointId(jointId)) throw new AssessmentValidationError([`Unknown joint "${jointId}".`])
  const next = normalise({ ...getFinding(data, jointId), ...patch })
  const issues = findingIssues(next)
  if (issues.length) throw new AssessmentValidationError(issues)
  const joints = { ...data.joints }
  if (isEmpty(next)) delete joints[jointId]
  else joints[jointId] = next
  return { ...data, joints }
}

/** Record the listed joints as examined and normal (not tender, not swollen). Explicit clinician action. */
export function markNormal(data: AssessmentData, jointIds: readonly string[]): AssessmentData {
  let next = data
  for (const id of jointIds) {
    next = updateJoint(next, id, { tenderness: 'not_tender', swelling: 'not_swollen', notAssessable: false })
  }
  return next
}

/**
 * Bulk action: record the MISSING tenderness/swelling findings of the listed joints as negative.
 * Findings the clinician has already recorded (tender, swollen, or explicitly negative) are never
 * changed, and not-assessable joints are skipped.
 */
export function fillMissingAsNormal(data: AssessmentData, jointIds: readonly string[]): AssessmentData {
  let next = data
  for (const id of jointIds) {
    const f = getFinding(next, id)
    if (f.notAssessable) continue
    const patch: Partial<JointFinding> = {}
    if (f.tenderness === 'unknown') patch.tenderness = 'not_tender'
    if (f.swelling === 'unknown') patch.swelling = 'not_swollen'
    if (Object.keys(patch).length) next = updateJoint(next, id, patch)
  }
  return next
}

/** Reset tenderness/swelling/pain of a joint back to "not examined". */
export function clearJoint(data: AssessmentData, jointId: string): AssessmentData {
  if (!isValidJointId(jointId)) throw new AssessmentValidationError([`Unknown joint "${jointId}".`])
  const joints = { ...data.joints }
  delete joints[jointId]
  return { ...data, joints }
}

export type GlobalField = 'ptga' | 'prga'

export function setGlobal(data: AssessmentData, field: GlobalField, value: number | null): AssessmentData {
  if (value !== null) {
    const ok =
      Number.isFinite(value) && value >= 0 && value <= CDAI_MAX_GLOBAL && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
    if (!ok) throw new AssessmentValidationError([`Global assessment must be between 0 and ${CDAI_MAX_GLOBAL} in steps of 0.1.`])
  }
  return { ...data, globals: { ...data.globals, [field]: value } }
}

export function setManualCount(data: AssessmentData, field: 'tjc28' | 'sjc28', value: number | null): AssessmentData {
  if (value !== null && !(Number.isInteger(value) && value >= 0 && value <= 28)) {
    throw new AssessmentValidationError(['Joint counts must be whole numbers from 0 to 28.'])
  }
  return { ...data, manualCounts: { ...data.manualCounts, [field]: value } }
}

// ---------------------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------------------

export type JointExamState =
  | 'not-examined' // neither tenderness nor swelling recorded
  | 'partial' // only one of the two recorded
  | 'examined' // both recorded
  | 'not-assessable'

export function examState(f: JointFinding): JointExamState {
  if (f.notAssessable) return 'not-assessable'
  const t = f.tenderness !== 'unknown'
  const s = f.swelling !== 'unknown'
  if (t && s) return 'examined'
  if (t || s) return 'partial'
  return 'not-examined'
}

export interface JointCounts {
  cdai: {
    total: number
    tender: number
    swollen: number
    /** Joints with BOTH findings recorded, or marked not assessable. */
    resolved: number
    tendernessRecorded: number
    swellingRecorded: number
    notAssessable: number
    unresolvedIds: string[]
    missingTendernessIds: string[]
    missingSwellingIds: string[]
  }
  /** Joints outside the 28-joint set that carry a tender / swollen finding (never counted in CDAI). */
  other: { tender: number; swollen: number }
  all: { total: number; examined: number; partial: number; unexamined: number }
  painReported: number
}

export function countJoints(data: AssessmentData): JointCounts {
  let tender = 0
  let swollen = 0
  let tendernessRecorded = 0
  let swellingRecorded = 0
  let notAssessable = 0
  let resolved = 0
  const unresolvedIds: string[] = []
  const missingTendernessIds: string[] = []
  const missingSwellingIds: string[] = []

  for (const joint of CDAI28_JOINTS) {
    const f = getFinding(data, joint.id)
    if (f.notAssessable) {
      notAssessable += 1
      resolved += 1
      continue
    }
    if (f.tenderness === 'tender') tender += 1
    if (f.swelling === 'swollen') swollen += 1
    if (f.tenderness !== 'unknown') tendernessRecorded += 1
    else missingTendernessIds.push(joint.id)
    if (f.swelling !== 'unknown') swellingRecorded += 1
    else missingSwellingIds.push(joint.id)
    if (f.tenderness !== 'unknown' && f.swelling !== 'unknown') resolved += 1
    else unresolvedIds.push(joint.id)
  }

  let otherTender = 0
  let otherSwollen = 0
  let examined = 0
  let partial = 0
  let painReported = 0
  for (const joint of JOINTS) {
    const f = getFinding(data, joint.id)
    const state = examState(f)
    if (state === 'examined' || state === 'not-assessable') examined += 1
    else if (state === 'partial') partial += 1
    if (f.pain === 'yes') painReported += 1
    if (!joint.cdai28 && !f.notAssessable) {
      if (f.tenderness === 'tender') otherTender += 1
      if (f.swelling === 'swollen') otherSwollen += 1
    }
  }

  return {
    cdai: {
      total: CDAI28_JOINTS.length,
      tender,
      swollen,
      resolved,
      tendernessRecorded,
      swellingRecorded,
      notAssessable,
      unresolvedIds,
      missingTendernessIds,
      missingSwellingIds,
    },
    other: { tender: otherTender, swollen: otherSwollen },
    all: { total: JOINTS.length, examined, partial, unexamined: JOINTS.length - examined - partial },
    painReported,
  }
}

// ---------------------------------------------------------------------------------------
// Evaluation (counts + completeness + CDAI)
// ---------------------------------------------------------------------------------------

export interface AssessmentResult {
  status: 'complete' | 'incomplete' | 'invalid'
  /** Present only when the assessment is complete — never a provisional value. */
  score: number | null
  category: CdaiCategory | null
  tjc28: number | null
  sjc28: number | null
  ptga: number | null
  prga: number | null
  countSource: CountSource
  /** What is still missing, in plain language. Empty when complete. */
  problems: string[]
  /** Sum of the components known so far. NOT a CDAI; label it as such. */
  partialSum: number
  cdai: CdaiResult
  counts: JointCounts
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function evaluate(data: AssessmentData): AssessmentResult {
  const counts = countJoints(data)
  const manual = data.countSource === 'manual'

  const tjc28 = manual ? data.manualCounts.tjc28 : counts.cdai.tender
  const sjc28 = manual ? data.manualCounts.sjc28 : counts.cdai.swollen
  const { ptga, prga } = data.globals

  const cdai = computeCdai({ tjc28, sjc28, ptga, prga })
  const problems: string[] = []

  if (!manual) {
    const c = counts.cdai
    if (c.unresolvedIds.length > 0) {
      const parts: string[] = []
      if (c.missingTendernessIds.length) parts.push(`tenderness for ${plural(c.missingTendernessIds.length, 'joint')}`)
      if (c.missingSwellingIds.length) parts.push(`swelling for ${plural(c.missingSwellingIds.length, 'joint')}`)
      problems.push(`Still to record: ${parts.join(' and ')} in the 28-joint set.`)
    }
  }
  if (cdai.status !== 'complete') {
    for (const issue of cdai.issues) {
      // Joint-derived counts are always valid numbers; only manual counts and globals can be missing.
      problems.push(issue.message)
    }
  }

  const jointExamIncomplete = !manual && counts.cdai.unresolvedIds.length > 0
  const status: AssessmentResult['status'] =
    cdai.status === 'invalid' ? 'invalid' : jointExamIncomplete || cdai.status === 'incomplete' ? 'incomplete' : 'complete'

  const partialSum =
    (typeof tjc28 === 'number' ? tjc28 : 0) +
    (typeof sjc28 === 'number' ? sjc28 : 0) +
    (typeof ptga === 'number' ? ptga : 0) +
    (typeof prga === 'number' ? prga : 0)

  const finalScore = status === 'complete' && cdai.status === 'complete' ? cdai.score : null
  return {
    status,
    score: finalScore,
    category: finalScore === null ? null : classifyCdai(finalScore),
    tjc28,
    sjc28,
    ptga,
    prga,
    countSource: data.countSource,
    problems,
    partialSum: Math.round(partialSum * 10) / 10,
    cdai,
    counts,
  }
}

// ---------------------------------------------------------------------------------------
// Serialisable payload (what the backend stores) with strict validation
// ---------------------------------------------------------------------------------------

export const PAYLOAD_SCHEMA_VERSION = 1

export interface FindingRecord extends JointFinding {
  jointId: string
}

export interface AssessmentPayload {
  schemaVersion: number
  countSource: CountSource
  manualCounts: { tjc28: number | null; sjc28: number | null }
  globals: { ptga: number | null; prga: number | null }
  note: string
  findings: FindingRecord[]
}

export function toPayload(data: AssessmentData): AssessmentPayload {
  const findings = Object.keys(data.joints)
    .filter((id) => JOINT_BY_ID[id])
    .sort((a, b) => JOINT_BY_ID[a].order - JOINT_BY_ID[b].order)
    .map((jointId) => ({ jointId, ...data.joints[jointId] }))
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    countSource: data.countSource,
    manualCounts: { ...data.manualCounts },
    globals: { ...data.globals },
    note: data.note,
    findings,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function numOrNull(v: unknown): number | null | typeof BAD {
  if (v === null || v === undefined) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : BAD
}
const BAD = Symbol('bad')

/** Validate untrusted input (API payload / stored JSON). Throws AssessmentValidationError with every problem found. */
export function fromPayload(raw: unknown): AssessmentData {
  const issues: string[] = []
  if (!isObj(raw)) throw new AssessmentValidationError(['Assessment payload must be an object.'])
  if (raw.schemaVersion !== PAYLOAD_SCHEMA_VERSION) issues.push(`Unsupported schema version "${String(raw.schemaVersion)}".`)

  const countSource = raw.countSource
  if (countSource !== 'joint-exam' && countSource !== 'manual') issues.push('Count source must be "joint-exam" or "manual".')

  const manual = isObj(raw.manualCounts) ? raw.manualCounts : {}
  const globals = isObj(raw.globals) ? raw.globals : {}
  const readNum = (v: unknown, label: string): number | null => {
    const n = numOrNull(v)
    if (n === BAD) {
      issues.push(`${label} must be a number or empty.`)
      return null
    }
    return n as number | null
  }

  let data: AssessmentData = {
    countSource: countSource === 'manual' ? 'manual' : 'joint-exam',
    manualCounts: { tjc28: null, sjc28: null },
    joints: {},
    globals: { ptga: null, prga: null },
    note: typeof raw.note === 'string' ? raw.note : '',
  }

  const attempt = (fn: () => AssessmentData) => {
    try {
      data = fn()
    } catch (e) {
      if (e instanceof AssessmentValidationError) issues.push(...e.issues)
      else throw e
    }
  }

  const tjc = readNum(manual.tjc28, 'Manual tender joint count')
  const sjc = readNum(manual.sjc28, 'Manual swollen joint count')
  const ptga = readNum(globals.ptga, 'Patient global assessment')
  const prga = readNum(globals.prga, 'Physician global assessment')
  attempt(() => setManualCount(data, 'tjc28', tjc))
  attempt(() => setManualCount(data, 'sjc28', sjc))
  attempt(() => setGlobal(data, 'ptga', ptga))
  attempt(() => setGlobal(data, 'prga', prga))

  if (!Array.isArray(raw.findings)) {
    issues.push('Findings must be a list.')
  } else {
    const seen = new Set<string>()
    for (const item of raw.findings) {
      if (!isObj(item) || typeof item.jointId !== 'string') {
        issues.push('Every finding needs a joint ID.')
        continue
      }
      const id = item.jointId
      if (!isValidJointId(id)) {
        issues.push(`Unknown joint ID "${id}".`)
        continue
      }
      if (seen.has(id)) {
        issues.push(`Duplicate finding for joint "${id}".`)
        continue
      }
      seen.add(id)
      const finding: JointFinding = {
        pain: item.pain as PainState,
        painIntensity: (item.painIntensity ?? null) as number | null,
        tenderness: item.tenderness as TenderState,
        swelling: item.swelling as SwellState,
        notAssessable: item.notAssessable === true,
        note: typeof item.note === 'string' ? item.note : '',
      }
      const fi = findingIssues(finding)
      if (fi.length) issues.push(...fi.map((m) => `${id}: ${m}`))
      else if (!isEmpty(finding)) data = { ...data, joints: { ...data.joints, [id]: finding } }
    }
  }

  if (issues.length) throw new AssessmentValidationError(issues)
  return data
}
