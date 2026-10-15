import { useEffect, useId, useState } from 'react'
import { JOINT_BY_ID, CDAI28_JOINTS } from '../domain/joints'
import { EMPTY_FINDING, type AssessmentData, type AssessmentResult, type CountSource } from '../domain/assessment'
import { CDAI_CATEGORIES, categoryLabel, formatScore, parseNumericInput } from '../domain/cdai'
import type { AssessmentRecord } from '../domain/records'
import CdaiCard, { CATEGORY_COLOR } from './CdaiCard'
import { Seg } from './controls'
import ScaleInput from './ScaleInput'
import { findingTags } from './status'

// ---------------------------------------------------------------------------------------
// Score tab
// ---------------------------------------------------------------------------------------

function CountField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number | null
  onChange(v: number | null): void
  disabled?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value === null ? '' : String(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(value === null ? '' : String(value))
    setError(null)
  }, [value])

  const commit = (raw: string) => {
    const n = parseNumericInput(raw)
    if (n === null) {
      setError(null)
      onChange(null)
    } else if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 28) {
      setError('Enter a whole number from 0 to 28.')
    } else {
      setError(null)
      onChange(n)
    }
  }

  return (
    <div className="count-field">
      <label htmlFor={id}>{label}</label>
      <div className="count-input">
        <button type="button" className="btn small" disabled={disabled || (value ?? 0) <= 0} onClick={() => onChange((value ?? 1) - 1)} aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={text}
          disabled={disabled}
          placeholder="0–28"
          aria-invalid={error !== null}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => e.key === 'Enter' && commit(text)}
        />
        <button type="button" className="btn small" disabled={disabled || (value ?? 0) >= 28} onClick={() => onChange((value ?? -1) + 1)} aria-label={`Increase ${label}`}>
          +
        </button>
        <span className="muted small">joints</span>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function ScorePanel({
  data,
  result,
  editable,
  onCountSource,
  onCount,
  onGlobal,
  onGoToJoints,
}: {
  data: AssessmentData
  result: AssessmentResult
  editable: boolean
  onCountSource(s: CountSource): void
  onCount(field: 'tjc28' | 'sjc28', v: number | null): void
  onGlobal(field: 'ptga' | 'prga', v: number | null): void
  onGoToJoints(): void
}) {
  const manual = data.countSource === 'manual'
  const c = result.counts.cdai
  return (
    <div className="score-panel">
      <section className="field-group">
        <h4>Joint counts</h4>
        <Seg<CountSource>
          label="Source of joint counts"
          value={data.countSource}
          disabled={!editable}
          onChange={onCountSource}
          options={[
            { value: 'joint-exam', label: 'From joint examination' },
            { value: 'manual', label: 'Enter counts manually' },
          ]}
        />
        {manual ? (
          <div className="count-grid">
            <CountField label="Tender joint count (TJC28)" value={data.manualCounts.tjc28} onChange={(v) => onCount('tjc28', v)} disabled={!editable} />
            <CountField label="Swollen joint count (SJC28)" value={data.manualCounts.sjc28} onChange={(v) => onCount('sjc28', v)} disabled={!editable} />
          </div>
        ) : (
          <div className="derived-counts">
            <div>
              <span className="big">{c.tender}</span>
              <span className="muted">tender (TJC28)</span>
            </div>
            <div>
              <span className="big">{c.swollen}</span>
              <span className="muted">swollen (SJC28)</span>
            </div>
            <div>
              <span className="big">
                {c.resolved}/{c.total}
              </span>
              <span className="muted">joints examined</span>
            </div>
          </div>
        )}
        {!manual && (
          <p className="small muted">
            Counted automatically from the 28-joint examination (shoulders, elbows, wrists, MCP 1–5, PIP 1–5, knees).
            Feet, ankles, hips, DIP and spine are never counted.{' '}
            <button type="button" className="link" onClick={onGoToJoints}>
              Go to joint examination
            </button>
          </p>
        )}
      </section>

      <section className="field-group">
        <h4>Global assessments</h4>
        <ScaleInput
          field="ptga"
          label="Patient global assessment (PtGA)"
          prompt="Ask the patient: “Considering all the ways arthritis affects you, how well are you doing?”"
          value={data.globals.ptga}
          onChange={(v) => onGlobal('ptga', v)}
          disabled={!editable}
        />
        <ScaleInput
          field="prga"
          label="Physician global assessment (PrGA)"
          prompt="Per medical opinion: “Considering all the ways arthritis affects the patient, how well are they doing?”"
          value={data.globals.prga}
          onChange={(v) => onGlobal('prga', v)}
          disabled={!editable}
        />
      </section>

      <CdaiCard result={result} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Review tab
// ---------------------------------------------------------------------------------------

function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Trend({ rows }: { rows: AssessmentRecord[] }) {
  const pts = rows.filter((r) => r.result.score !== null)
  if (pts.length < 2) return null
  const W = 320
  const H = 120
  const pad = { l: 28, r: 8, t: 8, b: 20 }
  const max = Math.max(30, ...pts.map((p) => p.result.score as number))
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`CDAI over ${pts.length} assessments: ${pts.map((p) => formatScore(p.result.score as number)).join(', ')}`}>
        {CDAI_CATEGORIES.map((c, i) => {
          const from = i === 0 ? 0 : CDAI_CATEGORIES[i - 1].upTo!
          const to = Math.min(c.upTo ?? max, max)
          if (from >= max) return null
          return <rect key={c.category} x={pad.l} width={W - pad.l - pad.r} y={y(to)} height={y(from) - y(to)} fill={CATEGORY_COLOR[c.category]} opacity={0.1} />
        })}
        {[0, 2.8, 10, 22].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#cbd5e1" strokeWidth="0.6" />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#64748b">
              {v}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#0f4c75" strokeWidth="1.6" points={pts.map((p, i) => `${x(i)},${y(p.result.score as number)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.result.score as number)} r="3.4" fill={CATEGORY_COLOR[p.result.category!]} stroke="#fff" strokeWidth="1" />
            <text x={x(i)} y={y(p.result.score as number) - 6} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#0f172a">
              {formatScore(p.result.score as number)}
            </text>
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="7.5" fill="#64748b">
              {fmtDate(p.consultationDate)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted small">
        CDAI per saved assessment. A change in score needs clinical context and is not by itself evidence of treatment
        success or failure.
      </figcaption>
    </figure>
  )
}

export function ReviewPanel({
  data,
  result,
  history,
  record,
  currentConsultationId,
  dirty,
  editable,
  onSelect,
  onNote,
}: {
  data: AssessmentData
  result: AssessmentResult
  history: AssessmentRecord[]
  record: AssessmentRecord | null
  currentConsultationId: string
  dirty: boolean
  editable: boolean
  onSelect(id: string): void
  onNote(n: string): void
}) {
  const manual = data.countSource === 'manual'
  const list = (pred: (id: string) => boolean, ids = Object.keys(JOINT_BY_ID)) =>
    ids.filter(pred).sort((a, b) => JOINT_BY_ID[a].order - JOINT_BY_ID[b].order)
  const f = (id: string) => data.joints[id] ?? EMPTY_FINDING

  const tender = list((id) => f(id).tenderness === 'tender' && !f(id).notAssessable)
  const swollen = list((id) => f(id).swelling === 'swollen' && !f(id).notAssessable)
  const pain = list((id) => f(id).pain === 'yes')
  const unexamined = CDAI28_JOINTS.map((j) => j.id).filter((id) => result.counts.cdai.unresolvedIds.includes(id))
  const na = list((id) => f(id).notAssessable)
  const notes = list((id) => f(id).note.trim() !== '')

  const JointList = ({ ids, empty }: { ids: string[]; empty: string }) =>
    ids.length === 0 ? (
      <p className="muted small">{empty}</p>
    ) : (
      <ul className="chip-list">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" className="chip-btn" onClick={() => onSelect(id)}>
              {JOINT_BY_ID[id].name}
              {!JOINT_BY_ID[id].cdai28 && <span className="muted"> (not in CDAI)</span>}
            </button>
          </li>
        ))}
      </ul>
    )

  const rows = history
  const complete = result.status === 'complete'

  return (
    <div className="review-panel">
      <section className="review-summary" aria-label="Assessment summary">
        <div>
          <span className="muted small">CDAI</span>
          <strong className="review-score" style={{ color: complete ? CATEGORY_COLOR[result.category!] : undefined }}>
            {complete ? formatScore(result.score!) : 'Incomplete'}
          </strong>
          <span>{complete ? categoryLabel(result.category!) : `${result.problems.length} item(s) outstanding`}</span>
        </div>
        <dl>
          <dt>TJC28</dt>
          <dd>{result.tjc28 ?? '—'}</dd>
          <dt>SJC28</dt>
          <dd>{result.sjc28 ?? '—'}</dd>
          <dt>PtGA</dt>
          <dd>{result.ptga ?? '—'}</dd>
          <dt>PrGA</dt>
          <dd>{result.prga ?? '—'}</dd>
        </dl>
      </section>
      {manual && <p className="small muted">Counts were entered manually; the joint findings below are documentation only.</p>}
      {dirty && <p className="small warn-text">This review reflects your current, unsaved entries.</p>}

      <section className="review-section">
        <h4>Tender joints ({tender.length})</h4>
        <JointList ids={tender} empty="No tender joints recorded." />
      </section>
      <section className="review-section">
        <h4>Swollen joints ({swollen.length})</h4>
        <JointList ids={swollen} empty="No swollen joints recorded." />
      </section>
      <section className="review-section">
        <h4>Patient-reported pain ({pain.length})</h4>
        {pain.length === 0 ? (
          <p className="muted small">No pain locations recorded.</p>
        ) : (
          <ul className="chip-list">
            {pain.map((id) => (
              <li key={id}>
                <button type="button" className="chip-btn pain" onClick={() => onSelect(id)}>
                  {JOINT_BY_ID[id].name}
                  {f(id).painIntensity !== null ? ` · ${f(id).painIntensity}/10` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Pain intensity is documentation only and is not part of the CDAI.</p>
      </section>
      <section className="review-section">
        <h4>28-joint set not yet examined ({unexamined.length})</h4>
        <JointList ids={unexamined} empty="Every joint in the 28-joint set has both findings recorded." />
      </section>
      {na.length > 0 && (
        <section className="review-section">
          <h4>Not assessable ({na.length})</h4>
          <JointList ids={na} empty="" />
        </section>
      )}
      {notes.length > 0 && (
        <section className="review-section">
          <h4>Joint notes</h4>
          <ul className="notes">
            {notes.map((id) => (
              <li key={id}>
                <button type="button" className="link" onClick={() => onSelect(id)}>
                  {JOINT_BY_ID[id].name}
                </button>
                : {f(id).note} <span className="muted">({findingTags(f(id)).map((t) => t.text).join(', ')})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="review-section">
        <label className="field-label" htmlFor="general-note">
          Assessment note
        </label>
        <textarea
          id="general-note"
          rows={3}
          value={data.note}
          maxLength={1000}
          disabled={!editable}
          placeholder="Optional overall comment for this assessment"
          onChange={(e) => onNote(e.target.value)}
        />
      </section>

      <section className="review-section">
        <h4>Assessment history</h4>
        {rows.length === 0 ? (
          <p className="muted small">No saved assessments for this patient yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="history">
              <thead>
                <tr>
                  <th>Visit</th>
                  <th>CDAI</th>
                  <th>Category</th>
                  <th>TJC</th>
                  <th>SJC</th>
                  <th>PtGA</th>
                  <th>PrGA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-current={r.consultationId === currentConsultationId}>
                    <td>
                      {fmtDate(r.consultationDate)}
                      {r.consultationId === currentConsultationId && <span className="pill neutral">this visit</span>}
                    </td>
                    <td className="num">{r.result.score === null ? '—' : formatScore(r.result.score)}</td>
                    <td>
                      {r.result.category ? (
                        <span style={{ color: CATEGORY_COLOR[r.result.category] }}>{categoryLabel(r.result.category).replace(' disease activity', '')}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{r.result.tjc28 ?? '—'}</td>
                    <td className="num">{r.result.sjc28 ?? '—'}</td>
                    <td className="num">{r.result.ptga ?? '—'}</td>
                    <td className="num">{r.result.prga ?? '—'}</td>
                    <td>
                      {r.status === 'finalized' ? 'Final' : r.result.complete ? 'Draft' : 'Incomplete'}
                      {r.revision > 1 && r.history.length > 0 ? ` · rev ${r.revision}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Trend rows={rows} />
      </section>

      {record && record.history.length > 0 && (
        <section className="review-section">
          <h4>Revision history — this assessment</h4>
          <ol className="revisions">
            {[...record.history].reverse().map((h) => (
              <li key={h.revision}>
                <b>Revision {h.revision}</b> · {fmtDateTime(h.savedAt)} · {h.savedBy.name} · CDAI{' '}
                {h.result.score === null ? '—' : formatScore(h.result.score)}
                {h.reason ? <div className="muted small">Reason for the later amendment is recorded on the next revision.</div> : null}
              </li>
            ))}
            <li>
              <b>Revision {record.revision} (current)</b> · {fmtDateTime(record.updatedAt)} · {record.updatedBy.name} · CDAI{' '}
              {record.result.score === null ? '—' : formatScore(record.result.score)}
              {record.amendmentReason ? <div className="small">Amendment reason: {record.amendmentReason}</div> : null}
            </li>
          </ol>
        </section>
      )}
    </div>
  )
}
