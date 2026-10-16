import { useEffect, useRef, useState } from 'react'
import type { AssessmentData, AssessmentResult } from '../../domain/assessment'

function Rating({
  id,
  title,
  question,
  value,
  disabled,
  onChange,
}: {
  id: string
  title: string
  question: string
  value: number | null
  disabled: boolean
  onChange(v: number | null): void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const commitFromInput = () => {
    if (ref.current) onChange(Number(ref.current.value))
  }
  const step = (d: number) => onChange(Math.min(10, Math.max(0, (value ?? (d > 0 ? -0.5 : 0.5)) + d)))

  return (
    <section className="rating-card" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{title}</h3>
      <p className="rating-q">{question}</p>
      <div className="rating-value" aria-live="polite" data-testid={`${id}-value`}>
        {value === null ? <span className="unset">Not rated yet</span> : <span>{value.toFixed(1)}</span>}
      </div>
      <div className="slider-row">
        <button type="button" className="round" disabled={disabled || (value ?? 0) <= 0} onClick={() => step(-0.5)} aria-label={`${title}: lower`}>
          −
        </button>
        <input
          ref={ref}
          id={id}
          type="range"
          min={0}
          max={10}
          step={0.5}
          disabled={disabled}
          className={value === null ? 'unset' : ''}
          value={value ?? 0}
          aria-label={title}
          aria-valuetext={value === null ? 'Not rated' : String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={commitFromInput}
          onKeyUp={(e) => {
            if (value === null && (e.key === 'Home' || e.key === 'ArrowLeft' || e.key === 'ArrowDown')) commitFromInput()
          }}
        />
        <button type="button" className="round" disabled={disabled || (value ?? 0) >= 10} onClick={() => step(0.5)} aria-label={`${title}: higher`}>
          +
        </button>
      </div>
      <div className="slider-ends">
        <span>0 · Very well</span>
        <span>10 · Very poor</span>
      </div>
      {value !== null && (
        <button type="button" className="link" disabled={disabled} onClick={() => onChange(null)}>
          Clear rating
        </button>
      )}
    </section>
  )
}

function CountInput({ label, value, disabled, onChange }: { label: string; value: number | null; disabled: boolean; onChange(v: number | null): void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [err, setErr] = useState(false)
  useEffect(() => {
    setText(value === null ? '' : String(value))
    setErr(false)
  }, [value])
  const commit = () => {
    if (text.trim() === '') {
      setErr(false)
      onChange(null)
      return
    }
    const n = Number(text)
    if (!Number.isInteger(n) || n < 0 || n > 28) setErr(true)
    else {
      setErr(false)
      onChange(n)
    }
  }
  return (
    <label className="count-box">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={text}
        disabled={disabled}
        placeholder="0–28"
        aria-invalid={err}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {err && <em role="alert">Enter a whole number from 0 to 28</em>}
    </label>
  )
}

interface Props {
  data: AssessmentData
  result: AssessmentResult
  editable: boolean
  onGlobal(field: 'ptga' | 'prga', v: number | null): void
  onCountSource(s: 'joint-exam' | 'manual'): void
  onCount(field: 'tjc28' | 'sjc28', v: number | null): void
  onGoJoints(): void
}

export default function RatingStep({ data, result, editable, onGlobal, onCountSource, onCount, onGoJoints }: Props) {
  const manual = data.countSource === 'manual'
  const c = result.counts.cdai
  return (
    <div className="step-body">
      <h2 className="step-title">How is the patient doing overall?</h2>
      <p className="step-help">Two quick ratings from 0 (very well) to 10 (very poor).</p>

      <Rating
        id="ptga"
        title="Patient's rating"
        question="“Considering all the ways arthritis affects you, how well are you doing?”"
        value={data.globals.ptga}
        disabled={!editable}
        onChange={(v) => onGlobal('ptga', v)}
      />
      <Rating
        id="prga"
        title="Doctor's rating"
        question="Considering all the ways arthritis affects the patient, how well are they doing?"
        value={data.globals.prga}
        disabled={!editable}
        onChange={(v) => onGlobal('prga', v)}
      />

      <section className="counts-card">
        <h3>Joint counts</h3>
        {manual ? (
          <>
            <div className="count-pair">
              <CountInput label="Tender joints" value={data.manualCounts.tjc28} disabled={!editable} onChange={(v) => onCount('tjc28', v)} />
              <CountInput label="Swollen joints" value={data.manualCounts.sjc28} disabled={!editable} onChange={(v) => onCount('sjc28', v)} />
            </div>
            <button type="button" className="link" disabled={!editable} onClick={() => onCountSource('joint-exam')}>
              Use the joint check instead
            </button>
          </>
        ) : (
          <>
            <p>
              From the joint check: <b>{c.tender}</b> tender · <b>{c.swollen}</b> swollen
              {c.unresolvedIds.length > 0 && (
                <>
                  {' '}
                  <span className="warn">({c.unresolvedIds.length} joints not checked yet)</span>
                </>
              )}
            </p>
            <div className="link-row">
              {c.unresolvedIds.length > 0 && (
                <button type="button" className="link" onClick={onGoJoints}>
                  Go back to the joints
                </button>
              )}
              <button type="button" className="link" disabled={!editable} onClick={() => onCountSource('manual')}>
                Type the counts instead
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
