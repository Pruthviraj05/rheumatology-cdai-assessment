/**
 * Working-copy state for one consultation's assessment.
 *
 *  • all clinical edits go through the pure domain functions (validated, immutable);
 *  • unsaved edits are never discarded by view changes, joint selection or 3D re-renders;
 *  • a failed save keeps the working copy and reports the error;
 *  • saves are serialised (no double-submit) and use compare-and-swap on the revision.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AssessmentValidationError,
  clearJoint,
  createEmptyAssessment,
  evaluate,
  fromPayload,
  fillMissingAsNormal,
  markNormal,
  setGlobal,
  setManualCount,
  toPayload,
  updateJoint,
  type AssessmentData,
  type AssessmentResult,
  type CountSource,
  type GlobalField,
  type JointFinding,
} from '../domain/assessment'
import type { ConsultationContext } from '../domain/context'
import { SaveError, type AssessmentRecord, type SaveIntent } from '../domain/records'
import type { AssessmentRepository } from '../persistence/repository'

export interface SessionError {
  message: string
  issues: string[]
  code?: string
}

export interface AssessmentSession {
  loading: boolean
  data: AssessmentData
  result: AssessmentResult
  record: AssessmentRecord | null
  history: AssessmentRecord[]
  dirty: boolean
  saving: boolean
  error: SessionError | null
  amending: boolean
  /** True when the clinician may change findings right now. */
  editable: boolean
  readOnlyReason: string | null
  canUndo: boolean
  lastSavedAt: string | null
  clearError(): void
  setJoint(jointId: string, patch: Partial<JointFinding>): void
  clearJointFinding(jointId: string): void
  markJointsNormal(jointIds: readonly string[]): void
  fillMissingNormal(jointIds: readonly string[]): void
  setGlobalValue(field: GlobalField, value: number | null): void
  setCountSource(source: CountSource): void
  setCount(field: 'tjc28' | 'sjc28', value: number | null): void
  setNote(note: string): void
  replaceData(next: AssessmentData): void
  undo(): void
  saveDraft(): Promise<boolean>
  finalize(): Promise<boolean>
  startAmend(): void
  cancelAmend(): void
  amend(reason: string): Promise<boolean>
}

const UNDO_LIMIT = 60

