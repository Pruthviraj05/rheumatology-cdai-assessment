/**
 * Rheumatology Assessment module — the single component a host application mounts from a
 * consultation. It receives references to the existing patient / consultation / clinician and a
 * persistence adapter; it creates none of those itself.
 *
 * UX: three simple steps — 1 Joints → 2 Rating → 3 Result.
 * Step 1 only asks the doctor to tap the AFFECTED joints; one button records the rest as normal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FINDING, type JointFinding } from '../domain/assessment'
import type { ConsultationContext } from '../domain/context'
import { categoryLabel, formatScore } from '../domain/cdai'
import { JOINT_BY_ID } from '../domain/joints'
import type { AssessmentRepository } from '../persistence/repository'
import BodyStage, { type StageMode } from './BodyStage'
import { Banner, Modal } from './controls'
import ExamStep, { type Tool } from './steps/ExamStep'
import RatingStep from './steps/RatingStep'
import ResultStep from './steps/ResultStep'
import { CATEGORY_COLOR } from './theme'
import { useAssessmentSession } from './useAssessmentSession'

export interface ModuleProps {
  context: ConsultationContext
  repository: AssessmentRepository
  onReturnToConsultation?(): void
  /** Force the 2D chart or 3D model (default: 3D when WebGL is available). */
  initialStageMode?: StageMode
}

type Step = 'exam' | 'rating' | 'result'
type Dialog = null | 'finalize' | 'amend'

