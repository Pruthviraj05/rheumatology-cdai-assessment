import { describe, expect, it } from 'vitest'
import { createEmptyAssessment, evaluate, fromPayload, markNormal, setGlobal, toPayload, updateJoint } from '../assessment'
import { CDAI28_JOINTS } from '../joints'
import { applySave, resultOf, type SaveRequest } from '../records'
import { LocalStorageAssessmentRepository, MemoryAssessmentRepository } from '../../persistence/repository'

const clinician = { id: 'dr-1', name: 'Dr Demo' }
const all28 = CDAI28_JOINTS.map((j) => j.id)

function completeData() {
  let d = markNormal(createEmptyAssessment(), all28)
  d = updateJoint(d, 'wrist_r', { tenderness: 'tender', swelling: 'swollen' })
  return setGlobal(setGlobal(d, 'ptga', 5), 'prga', 3)
}

const req = (over: Partial<SaveRequest> = {}): SaveRequest => ({
  intent: 'draft',
  patientId: 'P1',
  consultationId: 'C1',
  consultationDate: '2026-10-16',
  clinician,
  payload: toPayload(completeData()),
  expectedRevision: 0,
  ...over,
})

describe('applySave lifecycle', () => {
  it('creates a draft at revision 1', () => {
    expect(applySave(null, req())).toMatchObject({ status: 'draft', revision: 1, finalizedAt: null })
  })

  it('refuses to finalize an incomplete assessment', () => {
    const payload = toPayload(createEmptyAssessment())
    expect(() => applySave(null, req({ intent: 'finalize', payload }))).toThrowError(
      expect.objectContaining({ code: 'INCOMPLETE' }),
    )
  })

  it('finalizes a complete assessment and reopens with identical findings and score', () => {
    const saved = applySave(null, req({ intent: 'finalize' }))
    expect(saved.status).toBe('finalized')
    expect(saved.result).toMatchObject({ complete: true, score: 10, category: 'low', tjc28: 1, sjc28: 1 })
    const reopened = JSON.parse(JSON.stringify(saved))
    expect(fromPayload(reopened.payload)).toEqual(completeData())
    expect(resultOf(reopened).score).toBe(saved.result.score)
  })

  it('never silently overwrites a finalized assessment', () => {
    const fin = applySave(null, req({ intent: 'finalize' }))
    for (const intent of ['draft', 'finalize'] as const) {
      expect(() => applySave(fin, req({ intent, expectedRevision: fin.revision }))).toThrowError(
        expect.objectContaining({ code: 'FINALIZED' }),
      )
    }
  })

  it('amendment requires a reason, bumps revision and keeps the original', () => {
    const fin = applySave(null, req({ intent: 'finalize' }))
    const changed = toPayload(setGlobal(completeData(), 'prga', 6))
    expect(() => applySave(fin, req({ intent: 'amend', payload: changed, expectedRevision: 1 }))).toThrowError(
      expect.objectContaining({ code: 'REASON_REQUIRED' }),
    )
    const amended = applySave(
      fin,
      req({ intent: 'amend', payload: changed, expectedRevision: 1, amendmentReason: 'Physician global re-scored' }),
    )
    expect(amended.revision).toBe(2)
    expect(amended.history).toHaveLength(1)
    expect(amended.history[0].result.score).toBe(10)
    expect(amended.result.score).toBe(13)
    expect(amended.result.category).toBe('moderate')
    expect(amended.amendmentReason).toBe('Physician global re-scored')
  })

  it('stale saves are rejected (no duplicates, no lost update)', () => {
    const first = applySave(null, req())
    expect(() => applySave(first, req({ expectedRevision: 0 }))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => applySave(null, req({ expectedRevision: 3 }))).toThrowError(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('rejects invalid references and data', () => {
    expect(() => applySave(null, req({ patientId: '../x' }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE' }),
    )
    expect(() => applySave(null, req({ payload: { nope: true } }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATA' }),
    )
    const first = applySave(null, req())
    expect(() => applySave(first, req({ consultationId: 'C2', expectedRevision: 1 }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_REFERENCE' }),
    )
  })

  it('stored summary equals a fresh evaluation of the stored findings', () => {
    const saved = applySave(null, req())
    const fresh = evaluate(fromPayload(saved.payload))
    expect(saved.result.score).toBe(fresh.score)
    expect(saved.result.tjc28).toBe(fresh.tjc28)
  })
})

describe('repositories', () => {
  it('localStorage repository persists across instances', async () => {
    await new LocalStorageAssessmentRepository().save(req())
    const b = new LocalStorageAssessmentRepository()
    const found = await b.getForConsultation('P1', 'C1')
    expect(found?.revision).toBe(1)
    expect(await b.listForPatient('P1')).toHaveLength(1)
    expect(await b.listForPatient('OTHER')).toHaveLength(0)
  })

  it('memory repository enforces the same rules', async () => {
    const repo = new MemoryAssessmentRepository()
    await repo.save(req({ intent: 'finalize' }))
    await expect(repo.save(req({ expectedRevision: 1 }))).rejects.toMatchObject({ code: 'FINALIZED' })
  })
})