export function useAssessmentSession(ctx: ConsultationContext, repo: AssessmentRepository): AssessmentSession {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<AssessmentData>(createEmptyAssessment)
  const [record, setRecord] = useState<AssessmentRecord | null>(null)
  const [history, setHistory] = useState<AssessmentRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<SessionError | null>(null)
  const [amending, setAmending] = useState(false)
  const [undoStack, setUndoStack] = useState<AssessmentData[]>([])

  const savingRef = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data
  const recordRef = useRef(record)
  recordRef.current = record
  const undoRef = useRef(undoStack)
  undoRef.current = undoStack

  const { patient, consultation, clinician, permissions } = ctx

  // Load saved assessment + patient history whenever the consultation changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAmending(false)
    setUndoStack([])
    ;(async () => {
      try {
        const [existing, all] = await Promise.all([
          repo.getForConsultation(patient.id, consultation.id),
          repo.listForPatient(patient.id),
        ])
        if (cancelled) return
        setRecord(existing)
        setHistory(all)
        setData(existing ? fromPayload(existing.payload) : createEmptyAssessment())
      } catch (e) {
        if (cancelled) return
        setError({ message: 'The saved assessment could not be loaded.', issues: [String(e)] })
        setRecord(null)
        setData(createEmptyAssessment())
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, patient.id, consultation.id])

  const result = useMemo(() => evaluate(data), [data])

  const dirty = useMemo(() => {
    const current = JSON.stringify(toPayload(data))
    const saved = JSON.stringify(record ? record.payload : toPayload(createEmptyAssessment()))
    return current !== saved
  }, [data, record])

  const finalized = record?.status === 'finalized'
  let readOnlyReason: string | null = null
  if (!permissions.canEdit) readOnlyReason = 'You have view-only access to this assessment.'
  else if (finalized && !amending) readOnlyReason = 'This assessment is finalized. Use "Amend" to change it.'
  const editable = readOnlyReason === null && !loading

  const commit = useCallback((fn: (d: AssessmentData) => AssessmentData) => {
    try {
      const prev = dataRef.current
      const next = fn(prev)
      if (next === prev) return
      setUndoStack((s) => [...s.slice(-(UNDO_LIMIT - 1)), prev])
      setData(next)
      setError(null)
    } catch (e) {
      if (e instanceof AssessmentValidationError) setError({ message: e.issues[0] ?? 'Invalid entry.', issues: e.issues })
      else throw e
    }
  }, [])

  const guard = useCallback(
    <A extends unknown[]>(fn: (...a: A) => void) =>
      (...a: A) => {
        if (!editable) return
        fn(...a)
      },
    [editable],
  )

  const runSave = useCallback(
    async (intent: SaveIntent, amendmentReason?: string): Promise<boolean> => {
      if (savingRef.current) return false // prevents accidental duplicate saves
      if (!permissions.canEdit) {
        setError({ message: 'You do not have permission to change this assessment.', issues: [], code: 'FORBIDDEN' })
        return false
      }
      savingRef.current = true
      setSaving(true)
      setError(null)
      try {
        const saved = await repo.save({
          intent,
          patientId: patient.id,
          consultationId: consultation.id,
          consultationDate: consultation.date,
          clinician,
          payload: toPayload(dataRef.current),
          expectedRevision: recordRef.current?.revision ?? 0,
          amendmentReason,
        })
        setRecord(saved)
        setAmending(false)
        if (intent !== 'draft') setUndoStack([])
        try {
          setHistory(await repo.listForPatient(patient.id))
        } catch {
          /* history refresh is best effort */
        }
        return true
      } catch (e) {
        // Working copy is intentionally left untouched so nothing the clinician entered is lost.
        if (e instanceof SaveError) setError({ message: e.message, issues: e.issues, code: e.code })
        else setError({ message: 'The assessment could not be saved. Your entries are still on screen — try again.', issues: [String(e)] })
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [repo, patient.id, consultation.id, consultation.date, clinician, permissions.canEdit],
  )

  return {
    loading,
    data,
    result,
    record,
    history,
    dirty,
    saving,
    error,
    amending,
    editable,
    readOnlyReason,
    canUndo: undoStack.length > 0 && editable,
    lastSavedAt: record?.updatedAt ?? null,
    clearError: () => setError(null),
    setJoint: guard((id: string, patch: Partial<JointFinding>) => commit((d) => updateJoint(d, id, patch))),
    clearJointFinding: guard((id: string) => commit((d) => clearJoint(d, id))),
    markJointsNormal: guard((ids: readonly string[]) => commit((d) => markNormal(d, ids))),
    fillMissingNormal: guard((ids: readonly string[]) => commit((d) => fillMissingAsNormal(d, ids))),
    setGlobalValue: guard((field: GlobalField, value: number | null) => commit((d) => setGlobal(d, field, value))),
    setCountSource: guard((source: CountSource) => commit((d) => ({ ...d, countSource: source }))),
    setCount: guard((field: 'tjc28' | 'sjc28', value: number | null) => commit((d) => setManualCount(d, field, value))),
    setNote: guard((note: string) => commit((d) => ({ ...d, note }))),
    replaceData: guard((next: AssessmentData) => commit(() => next)),
    undo: () => {
      const stack = undoRef.current
      if (!editable || stack.length === 0) return
      setData(stack[stack.length - 1])
      setUndoStack(stack.slice(0, -1))
    },
    saveDraft: () => runSave('draft'),
    finalize: () => runSave('finalize'),
    startAmend: () => {
      if (permissions.canEdit && finalized) setAmending(true)
    },
    cancelAmend: () => {
      setAmending(false)
      setUndoStack([])
      if (recordRef.current) setData(fromPayload(recordRef.current.payload))
    },
    amend: (reason: string) => runSave('amend', reason),
  }
}
