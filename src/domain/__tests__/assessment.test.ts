import { describe, expect, it } from 'vitest'
import {
  AssessmentValidationError,
  clearJoint,
  countJoints,
  createEmptyAssessment,
  evaluate,
  fillMissingAsNormal,
  fromPayload,
  markNormal,
  setGlobal,
  setManualCount,
  toPayload,
  updateJoint,
  type AssessmentData,
} from '../assessment'
import { CDAI28_JOINTS } from '../joints'

const all28 = CDAI28_JOINTS.map((j) => j.id)

describe('independent findings', () => {
  it('pain does not make a joint tender or swollen', () => {
    const d = updateJoint(createEmptyAssessment(), 'wrist_r', { pain: 'yes', painIntensity: 7 })
    const c = countJoints(d)
    expect(c.cdai.tender).toBe(0)
    expect(c.cdai.swollen).toBe(0)
    expect(c.painReported).toBe(1)
  })

  it('tenderness and swelling are independent', () => {
    let d = updateJoint(createEmptyAssessment(), 'knee_l', { tenderness: 'tender' })
    expect(countJoints(d).cdai).toMatchObject({ tender: 1, swollen: 0 })
    d = updateJoint(d, 'knee_l', { swelling: 'swollen' })
    expect(countJoints(d).cdai).toMatchObject({ tender: 1, swollen: 1 })
    d = updateJoint(d, 'knee_l', { tenderness: 'not_tender' })
    expect(countJoints(d).cdai).toMatchObject({ tender: 0, swollen: 1 })
  })

  it('a joint can be painful by report but not tender on examination', () => {
    const d = updateJoint(createEmptyAssessment(), 'elbow_r', { pain: 'yes', tenderness: 'not_tender', swelling: 'not_swollen' })
    expect(countJoints(d).painReported).toBe(1)
    expect(countJoints(d).cdai.tender).toBe(0)
  })

  it('pain intensity is cleared unless pain is reported and is bounded 0–10', () => {
    let d = updateJoint(createEmptyAssessment(), 'hip_l', { pain: 'yes', painIntensity: 4 })
    expect(d.joints.hip_l.painIntensity).toBe(4)
    d = updateJoint(d, 'hip_l', { pain: 'no' })
    expect(d.joints.hip_l.painIntensity).toBeNull()
    expect(() => updateJoint(d, 'hip_l', { pain: 'yes', painIntensity: 11 })).toThrow(AssessmentValidationError)
    expect(() => updateJoint(d, 'hip_l', { pain: 'yes', painIntensity: 2.5 })).toThrow(AssessmentValidationError)
  })

  it('rejects unknown joint IDs', () => {
    expect(() => updateJoint(createEmptyAssessment(), 'elbow_x', { pain: 'yes' })).toThrow(AssessmentValidationError)
  })
})

describe('counting', () => {
  it('unexamined joints are not negative findings', () => {
    const c = countJoints(createEmptyAssessment())
    expect(c.cdai.resolved).toBe(0)
    expect(c.cdai.unresolvedIds).toHaveLength(28)
    expect(c.all.unexamined).toBe(c.all.total)
    expect(evaluate(createEmptyAssessment()).status).toBe('incomplete')
  })

  it('feet, ankles, hips, DIP never contribute to TJC28/SJC28', () => {
    let d = createEmptyAssessment()
    for (const id of ['ankle_r', 'ankle_l', 'mtp1_r', 'mtp5_l', 'hip_l', 'dip2_r', 'tmj_l', 'cervical_spine']) {
      d = updateJoint(d, id, { tenderness: 'tender', swelling: 'swollen' })
    }
    const c = countJoints(d)
    expect(c.cdai.tender).toBe(0)
    expect(c.cdai.swollen).toBe(0)
    expect(c.other).toEqual({ tender: 8, swollen: 8 })
  })

  it('a joint is never counted twice and a change updates the count exactly once', () => {
    let d = createEmptyAssessment()
    for (let i = 0; i < 5; i++) d = updateJoint(d, 'wrist_r', { tenderness: 'tender' })
    expect(countJoints(d).cdai.tender).toBe(1)
    d = updateJoint(d, 'wrist_l', { tenderness: 'tender' })
    expect(countJoints(d).cdai.tender).toBe(2)
    d = updateJoint(d, 'wrist_r', { tenderness: 'not_tender' })
    expect(countJoints(d).cdai.tender).toBe(1)
    d = clearJoint(d, 'wrist_l')
    expect(countJoints(d).cdai.tender).toBe(0)
  })

  it('not-assessable joints resolve completeness but are never counted', () => {
    let d = markNormal(createEmptyAssessment(), all28.slice(1))
    expect(evaluate(d).counts.cdai.unresolvedIds).toEqual([all28[0]])
    d = updateJoint(d, all28[0], { notAssessable: true })
    const c = countJoints(d)
    expect(c.cdai.unresolvedIds).toHaveLength(0)
    expect(c.cdai.notAssessable).toBe(1)
    expect(c.cdai.tender).toBe(0)
  })

  it('does not mutate previous state', () => {
    const a = createEmptyAssessment()
    const b = updateJoint(a, 'wrist_r', { tenderness: 'tender' })
    expect(a.joints).toEqual({})
    expect(b.joints.wrist_r.tenderness).toBe('tender')
  })
})

