import { useState } from 'react'
import type { AssessmentResult } from '../domain/assessment'
import {
  CDAI_CATEGORIES,
  CDAI_MAX_SCORE,
  categoryLabel,
  formatScore,
  type CdaiCategory,
} from '../domain/cdai'

export const CATEGORY_COLOR: Record<CdaiCategory, string> = {
  remission: '#15803d',
  low: '#4d7c0f',
  moderate: '#b45309',
  high: '#b91c1c',
}

const fmt = (n: number | null, digits = 0) => (n === null ? '—' : digits ? n.toFixed(digits) : String(n))

/** Prominent live score: equation, category, scale and an expandable calculation breakdown. */
export default function CdaiCard({ result, compact }: { result: AssessmentResult; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const complete = result.status === 'complete' && result.score !== null
  const cat = result.category

  const parts: { key: string; label: string; value: string; sub: string }[] = [
    { key: 'tjc', label: 'TJC28', value: fmt(result.tjc28), sub: 'tender joints' },
    { key: 'sjc', label: 'SJC28', value: fmt(result.sjc28), sub: 'swollen joints' },
    { key: 'pt', label: 'PtGA', value: fmt(result.ptga, 1), sub: 'patient global' },
    { key: 'pr', label: 'PrGA', value: fmt(result.prga, 1), sub: 'physician global' },
  ]

  const pct = complete ? Math.min(100, (result.score! / CDAI_MAX_SCORE) * 100) : null

  return (
    <section className={`cdai-card${compact ? ' compact' : ''}`} aria-labelledby="cdai-heading" data-status={result.status}>
      <div className="cdai-head">
        <h3 id="cdai-heading">CDAI</h3>
        <span className="muted small">Clinical Disease Activity Index · range 0–76</span>
      </div>

      <div className="cdai-main">
        <div className="cdai-score" aria-live="polite" aria-atomic="true">
          {complete ? (
            <>
              <span className="cdai-number" style={{ color: CATEGORY_COLOR[cat!] }} data-testid="cdai-score">
                {formatScore(result.score!)}
              </span>
              <span className="cdai-cat" style={{ background: CATEGORY_COLOR[cat!] }} data-testid="cdai-category">
                {categoryLabel(cat!)}
              </span>
            </>
          ) : (
            <>
              <span className="cdai-number unset" data-testid="cdai-score">
                —
              </span>
              <span className="cdai-cat incomplete" data-testid="cdai-category">
                Incomplete
              </span>
            </>
          )}
        </div>
      </div>

      <div className="equation" role="group" aria-label="Score calculation">
        {parts.map((p, i) => (
          <div className="eq-part" key={p.key}>
            {i > 0 && <span className="eq-op">+</span>}
            <div className="eq-box">
              <span className="eq-label">{p.label}</span>
              <span className={`eq-value${p.value === '—' ? ' unset' : ''}`}>{p.value}</span>
              <span className="eq-sub">{p.sub}</span>
            </div>
          </div>
        ))}
        <div className="eq-part">
          <span className="eq-op">=</span>
          <div className="eq-box total">
            <span className="eq-label">CDAI</span>
            <span className={`eq-value${complete ? '' : ' unset'}`}>{complete ? formatScore(result.score!) : '?'}</span>
            <span className="eq-sub">total</span>
          </div>
        </div>
      </div>

      {!complete && (
        <div className="incomplete-box">
          <strong>Not yet a CDAI.</strong> The score is only shown when every component is recorded.
          <ul>
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {result.partialSum > 0 && (
            <p className="muted small">Sum of components entered so far: {formatScore(result.partialSum)} (not a CDAI).</p>
          )}
        </div>
      )}

      <div className="cdai-scale" aria-hidden="true">
        <div className="cdai-bar">
          {CDAI_CATEGORIES.map((c, i) => {
            const from = i === 0 ? 0 : CDAI_CATEGORIES[i - 1].upTo!
            const to = c.upTo ?? CDAI_MAX_SCORE
            return (
              <span
                key={c.category}
                style={{ width: `${((to - from) / CDAI_MAX_SCORE) * 100}%`, background: CATEGORY_COLOR[c.category] }}
              />
            )
          })}
          {pct !== null && <i className="cdai-pin" style={{ left: `${pct}%` }} />}
        </div>
      </div>
      <table className="cdai-legend">
        <caption className="sr-only">CDAI disease activity categories</caption>
        <tbody>
          {CDAI_CATEGORIES.map((c) => (
            <tr key={c.category} data-active={cat === c.category}>
              <td>
                <span className="swatch" style={{ background: CATEGORY_COLOR[c.category] }} />
                {c.label}
              </td>
              <td className="num">{c.range}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} calculation breakdown
      </button>
      {open && (
        <div className="breakdown">
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Value</th>
                <th>Source</th>
                <th>Valid range</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tender joint count (TJC28)</td>
                <td className="num">{fmt(result.tjc28)}</td>
                <td>{result.countSource === 'manual' ? 'Entered manually' : 'Counted from joint examination'}</td>
                <td>0–28 joints</td>
              </tr>
              <tr>
                <td>Swollen joint count (SJC28)</td>
                <td className="num">{fmt(result.sjc28)}</td>
                <td>{result.countSource === 'manual' ? 'Entered manually' : 'Counted from joint examination'}</td>
                <td>0–28 joints</td>
              </tr>
              <tr>
                <td>Patient global (PtGA)</td>
                <td className="num">{fmt(result.ptga, 1)}</td>
                <td>Patient, 0 = very well</td>
                <td>0–10</td>
              </tr>
              <tr>
                <td>Physician global (PrGA)</td>
                <td className="num">{fmt(result.prga, 1)}</td>
                <td>Clinician, 0 = very well</td>
                <td>0–10</td>
              </tr>
            </tbody>
          </table>
          <p className="small">
            <strong>CDAI = TJC28 + SJC28 + PtGA + PrGA.</strong> Classification uses the unrounded total: remission ≤ 2.8,
            low &gt; 2.8–10, moderate &gt; 10–22, high &gt; 22. CRP and ESR are not part of the CDAI.
          </p>
          <p className="muted small">
            Source: Aletaha D, Smolen J. et al., as published on MDCalc (Clinical Disease Activity Index for Rheumatoid
            Arthritis). The score is a clinical measurement, not a diagnosis or a treatment recommendation.
          </p>
        </div>
      )}
    </section>
  )
}
