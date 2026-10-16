import { useState } from 'react'
import type { AssessmentData, AssessmentResult } from '../../domain/assessment'
import { CDAI_CATEGORIES, CDAI_MAX_SCORE, categoryLabel, formatScore } from '../../domain/cdai'
import { JOINT_BY_ID } from '../../domain/joints'
import type { AssessmentRecord } from '../../domain/records'
import { CATEGORY_COLOR, CATEGORY_PLAIN } from '../theme'

interface Props {
  data: AssessmentData
  result: AssessmentResult
  record: AssessmentRecord | null
  history: AssessmentRecord[]
  currentConsultationId: string
  onGoJoints(): void
  onGoRating(): void
}

const dateOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Trend({ rows }: { rows: AssessmentRecord[] }) {
  const pts = rows.filter((r) => r.result.score !== null)
  if (pts.length < 2) return null
  const W = 300
  const H = 100
  const max = Math.max(30, ...pts.map((p) => p.result.score as number))
  const x = (i: number) => 20 + (i / (pts.length - 1)) * (W - 40)
  const y = (v: number) => 10 + (1 - v / max) * (H - 28)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={`CDAI over time: ${pts.map((p) => formatScore(p.result.score as number)).join(', ')}`}>
      <polyline fill="none" stroke="#0f4c75" strokeWidth="2" points={pts.map((p, i) => `${x(i)},${y(p.result.score as number)}`).join(' ')} />
      {pts.map((p, i) => (
        <g key={p.id}>
          <circle cx={x(i)} cy={y(p.result.score as number)} r="4" fill={CATEGORY_COLOR[p.result.category!]} stroke="#fff" />
          <text x={x(i)} y={y(p.result.score as number) - 8} textAnchor="middle" fontSize="10" fontWeight="700">
            {formatScore(p.result.score as number)}
          </text>
        </g>
      ))}
    </svg>
  )
}