const STEPS: { id: Step; label: string }[] = [
  { id: 'exam', label: 'Joints' },
  { id: 'rating', label: 'Rating' },
  { id: 'result', label: 'Result' },
]

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RheumatologyAssessmentModule({ context, repository, onReturnToConsultation, initialStageMode }: ModuleProps) {
  const session = useAssessmentSession(context, repository)
  const { data, result, editable } = session

  const [step, setStep] = useState<Step>('exam')
  const [tool, setTool] = useState<Tool>('tender')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [step])

  /** Toggle a finding. Turning one off keeps the joint "examined" if the other finding was recorded. */
  const toggle = useCallback(
    (id: string, field: 'tenderness' | 'swelling' | 'pain') => {
      const f = dataRef.current.joints[id] ?? EMPTY_FINDING
      if (field === 'tenderness') {
        session.setJoint(id, { tenderness: f.tenderness === 'tender' ? (f.swelling !== 'unknown' ? 'not_tender' : 'unknown') : 'tender' })
      } else if (field === 'swelling') {
        session.setJoint(id, { swelling: f.swelling === 'swollen' ? (f.tenderness !== 'unknown' ? 'not_swollen' : 'unknown') : 'swollen' })
      } else {
        session.setJoint(id, { pain: f.pain === 'yes' ? 'unknown' : 'yes' })
      }
    },
    [session],
  )

  const toggleFromForm = useCallback(
    (id: string, field: 'tenderness' | 'swelling') => {
      setSelectedId(id)
      toggle(id, field)
    },
    [toggle],
  )

  /** A tap on the body applies the current marker tool. */
  const tapBody = useCallback(
    (id: string) => {
      setSelectedId(id)
      setStep('exam')
      if (!editable) return
      if (tool === 'tender') toggle(id, 'tenderness')
      else if (tool === 'swollen') toggle(id, 'swelling')
      else if (tool === 'pain') toggle(id, 'pain')
      else session.setJoint(id, { tenderness: 'unknown', swelling: 'unknown', pain: 'unknown', notAssessable: false })
    },
    [editable, tool, toggle, session],
  )

  const finishJoints = () => {
    const missing = result.counts.cdai.unresolvedIds
    if (missing.length > 0 && editable) {
      session.fillMissingNormal(missing)
      showToast(`The other ${missing.length} joints were recorded as normal. Undo is on the Joints step.`)
    }
    setStep('rating')
  }

  // Ctrl+Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (dialog || (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        session.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, session])

  useEffect(() => {
    if (!session.dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [session.dirty])

  // ---- derived -------------------------------------------------------------------------
  const selected = selectedId ? JOINT_BY_ID[selectedId] : null
  const selectedFinding: JointFinding = selectedId ? (data.joints[selectedId] ?? EMPTY_FINDING) : EMPTY_FINDING
  const c = result.counts.cdai
  const complete = result.status === 'complete'
  const finalized = session.record?.status === 'finalized'

  const statusChip = useMemo(() => {
    if (session.loading) return { label: 'Loading…', tone: 'neutral' }
    if (finalized) return { label: session.amending ? 'Amending' : 'Finalized', tone: 'final' }
    if (complete) return { label: 'Ready to finalize', tone: 'ready' }
    const started = result.counts.all.examined + result.counts.all.partial > 0 || result.counts.painReported > 0 || result.ptga !== null || result.prga !== null
    return started || session.record ? { label: 'In progress', tone: 'draft' } : { label: 'Not started', tone: 'neutral' }
  }, [session.loading, finalized, session.amending, complete, result, session.record])

  const stepDone: Record<Step, boolean> = {
    exam: result.countSource === 'manual' ? true : c.unresolvedIds.length === 0,
    rating: result.ptga !== null && result.prga !== null,
    result: complete,
  }

  const doFinalize = async () => {
    const ok = session.amending ? await session.amend(reason.trim()) : await session.finalize()
    if (ok) {
      setDialog(null)
      setReason('')
      showToast(session.amending ? 'Amendment saved.' : 'Assessment finalized.')
    }
  }
  const saveDraft = async () => {
    if (await session.saveDraft()) showToast('Draft saved.')
  }

  let saveText = ''
  if (session.saving) saveText = 'Saving…'
  else if (session.dirty) saveText = 'Unsaved changes'
  else if (session.record) saveText = finalized ? 'Saved · finalized' : 'Saved'

  const missing = c.unresolvedIds.length

  return (
    <div className="module">
      <header className="module-header">
        <div className="title-block">
          <h1>Joint assessment</h1>
          <p>
            <span data-testid="patient-name">{context.patient.name}</span> · {longDate(context.consultation.date)} · {context.clinician.name}
          </p>
        </div>
        <div className="header-actions">
          <span className={`status status-${statusChip.tone}`} data-testid="assessment-status">
            {statusChip.label}
          </span>
          <span className={`save-state${session.dirty ? ' dirty' : ''}`} data-testid="save-state">
            {saveText}
          </span>
          {editable && session.dirty && (
            <button type="button" className="btn" disabled={session.saving} onClick={() => void saveDraft()}>
              Save draft
            </button>
          )}
          <button
            type="button"
            className="btn ghost"
            onClick={() => (onReturnToConsultation ? onReturnToConsultation() : showToast('Back to the consultation — provided by the host application.'))}
          >
            ← Consultation
          </button>
        </div>
      </header>

      {session.readOnlyReason && (
        <Banner
          tone="info"
          action={
            finalized && context.permissions.canEdit && !session.amending ? (
              <button type="button" className="btn small" onClick={session.startAmend}>
                Amend
              </button>
            ) : undefined
          }
        >
          {session.readOnlyReason}
        </Banner>
      )}
      {session.amending && (
        <Banner
          tone="warn"
          action={
            <button type="button" className="btn small" onClick={session.cancelAmend}>
              Cancel
            </button>
          }
        >
          You are amending a finalized assessment. The original stays in the history and a reason is required.
        </Banner>
      )}
      {session.error && (
        <Banner
          tone="error"
          action={
            <button type="button" className="btn small" onClick={session.clearError}>
              Dismiss
            </button>
          }
        >
          <strong>{session.error.message}</strong>
          {session.dirty && <div className="small">Your answers are still on screen and were not lost.</div>}
        </Banner>
      )}

      <div className="workspace">
        <section className="panel body-panel" aria-label="Body">
          <BodyStage data={data} selectedId={selectedId} onSelect={tapBody} initialMode={initialStageMode} focusRequest={null} />
        </section>

        <section className="panel step-panel" aria-label="Assessment steps">
          <nav className="stepper" aria-label="Steps">
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" aria-current={step === s.id ? 'step' : undefined} data-done={stepDone[s.id]} onClick={() => setStep(s.id)}>
                <span className="num">{stepDone[s.id] && s.id !== 'result' ? '✓' : i + 1}</span>
                {s.label}
              </button>
            ))}
          </nav>

          <div className="step-scroll" ref={scrollRef}>
            {step === 'exam' && (
              <ExamStep
                data={data}
                result={result}
                editable={editable}
                tool={tool}
                onTool={setTool}
                onToggle={toggleFromForm}
                selected={selected}
                selectedFinding={selectedFinding}
                onDetail={(patch) => selectedId && session.setJoint(selectedId, patch)}
                canUndo={session.canUndo}
                onUndo={session.undo}
              />
            )}
            {step === 'rating' && (
              <RatingStep
                data={data}
                result={result}
                editable={editable}
                onGlobal={session.setGlobalValue}
                onCountSource={session.setCountSource}
                onCount={session.setCount}
                onGoJoints={() => setStep('exam')}
              />
            )}
            {step === 'result' && (
              <ResultStep
                data={data}
                result={result}
                record={session.record}
                history={session.history}
                currentConsultationId={context.consultation.id}
                onGoJoints={() => setStep('exam')}
                onGoRating={() => setStep('rating')}
              />
            )}
          </div>

          <footer className="step-footer">
            {step === 'exam' &&
              (missing > 0 && editable && result.countSource === 'joint-exam' ? (
                <button type="button" className="btn primary grow" onClick={finishJoints} data-testid="joints-done">
                  ✓ Done — the other {missing} joint{missing === 1 ? ' is' : 's are'} normal
                </button>
              ) : (
                <button type="button" className="btn primary grow" onClick={() => setStep('rating')} data-testid="to-rating">
                  Next: overall rating →
                </button>
              ))}
            {step === 'rating' && (
              <>
                <button type="button" className="btn" onClick={() => setStep('exam')}>
                  ← Joints
                </button>
                <button type="button" className="btn primary grow" onClick={() => setStep('result')} data-testid="to-result">
                  See result →
                </button>
              </>
            )}
            {step === 'result' && (
              <>
                <button type="button" className="btn" onClick={() => setStep('rating')}>
                  ← Back
                </button>
                {finalized && !session.amending ? (
                  <button type="button" className="btn primary grow" disabled={!context.permissions.canEdit} onClick={session.startAmend}>
                    Amend…
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn grow" disabled={!editable || session.saving || !session.dirty} onClick={() => void saveDraft()}>
                      Save draft
                    </button>
                    <button
                      type="button"
                      className="btn primary grow"
                      disabled={!editable || session.saving || !complete}
                      title={complete ? undefined : 'Finish the joints and ratings first'}
                      onClick={() => setDialog(session.amending ? 'amend' : 'finalize')}
                    >
                      {session.amending ? 'Save amendment…' : 'Finalize…'}
                    </button>
                  </>
                )}
              </>
            )}
          </footer>
        </section>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {dialog && (
        <Modal
          title={dialog === 'amend' ? 'Save amendment' : 'Finalize this assessment?'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" data-close onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={session.saving || (dialog === 'amend' && reason.trim().length < 3)}
                onClick={() => void doFinalize()}
              >
                {session.saving ? 'Saving…' : dialog === 'amend' ? 'Save amendment' : 'Finalize'}
              </button>
            </>
          }
        >
          {result.score !== null && result.category && (
            <p className="modal-score">
              <b style={{ color: CATEGORY_COLOR[result.category] }}>{formatScore(result.score)}</b> {categoryLabel(result.category)}
              <span className="muted">
                {' '}
                · {result.tjc28} tender · {result.sjc28} swollen · patient {result.ptga?.toFixed(1)} · doctor {result.prga?.toFixed(1)}
              </span>
            </p>
          )}
          {dialog === 'amend' ? (
            <label className="field">
              <span>Why is this being changed? (required)</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor's rating corrected" />
            </label>
          ) : (
            <p>Once finalized, changes need an amendment with a reason. The original is always kept.</p>
          )}
          {session.error && (
            <p className="field-error" role="alert">
              {session.error.message}
            </p>
          )}
        </Modal>
      )}
    </div>
  )
}