describe('bulk fill', () => {
  it('only fills missing findings and never overwrites recorded ones', () => {
    let d = updateJoint(createEmptyAssessment(), 'knee_l', { tenderness: 'tender' }) // swelling missing
    d = updateJoint(d, 'wrist_r', { swelling: 'swollen' }) // tenderness missing
    d = updateJoint(d, 'elbow_r', { notAssessable: true })
    const filled = fillMissingAsNormal(d, all28)
    expect(filled.joints.knee_l).toMatchObject({ tenderness: 'tender', swelling: 'not_swollen' })
    expect(filled.joints.wrist_r).toMatchObject({ tenderness: 'not_tender', swelling: 'swollen' })
    expect(filled.joints.elbow_r).toMatchObject({ notAssessable: true, tenderness: 'unknown' })
    const c = countJoints(filled).cdai
    expect(c).toMatchObject({ tender: 1, swollen: 1, unresolvedIds: [] })
  })
})

describe('evaluate', () => {
  function examined(tender: string[], swollen: string[]) {
    let d = markNormal(createEmptyAssessment(), all28)
    for (const id of tender) d = updateJoint(d, id, { tenderness: 'tender' })
    for (const id of swollen) d = updateJoint(d, id, { swelling: 'swollen' })
    return d
  }

  it('worked example: TJC 6, SJC 4, PtGA 5, PrGA 3 → 18 moderate', () => {
    let d = examined(all28.slice(0, 6), all28.slice(2, 6))
    d = setGlobal(setGlobal(d, 'ptga', 5), 'prga', 3)
    expect(evaluate(d)).toMatchObject({
      status: 'complete',
      tjc28: 6,
      sjc28: 4,
      ptga: 5,
      prga: 3,
      score: 18,
      category: 'moderate',
    })
  })

  it('stays incomplete (no score) until globals are entered', () => {
    const r = evaluate(examined(all28.slice(0, 2), []))
    expect(r.status).toBe('incomplete')
    expect(r.score).toBeNull()
    expect(r.category).toBeNull()
    expect(r.problems.join(' ')).toMatch(/Patient global/)
    expect(r.problems.join(' ')).toMatch(/Physician global/)
  })

  it('stays incomplete while any of the 28 joints is unexamined, even with globals', () => {
    let d = markNormal(createEmptyAssessment(), all28.slice(0, 27))
    d = setGlobal(setGlobal(d, 'ptga', 0), 'prga', 0)
    const r = evaluate(d)
    expect(r.status).toBe('incomplete')
    expect(r.score).toBeNull()
  })

  it('manual counts mode matches MDCalc inputs', () => {
    let d: AssessmentData = { ...createEmptyAssessment(), countSource: 'manual' }
    d = setManualCount(setManualCount(d, 'tjc28', 6), 'sjc28', 4)
    d = setGlobal(setGlobal(d, 'ptga', 5), 'prga', 3)
    expect(evaluate(d)).toMatchObject({ status: 'complete', score: 18, category: 'moderate' })
    expect(() => setManualCount(d, 'tjc28', 29)).toThrow(AssessmentValidationError)
    expect(() => setManualCount(d, 'tjc28', -1)).toThrow(AssessmentValidationError)
    expect(() => setManualCount(d, 'tjc28', 1.5)).toThrow(AssessmentValidationError)
    expect(() => setGlobal(d, 'ptga', 10.5)).toThrow(AssessmentValidationError)
  })
})

describe('payload validation', () => {
  it('round-trips findings, globals and counts exactly', () => {
    let d = markNormal(createEmptyAssessment(), all28)
    d = updateJoint(d, 'wrist_r', { tenderness: 'tender', swelling: 'swollen', pain: 'yes', painIntensity: 6, note: 'warm' })
    d = setGlobal(setGlobal(d, 'ptga', 4.5), 'prga', 2)
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(d))))
    expect(back).toEqual(d)
    expect(evaluate(back)).toEqual(evaluate(d))
  })

  it('rejects duplicate and invalid joint IDs', () => {
    const base = toPayload(createEmptyAssessment())
    const f = { pain: 'yes', painIntensity: null, tenderness: 'tender', swelling: 'unknown', notAssessable: false, note: '' }
    expect(() => fromPayload({ ...base, findings: [{ jointId: 'wrist_r', ...f }, { jointId: 'wrist_r', ...f }] })).toThrow(
      /Duplicate/,
    )
    expect(() => fromPayload({ ...base, findings: [{ jointId: 'nope', ...f }] })).toThrow(/Unknown joint/)
    expect(() => fromPayload({ ...base, globals: { ptga: 11, prga: null } })).toThrow(AssessmentValidationError)
    expect(() => fromPayload({ ...base, manualCounts: { tjc28: -2, sjc28: null } })).toThrow(AssessmentValidationError)
    expect(() => fromPayload(null)).toThrow(AssessmentValidationError)
  })
})
