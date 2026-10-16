/**
 * Rheumatology Assessment module — the single component a host application mounts from a
 * consultation. It receives references to the existing patient / consultation / clinician and a
 * persistence adapter; it creates none of those itself.
 *
 * UX: a simple three-step flow —  1 Check joints  →  2 Rate overall  →  3 Result.
 * The body (3D or chart) is always visible on the left; the right side shows ONE step at a time.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FINDING, type JointFinding } from '../domain/assessment'
import type { ConsultationContext } from '../domain/context'
import { categoryLabel, formatScore } from '../domain/cdai'
import { CDAI28_JOINTS, JOINT_BY_ID } from '../domain/joints'
import type { AssessmentRepository } from '../persistence/repository'
import BodyStage, { type StageMode } from './BodyStage'
import { Banner, Modal } from './controls'
import ExamStep from './steps/ExamStep'
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
type Dialog = null | 'finalize' | 'amend' | 'remaining'

const CDAI_IDS = CDAI28_JOINTS.map((j) => j.id)
const STEPS: { id: Step; label: string }[] = [
  { id: 'exam', label: 'Joints' },
  { id: 'rating', label: 'Rating' },
  { id: 'result', label: 'Result' },
]

const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el?.tagName && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
}

export default function RheumatologyAssessmentModule({ context, repository, onReturnToConsultation, initialStageMode }: ModuleProps) {
  const session = useAssessmentSession(context, repository)
  const { data, result, editable } = session

  const [step, setStep] = useState<Step>('exam')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [guided, setGuided] = useState(false)
  const [focus, setFocus] = useState<{ jointId: string; nonce: number } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const advanceTimer = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])
  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current)
      window.clearTimeout(advanceTimer.current)
    },
    [],
  )

  // Latest values for timers / event handlers.
  const dataRef = useRef(data)
  dataRef.current = data
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  const unresolved = (id: string) => {
    const f = dataRef.current.joints[id] ?? EMPTY_FINDING
    return !f.notAssessable && (f.tenderness === 'unknown' || f.swelling === 'unknown')
  }

  const open = useCallback((id: string, opts: { guided: boolean; follow: boolean }) => {
    window.clearTimeout(advanceTimer.current)
    setSelectedId(id)
    setGuided(opts.guided)
    setStep('exam')
    if (opts.follow) setFocus((f) => ({ jointId: id, nonce: (f?.nonce ?? 0) + 1 }))
  }, [])

  /** Next joint of the 28-joint set that still needs an answer (cyclic), skipping `treatAsDone`. */
  const nextUnresolved = useCallback((from: string | null, treatAsDone?: string) => {
    const start = from ? CDAI_IDS.indexOf(from) : -1
    for (let i = 1; i <= CDAI_IDS.length; i++) {
      const id = CDAI_IDS[(start + i + CDAI_IDS.length) % CDAI_IDS.length]
      if (id === treatAsDone) continue
      if (unresolved(id)) return id
    }
    return null
  }, [])

  const goNext = useCallback(
    (treatAsDone?: string) => {
      const cur = selectedRef.current
      const next = nextUnresolved(cur, treatAsDone)
      if (next) {
        open(next, { guided: true, follow: true })
        return
      }
      // Everything answered: either review the next joint in order, or show the "all done" card.
      if (treatAsDone || !cur) {
        window.clearTimeout(advanceTimer.current)
        setSelectedId(null)
        setGuided(false)
        showToast('All 28 joints are checked.')
      } else {
        const idx = CDAI_IDS.indexOf(cur)
        open(CDAI_IDS[(idx + 1) % CDAI_IDS.length], { guided: true, follow: true })
      }
    },
    [nextUnresolved, open, showToast],
  )

  const goPrev = useCallback(() => {
    const cur = selectedRef.current
    const idx = cur ? Math.max(CDAI_IDS.indexOf(cur), 0) : 0
    open(CDAI_IDS[(idx - 1 + CDAI_IDS.length) % CDAI_IDS.length], { guided: true, follow: true })
  }, [open])

  const start = useCallback(() => {
    open(nextUnresolved(null) ?? CDAI_IDS[0], { guided: true, follow: true })
  }, [open, nextUnresolved])

  const answer = useCallback(
    (patch: Partial<JointFinding>) => {
      const id = selectedRef.current
      if (!id) return
      session.setJoint(id, patch)
      // Guided flow: once both questions are answered, move on automatically.
      const merged = { ...(dataRef.current.joints[id] ?? EMPTY_FINDING), ...patch }
      const answered = 'tenderness' in patch || 'swelling' in patch
      if (guided && answered && merged.tenderness !== 'unknown' && merged.swelling !== 'unknown') {
        window.clearTimeout(advanceTimer.current)
        advanceTimer.current = window.setTimeout(() => goNext(id), 380)
      }
    },
    [session, guided, goNext],
  )

  // Keyboard shortcuts (power users): arrows, T, S, N, Ctrl+Z. Not shown in the UI to keep it simple.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.altKey || isTyping(e.target) || step !== 'exam') return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault()
        session.undo()
        return
      }
      if (e.ctrlKey || e.metaKey) return
      const id = selectedRef.current
      if (k === 'arrowright' || k === 'arrowdown') {
        e.preventDefault()
        goNext()
      } else if (k === 'arrowleft' || k === 'arrowup') {
        e.preventDefault()
        goPrev()
      } else if (id && editable) {
        const f = dataRef.current.joints[id] ?? EMPTY_FINDING
        if (k === 't') answer({ tenderness: f.tenderness === 'tender' ? 'not_tender' : 'tender' })
        else if (k === 's') answer({ swelling: f.swelling === 'swollen' ? 'not_swollen' : 'swollen' })
        else if (k === 'n') {
          session.markJointsNormal([id])
          goNext(id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, step, editable, session, goNext, goPrev, answer])

  useEffect(() => {
    if (!session.dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [session.dirty])

  // Each new joint / step starts at the top of the panel (important on phones).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectedId, step])

  // ---- derived -------------------------------------------------------------------------
  const joint = selectedId ? JOINT_BY_ID[selectedId] : null
  const finding = selectedId ? (data.joints[selectedId] ?? EMPTY_FINDING) : EMPTY_FINDING
  const position = selectedId && CDAI_IDS.includes(selectedId) ? CDAI_IDS.indexOf(selectedId) + 1 : null
  const c = result.counts.cdai
  const complete = result.status === 'complete'
  const finalized = session.record?.status === 'finalized'

  const statusChip = useMemo(() => {
    if (session.loading) return { label: 'Loading…', tone: 'neutral' }
    if (finalized) return { label: session.amending ? 'Amending' : 'Finalized', tone: 'final' }
    if (complete) return { label: 'Ready to finalize', tone: 'ready' }
    const started = result.counts.all.examined + result.counts.all.partial > 0 || result.ptga !== null || result.prga !== null
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

  return (
    <div className="module">
      {/* header */}
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
        {/* body */}
        <section className="panel body-panel" aria-label="Body">
          <BodyStage
            data={data}
            selectedId={selectedId}
            onSelect={(id) => open(id, { guided: false, follow: false })}
            initialMode={initialStageMode}
            focusRequest={focus}
          />
        </section>

        {/* steps */}
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
                joint={joint}
                finding={finding}
                editable={editable}
                result={result}
                position={position}
                canUndo={session.canUndo}
                onUndo={session.undo}
                onAnswer={answer}
                onPrev={goPrev}
                onNext={() => goNext()}
                onStart={start}
                onRemainingNormal={() => setDialog('remaining')}
                onGoRating={() => setStep('rating')}
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
            {step === 'exam' && (
              <button type="button" className="btn primary grow" onClick={() => setStep('rating')} data-testid="to-rating">
                Next: overall rating →
              </button>
            )}
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

      {(dialog === 'finalize' || dialog === 'amend') && (
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

      {dialog === 'remaining' && (
        <Modal
          title="Fill in the remaining joints?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" data-close onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  session.fillMissingNormal(c.unresolvedIds)
                  setDialog(null)
                  setSelectedId(null)
                  showToast(`${c.unresolvedIds.length} joints marked "not tender, not swollen". You can undo this.`)
                }}
              >
                Yes, mark them normal
              </button>
            </>
          }
        >
          <p>
            {c.unresolvedIds.length} joint{c.unresolvedIds.length === 1 ? '' : 's'} will be recorded as <b>not tender</b> and{' '}
            <b>not swollen</b>. Answers you already gave are never changed.
          </p>
          <p className="muted">Only do this for joints you actually examined.</p>
        </Modal>
      )}
    </div>
  )
}
