/**
 * Saved-assessment records, lifecycle and revision history — pure functions, no storage.
 *
 * Lifecycle:  (none) → draft → finalized → (amended finalized …)
 *  • Draft saves may be repeated freely.
 *  • A finalized assessment is never silently overwritten. Changing it requires an explicit
 *    amendment with a reason; the previous version is kept in `history`.
 *  • Finalizing requires a complete assessment.
 *  • `expectedRevision` makes every save a compare-and-swap, so a double-click or a stale
 *    browser tab can never create a duplicate or overwrite newer data.
 */
import {
  AssessmentValidationError,
  evaluate,
  fromPayload,
  type AssessmentData,
  type AssessmentPayload,
  type AssessmentResult,
  toPayload,
} from './assessment'
import type { CdaiCategory } from './cdai'

export interface ClinicianRef {
  id: string
  name: string
}

export type RecordStatus = 'draft' | 'finalized'

export interface ResultSummary {
  complete: boolean
  tjc28: number | null
  sjc28: number | null
  ptga: number | null
  prga: number | null
  score: number | null
  category: CdaiCategory | null
  countSource: 'joint-exam' | 'manual'
}

export interface RevisionSnapshot {
  revision: number
  status: RecordStatus
  savedAt: string
  savedBy: ClinicianRef
  reason: string | null
  payload: AssessmentPayload
  result: ResultSummary
}

export interface AssessmentRecord {
  id: string
  patientId: string
  consultationId: string
  /** Visit date (ISO yyyy-mm-dd) copied from the consultation for history display. */
  consultationDate: string
  status: RecordStatus
  /** Increases by one on every successful save. */
  revision: number
  createdAt: string
  createdBy: ClinicianRef
  updatedAt: string
  updatedBy: ClinicianRef
  finalizedAt: string | null
  finalizedBy: ClinicianRef | null
  /** Reason given for the most recent amendment, if any. */
  amendmentReason: string | null
  payload: AssessmentPayload
  result: ResultSummary
  /** Previous finalized versions, oldest first. */
  history: RevisionSnapshot[]
}

export type SaveIntent = 'draft' | 'finalize' | 'amend'

export interface SaveRequest {
  intent: SaveIntent
  patientId: string
  consultationId: string
  consultationDate: string
  clinician: ClinicianRef
  payload: unknown
  /** Revision the caller last saw (0 when no record exists). */
  expectedRevision: number
  amendmentReason?: string
  /** Optional client generated id for a new record. */
  newId?: string
}

export type SaveErrorCode =
  | 'INVALID_REFERENCE'
  | 'INVALID_DATA'
  | 'INCOMPLETE'
  | 'FINALIZED'
  | 'REASON_REQUIRED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'STORAGE'

export class SaveError extends Error {
  readonly code: SaveErrorCode
  readonly issues: string[]
  constructor(code: SaveErrorCode, message: string, issues: string[] = []) {
    super(message)
    this.name = 'SaveError'
    this.code = code
    this.issues = issues
  }
}

export function summarize(result: AssessmentResult): ResultSummary {
  return {
    complete: result.status === 'complete',
    tjc28: result.tjc28,
    sjc28: result.sjc28,
    ptga: result.ptga,
    prga: result.prga,
    score: result.score,
    category: result.category,
    countSource: result.countSource,
  }
}

/** Recompute the clinical result from the stored findings (the source of truth). */
export function resultOf(record: Pick<AssessmentRecord, 'payload'>): AssessmentResult {
  return evaluate(fromPayload(record.payload))
}

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

/**
 * Apply a save request to the current record (or `null`). Throws SaveError; never mutates inputs.
 */
export function applySave(existing: AssessmentRecord | null, req: SaveRequest, now: Date = new Date()): AssessmentRecord {
  if (!REF.test(req.patientId) || !REF.test(req.consultationId)) {
    throw new SaveError('INVALID_REFERENCE', 'The patient or consultation reference is not valid.')
  }
  if (!req.clinician?.id || !req.clinician?.name) {
    throw new SaveError('INVALID_REFERENCE', 'The clinician identity is missing.')
  }
  if (existing && (existing.patientId !== req.patientId || existing.consultationId !== req.consultationId)) {
    throw new SaveError('INVALID_REFERENCE', 'This assessment belongs to a different patient or consultation.')
  }

  const currentRevision = existing?.revision ?? 0
  if (req.expectedRevision !== currentRevision) {
    throw new SaveError(
      'CONFLICT',
      'This assessment was changed elsewhere since you opened it. Reload it before saving again.',
    )
  }

  let data: AssessmentData
  try {
    data = fromPayload(req.payload)
  } catch (e) {
    if (e instanceof AssessmentValidationError) throw new SaveError('INVALID_DATA', 'The assessment data is not valid.', e.issues)
    throw e
  }
  const result = evaluate(data)

  if (existing?.status === 'finalized' && req.intent !== 'amend') {
    throw new SaveError(
      'FINALIZED',
      'This assessment is finalized. Use "Amend" and give a reason to change it; the original is kept in the revision history.',
    )
  }
  if (req.intent === 'amend') {
    if (!existing || existing.status !== 'finalized') {
      throw new SaveError('NOT_FOUND', 'There is no finalized assessment to amend.')
    }
    if (!req.amendmentReason || req.amendmentReason.trim().length < 3) {
      throw new SaveError('REASON_REQUIRED', 'A reason is required to amend a finalized assessment.')
    }
  }
  if ((req.intent === 'finalize' || req.intent === 'amend') && result.status !== 'complete') {
    throw new SaveError('INCOMPLETE', 'An incomplete assessment cannot be finalized.', result.problems)
  }

  const iso = now.toISOString()
  const payload = toPayload(data)
  const summary = summarize(result)
  const isFinal = req.intent === 'finalize' || req.intent === 'amend'

  if (!existing) {
    return {
      id: req.newId ?? `asm-${req.consultationId}`,
      patientId: req.patientId,
      consultationId: req.consultationId,
      consultationDate: req.consultationDate,
      status: isFinal ? 'finalized' : 'draft',
      revision: 1,
      createdAt: iso,
      createdBy: req.clinician,
      updatedAt: iso,
      updatedBy: req.clinician,
      finalizedAt: isFinal ? iso : null,
      finalizedBy: isFinal ? req.clinician : null,
      amendmentReason: null,
      payload,
      result: summary,
      history: [],
    }
  }

  const history =
    req.intent === 'amend'
      ? [
          ...existing.history,
          {
            revision: existing.revision,
            status: existing.status,
            savedAt: existing.updatedAt,
            savedBy: existing.updatedBy,
            reason: existing.amendmentReason,
            payload: existing.payload,
            result: existing.result,
          } satisfies RevisionSnapshot,
        ]
      : existing.history

  return {
    ...existing,
    status: isFinal ? 'finalized' : 'draft',
    revision: existing.revision + 1,
    updatedAt: iso,
    updatedBy: req.clinician,
    finalizedAt: isFinal ? iso : existing.finalizedAt,
    finalizedBy: isFinal ? req.clinician : existing.finalizedBy,
    amendmentReason: req.intent === 'amend' ? req.amendmentReason!.trim() : existing.amendmentReason,
    payload,
    result: summary,
    history,
  }
}