export default function ResultStep({ data, result, record, history, currentConsultationId, onGoJoints, onGoRating }: Props) {
  const [open, setOpen] = useState(false)
  const complete = result.status === 'complete' && result.score !== null
  const cat = result.category
  const f = (id: string) => data.joints[id]
  const ids = Object.keys(data.joints).sort((a, b) => JOINT_BY_ID[a].order - JOINT_BY_ID[b].order)
  const tender = ids.filter((id) => f(id).tenderness === 'tender' && !f(id).notAssessable)
  const swollen = ids.filter((id) => f(id).swelling === 'swollen' && !f(id).notAssessable)
  const pain = ids.filter((id) => f(id).pain === 'yes')
  const c = result.counts.cdai
  const jointsMissing = result.countSource === 'joint-exam' && c.unresolvedIds.length > 0
  const ratingMissing = result.ptga === null || result.prga === null
  const countsMissing = result.countSource === 'manual' && (result.tjc28 === null || result.sjc28 === null)

  return (
    <div className="step-body">
      {complete ? (
        <section className="result-card" style={{ borderColor: CATEGORY_COLOR[cat!] }} aria-live="polite">
          <div className="result-number" style={{ color: CATEGORY_COLOR[cat!] }} data-testid="cdai-score">
            {formatScore(result.score!)}
          </div>
          <div className="result-cat" style={{ background: CATEGORY_COLOR[cat!] }} data-testid="cdai-category">
            {categoryLabel(cat!)}
          </div>
          <p className="result-plain">{CATEGORY_PLAIN[cat!]}</p>
        </section>
      ) : (
        <section className="result-card pending" aria-live="polite">
          <div className="result-number unset" data-testid="cdai-score">
            —
          </div>
          <div className="result-cat incomplete" data-testid="cdai-category">
            Not finished yet
          </div>
          <p className="result-plain">The score appears once everything below is done:</p>
          <ul className="todo">
            {jointsMissing && (
              <li>
                {c.unresolvedIds.length} joint{c.unresolvedIds.length === 1 ? '' : 's'} still to check{' '}
                <button type="button" className="link" onClick={onGoJoints}>
                  Go to joints
                </button>
              </li>
            )}
            {countsMissing && (
              <li>
                Joint counts are missing{' '}
                <button type="button" className="link" onClick={onGoRating}>
                  Enter them
                </button>
              </li>
            )}
            {ratingMissing && (
              <li>
                {result.ptga === null && result.prga === null ? "Patient's and doctor's ratings" : result.ptga === null ? "Patient's rating" : "Doctor's rating"} missing{' '}
                <button type="button" className="link" onClick={onGoRating}>
                  Go to ratings
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="sum-line" aria-label="How the score adds up">
        <span>
          <b>{result.tjc28 ?? '—'}</b> tender
        </span>
        <i>+</i>
        <span>
          <b>{result.sjc28 ?? '—'}</b> swollen
        </span>
        <i>+</i>
        <span>
          <b>{result.ptga === null ? '—' : result.ptga.toFixed(1)}</b> patient
        </span>
        <i>+</i>
        <span>
          <b>{result.prga === null ? '—' : result.prga.toFixed(1)}</b> doctor
        </span>
        <i>=</i>
        <span>
          <b>{complete ? formatScore(result.score!) : '?'}</b>
        </span>
      </section>

      <button type="button" className="link details-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▾ Hide details' : '▸ Show details'}
      </button>

      {open && (
        <div className="details">
          <h4>Findings</h4>
          <p>
            <b>Tender:</b> {tender.length ? tender.map((id) => JOINT_BY_ID[id].name).join(', ') : 'none recorded'}
          </p>
          <p>
            <b>Swollen:</b> {swollen.length ? swollen.map((id) => JOINT_BY_ID[id].name).join(', ') : 'none recorded'}
          </p>
          <p>
            <b>Pain reported:</b>{' '}
            {pain.length ? pain.map((id) => `${JOINT_BY_ID[id].name}${f(id).painIntensity !== null ? ` (${f(id).painIntensity}/10)` : ''}`).join(', ') : 'none recorded'}
          </p>
          <p className="muted">Pain level and joints outside the 28-joint set are not part of the score.</p>

          <h4>Scale</h4>
          <table className="scale-table">
            <tbody>
              {CDAI_CATEGORIES.map((k) => (
                <tr key={k.category} data-active={cat === k.category}>
                  <td>
                    <span className="swatch" style={{ background: CATEGORY_COLOR[k.category] }} />
                    {k.label}
                  </td>
                  <td>{k.range}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            CDAI = tender joints + swollen joints + patient rating + doctor rating (0–{CDAI_MAX_SCORE}). It is a measurement, not
            a diagnosis or a treatment recommendation.
          </p>

          <h4>Previous assessments</h4>
          {history.length === 0 ? (
            <p className="muted">None saved yet for this patient.</p>
          ) : (
            <>
              <table className="history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>CDAI</th>
                    <th>Level</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r) => (
                    <tr key={r.id} data-current={r.consultationId === currentConsultationId}>
                      <td>{dateOf(r.consultationDate)}</td>
                      <td>{r.result.score === null ? '—' : formatScore(r.result.score)}</td>
                      <td>{r.result.category ? categoryLabel(r.result.category).replace(' disease activity', '') : '—'}</td>
                      <td>{r.status === 'finalized' ? 'Final' : r.result.complete ? 'Draft' : 'Incomplete'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Trend rows={history} />
            </>
          )}

          {record && record.history.length > 0 && (
            <>
              <h4>Changes to this assessment</h4>
              <ol className="revisions">
                {[...record.history].reverse().map((h) => (
                  <li key={h.revision}>
                    Version {h.revision} · {h.savedBy.name} · CDAI {h.result.score === null ? '—' : formatScore(h.result.score)}
                  </li>
                ))}
                <li>
                  <b>Current</b> · {record.updatedBy.name} · CDAI {record.result.score === null ? '—' : formatScore(record.result.score)}
                  {record.amendmentReason && <div>Reason for change: {record.amendmentReason}</div>}
                </li>
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  )
}
