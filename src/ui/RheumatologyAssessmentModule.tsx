/**
 * Rheumatology Assessment module — the single component a host application mounts from a
 * consultation. It receives references to the existing patient / consultation / clinician and a
 * persistence adapter; it creates none of those itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FINDING, type AssessmentData, type JointFinding } from '../domain/assessment'
import type { ConsultationContext } from '../domain/context'
import { CDAI28_JOINTS, JOINTS, JOINT_BY_ID } from '../domain/joints'
import { categoryLabel, formatScore } from '../domain/cdai'
import type { AssessmentRepository } from '../persistence/repository'
import BodyStage, { type StageMode } from './BodyStage'
import { CATEGORY_COLOR } from './CdaiCard'
import { Banner, Modal } from './controls'
import JointEditor from './JointEditor'
import Navigator from './Navigator'
import { ReviewPanel, ScorePanel } from './Panels'
import { matchesFilter, type JointFilter } from './status'
import SummaryBar from './SummaryBar'
import { useAssessmentSession } from './useAssessmentSession'

export interface ModuleProps {
  context: ConsultationContext
  repository: AssessmentRepository
  onReturnToConsultation?(): void
  /** Force the 2D chart or 3D model (default: 3D when WebGL is available). */
  initialStageMode?: StageMode
}

type Tab = 'joint' | 'score' | 'review'
type MobilePane = 'joints' | 'body' | 'assess'
type Dialog = null | 'finalize' | 'amend' | 'bulk-normal'

const JOINT_ORDER = JOINTS.map((j) => j.id)
const CDAI_IDS = CDAI28_JOINTS.map((j) => j.id)

function formatLongDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export default function RheumatologyAssessmentModule({ context, repository, onReturnToConsultation, initialStageMode }: ModuleProps) {
  const session = useAssessmentSession(context, repository)
  const { data, result, editable } = session

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('joint')
  const [pane, setPane] = useState<MobilePane>('body')
  const [filter, setFilter] = useState<JointFilter>('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const selectedJoint = selectedId ? JOINT_BY_ID[selectedId] : null
  const finding: JointFinding = selectedId ? (data.joints[selectedId] ?? EMPTY_FINDING) : EMPTY_FINDING

  // --- selection -------------------------------------------------------------------------
  const select = useCallback((id: string) => {
    setSelectedId(id)
    setTab('joint')
  }, [])

  const step = useCallback(
    (dir: 1 | -1, predicate?: (id: string) => boolean) => {
      const start = selectedId ? JOINT_ORDER.indexOf(selectedId) : dir === 1 ? -1 : 0
      for (let i = 1; i <= JOINT_ORDER.length; i++) {
        const idx = (start + dir * i + JOINT_ORDER.length * 2) % JOINT_ORDER.length
        const id = JOINT_ORDER[idx]
        if (!predicate || predicate(id)) {
          select(id)
          return id
        }
      }
      return null
    },
    [selectedId, select],
  )

  const isUnresolved = useCallback(
    (id: string) => {
      const f = data.joints[id] ?? EMPTY_FINDING
      return !f.notAssessable && (f.tenderness === 'unknown' || f.swelling === 'unknown')
    },
    [data.joints],
  )

  const nextUnexamined = useCallback(() => {
    const cdaiFirst = step(1, (id) => JOINT_BY_ID[id].cdai28 && isUnresolved(id))
    if (cdaiFirst === null) {
      showToast('All 28 CDAI joints have been examined.')
    }
  }, [step, isUnresolved, showToast])

  const normalAndNext = useCallback(() => {
    if (!selectedId) return
    session.markJointsNormal([selectedId])
    // Continue through the 28-joint set first, then the rest.
    const start = JOINT_ORDER.indexOf(selectedId)
    const pendingAfter = (cdaiOnly: boolean) => {
      for (let i = 1; i <= JOINT_ORDER.length; i++) {
        const id = JOINT_ORDER[(start + i) % JOINT_ORDER.length]
        if (id === selectedId) continue
        if (cdaiOnly && !JOINT_BY_ID[id].cdai28) continue
        if (isUnresolved(id)) return id
      }
      return null
    }
    const next = pendingAfter(true) ?? pendingAfter(false)
    if (next) setSelectedId(next)
    else showToast('Examination of the 28-joint set is complete.')
  }, [selectedId, session, isUnresolved, showToast])

  // --- keyboard shortcuts ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || e.altKey || isTypingTarget(e.target)) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        session.undo()
        return
      }
      if (e.ctrlKey || e.metaKey) return
      if (key === 'arrowright' || key === 'arrowdown' || key === 'j') {
        e.preventDefault()
        step(1)
      } else if (key === 'arrowleft' || key === 'arrowup' || key === 'k') {
        e.preventDefault()
        step(-1)
      } else if (selectedId && editable) {
        const f = data.joints[selectedId] ?? EMPTY_FINDING
        if (key === 't') session.setJoint(selectedId, { tenderness: f.tenderness === 'tender' ? 'not_tender' : 'tender' })
        else if (key === 's') session.setJoint(selectedId, { swelling: f.swelling === 'swollen' ? 'not_swollen' : 'swollen' })
        else if (key === 'p') session.setJoint(selectedId, { pain: f.pain === 'yes' ? 'no' : 'yes' })
        else if (key === 'n') normalAndNext()
        else if (key === 'u') session.clearJointFinding(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, selectedId, editable, data.joints, session, step, normalAndNext])

  // Warn before leaving with unsaved clinical entries.
  useEffect(() => {
    if (!session.dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [session.dirty])

  // --- derived ---------------------------------------------------------------------------
  const highlightIds = useMemo(() => {
    if (filter === 'all') return null
    return new Set(JOINT_ORDER.filter((id) => matchesFilter(data.joints[id] ?? EMPTY_FINDING, filter)))
  }, [filter, data.joints])

  const position = useMemo(() => {
    if (!selectedId) return null
    const idx = CDAI_IDS.indexOf(selectedId)
    return idx >= 0 ? { index: idx + 1, total: CDAI_IDS.length } : null
  }, [selectedId])

  // --- save flows --------------------------------------------------------------------------
  const doFinalize = async () => {
    const ok = session.amending ? await session.amend(reason.trim()) : await session.finalize()
    if (ok) {
      setDialog(null)
      setConfirmed(false)
      setReason('')
      showToast(session.amending ? 'Amendment saved. Previous version kept in history.' : 'Assessment finalized.')
    }
  }
  const doDraft = async () => {
    if (await session.saveDraft()) showToast('Draft saved.')
  }

  const status = (() => {
    if (session.loading) return { label: 'Loading…', tone: 'neutral' }
    if (session.record?.status === 'finalized') return { label: session.amending ? 'Amending finalized assessment' : 'Finalized', tone: 'final' }
    if (result.status === 'complete') return { label: 'Complete — ready to finalize', tone: 'ready' }
    if (result.counts.all.examined === 0 && result.counts.painReported === 0 && result.ptga === null && result.prga === null && !session.record)
      return { label: 'Not started', tone: 'neutral' }
    return { label: 'Draft — incomplete', tone: 'draft' }
  })()

  const bulkIds = result.counts.cdai.unresolvedIds

  return (
    <div className="module" data-pane={pane}>
      {/* ------------------------------------------------------------------ header */}
      <header className="module-header">
        <div className="title-block">
          <span className="logo" aria-hidden="true">
            ⌖
          </span>
          <div>
            <h1>Rheumatology Assessment</h1>
            <p>3D joint examination &amp; CDAI</p>
          </div>
        </div>
        <dl className="header-meta">
          <div>
            <dt>Patient</dt>
            <dd data-testid="patient-name">
              {context.patient.name} <span className="muted">· {context.patient.id}</span>
            </dd>
          </div>
          <div>
            <dt>Consultation</dt>
            <dd>{formatLongDate(context.consultation.date)}</dd>
          </div>
          <div>
            <dt>Clinician</dt>
            <dd>{context.clinician.name}</dd>
          </div>
        </dl>
        <div className="header-actions">
          <span className={`status status-${status.tone}`} data-testid="assessment-status">
            {status.label}
          </span>
          {session.dirty && <span className="status status-dirty">Unsaved</span>}
          <button type="button" className="btn" onClick={() => (onReturnToConsultation ? onReturnToConsultation() : showToast('Return to consultation — provided by the host application.'))}>
            ← Consultation
          </button>
        </div>
      </header>

      {session.readOnlyReason && (
        <Banner
          tone="info"
          action={
            session.record?.status === 'finalized' && context.permissions.canEdit && !session.amending ? (
              <button type="button" className="btn small" onClick={session.startAmend}>
                Amend assessment
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
              Cancel amendment
            </button>
          }
        >
          Amending a finalized assessment. The original is kept in the revision history and a reason is required to save.
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
          {session.error.issues.length > 0 && (
            <ul className="issue-list">
              {session.error.issues.slice(0, 6).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
          {session.dirty && <div className="small">Your entries are still on screen and have not been lost.</div>}
        </Banner>
      )}

      {/* ------------------------------------------------------------------ workspace */}
      <div className="workspace">
        <aside className="panel left" data-active={pane === 'joints'} aria-label="Examination navigation">
          <Navigator
            data={data}
            result={result}
            selectedId={selectedId}
            filter={filter}
            onFilter={setFilter}
            onSelect={(id) => {
              select(id)
              setPane('assess')
            }}
            editable={editable}
            onMarkRemainingNormal={() => setDialog('bulk-normal')}
          />
        </aside>

        <main className="panel center" data-active={pane === 'body'} aria-label="Body model">
          <BodyStage
            data={data}
            selectedId={selectedId}
            onSelect={select}
            highlightIds={highlightIds}
            initialMode={initialStageMode}
            onFocusRegion={(id) => id && select(id)}
          />
        </main>

        <aside className="panel right" data-active={pane === 'assess'} aria-label="Clinical assessment">
          <div className="tabs" role="tablist" aria-label="Assessment sections">
            {(
              [
                ['joint', 'Joint exam'],
                ['score', 'Score & globals'],
                ['review', 'Review'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" type="button" aria-selected={tab === id} id={`tab-${id}`} aria-controls={`tabpanel-${id}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'joint' && (
              <JointEditor
                joint={selectedJoint}
                finding={finding}
                editable={editable}
                position={position}
                onChange={(patch) => selectedId && session.setJoint(selectedId, patch)}
                onClear={() => selectedId && session.clearJointFinding(selectedId)}
                onNormalNext={normalAndNext}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onNextUnexamined={nextUnexamined}
                onStart={() => select(CDAI_IDS[0])}
              />
            )}
            {tab === 'score' && (
              <ScorePanel
                data={data}
                result={result}
                editable={editable}
                onCountSource={session.setCountSource}
                onCount={session.setCount}
                onGlobal={session.setGlobalValue}
                onGoToJoints={() => {
                  setTab('joint')
                  setPane('body')
                }}
              />
            )}
            {tab === 'review' && (
              <ReviewPanel
                data={data}
                result={result}
                history={session.history}
                record={session.record}
                currentConsultationId={context.consultation.id}
                dirty={session.dirty}
                editable={editable}
                onSelect={(id) => {
                  select(id)
                  setPane('assess')
                }}
                onNote={session.setNote}
              />
            )}
          </div>
        </aside>
      </div>

      <SummaryBar
        session={session}
        onSaveDraft={() => void doDraft()}
        onFinalize={() => {
          setConfirmed(false)
          setDialog(session.amending ? 'amend' : 'finalize')
        }}
        onAmend={session.startAmend}
      />

      <nav className="mobile-tabs" aria-label="Sections">
        {(
          [
            ['joints', 'Joints'],
            ['body', 'Body'],
            ['assess', 'Assess'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={pane === id} onClick={() => setPane(id)}>
            {label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {/* ------------------------------------------------------------------ dialogs */}
      {(dialog === 'finalize' || dialog === 'amend') && (
        <Modal
          title={dialog === 'amend' ? 'Save amendment' : 'Finalize assessment'}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn" data-close onClick={() => setDialog(null)}>
                Back to review
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={session.saving || !confirmed || (dialog === 'amend' && reason.trim().length < 3)}
                onClick={() => void doFinalize()}
              >
                {session.saving ? 'Saving…' : dialog === 'amend' ? 'Save amendment' : 'Finalize assessment'}
              </button>
            </>
          }
        >
          <FinalizeSummary data={data} result={result} />
          {dialog === 'amend' && (
            <label className="field-label block-label">
              Reason for amendment (required)
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Physician global re-scored after review" />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I have reviewed these findings and they reflect my examination.</span>
          </label>
          {session.error && <p className="field-error" role="alert">{session.error.message}</p>}
          <p className="muted small">
            This records a clinical measurement. It does not create prescriptions or treatment recommendations.
          </p>
        </Modal>
      )}

      {dialog === 'bulk-normal' && (
        <Modal
          title="Mark remaining joints as normal?"
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
                  session.fillMissingNormal(bulkIds)
                  setDialog(null)
                  showToast(`${bulkIds.length} joints recorded as examined — not tender, not swollen. Undo is available.`)
                }}
              >
                Record {bulkIds.length} joints as normal
              </button>
            </>
          }
        >
          <p>
            For the <b>{bulkIds.length}</b> joint{bulkIds.length === 1 ? '' : 's'} of the 28-joint set that still lack a
            finding, this records the missing tenderness as <b>not tender</b> and the missing swelling as <b>not
            swollen</b>. Findings you have already recorded (tender, swollen or negative) are never changed.
          </p>
          <p className="muted small">Only do this for joints you actually examined. You can undo this action.</p>
        </Modal>
      )}
    </div>
  )
}

function FinalizeSummary({ data, result }: { data: AssessmentData; result: ReturnType<typeof useAssessmentSession>['result'] }) {
  void data
  return (
    <div className="finalize-summary">
      <div className="finalize-score">
        {result.score !== null && result.category ? (
          <>
            <b style={{ color: CATEGORY_COLOR[result.category] }}>{formatScore(result.score)}</b>
            <span>{categoryLabel(result.category)}</span>
          </>
        ) : (
          <span>Incomplete</span>
        )}
      </div>
      <table>
        <tbody>
          <tr>
            <th>Tender joint count (TJC28)</th>
            <td>{result.tjc28}</td>
          </tr>
          <tr>
            <th>Swollen joint count (SJC28)</th>
            <td>{result.sjc28}</td>
          </tr>
          <tr>
            <th>Patient global (PtGA)</th>
            <td>{result.ptga?.toFixed(1)}</td>
          </tr>
          <tr>
            <th>Physician global (PrGA)</th>
            <td>{result.prga?.toFixed(1)}</td>
          </tr>
          <tr>
            <th>Source of counts</th>
            <td>{result.countSource === 'manual' ? 'Entered manually' : 'Joint examination (28-joint set)'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

