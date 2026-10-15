import { useEffect, useId, useState } from 'react'
import { parseNumericInput, validateComponent, type CdaiField } from '../domain/cdai'

interface Props {
  field: 'ptga' | 'prga'
  label: string
  prompt: string
  value: number | null
  onChange(v: number | null): void
  disabled?: boolean
}

const STEPS = Array.from({ length: 11 }, (_, i) => i)

/**
 * 0–10 global assessment input: quick integer buttons, a half-point toggle (MDCalc uses 0.5 steps)
 * and an exact entry field. "Not set" is a real state — it is never shown or saved as zero.
 */
export default function ScaleInput({ field, label, prompt, value, onChange, disabled }: Props) {
  const id = useId()
  const [text, setText] = useState(value === null ? '' : String(value))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(value === null ? '' : String(value))
    setError(null)
  }, [value])

  const whole = value === null ? null : Math.floor(value)
  const half = value !== null && Math.abs(value - Math.floor(value) - 0.5) < 1e-9

  const commit = (raw: string) => {
    const parsed = parseNumericInput(raw)
    if (parsed === null) {
      setError(null)
      onChange(null)
      return
    }
    const issue = validateComponent(field as CdaiField, parsed)
    if (issue || Number.isNaN(parsed)) {
      setError(Number.isNaN(parsed) ? 'Enter a number from 0 to 10.' : issue!.message.replace(/^.*? must/, 'Value must'))
      return
    }
    setError(null)
    onChange(parsed)
  }

  return (
    <fieldset className="scale" disabled={disabled}>
      <legend>{label}</legend>
      <p className="scale-prompt">{prompt}</p>
      <div className="scale-top">
        <output className={`scale-value${value === null ? ' unset' : ''}`} aria-live="polite" htmlFor={id}>
          {value === null ? 'Not set' : value.toFixed(1)}
        </output>
        <div className="scale-anchors">
          <span>0 = very well</span>
          <span>10 = very poor</span>
        </div>
      </div>
      <div className="scale-buttons" role="group" aria-label={`${label}, whole points`}>
        {STEPS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={whole === n}
            onClick={() => onChange(half && n < 10 ? n + 0.5 : n)}
            aria-label={`${n}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="scale-actions">
        <button
          type="button"
          className="btn small"
          aria-pressed={half}
          disabled={value === null || whole === 10}
          onClick={() => onChange(half ? (whole as number) : (whole as number) + 0.5)}
          title="Add or remove half a point"
        >
          +0.5
        </button>
        <label className="exact" htmlFor={id}>
          <span>Exact</span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder="0–10"
            aria-invalid={error !== null}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(text)
            }}
          />
        </label>
        <button type="button" className="btn small ghost" disabled={value === null} onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
