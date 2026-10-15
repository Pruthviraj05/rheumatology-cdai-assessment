import type { JointFinding, PainState, SwellState, TenderState } from '../domain/assessment'
import type { JointDef } from '../domain/joints'
import { Seg } from './controls'
import { findingTags } from './status'

interface Props {
  joint: JointDef | null
  finding: JointFinding
  editable: boolean
  position: { index: number; total: number } | null
  onChange(patch: Partial<JointFinding>): void
  onClear(): void
  onNormalNext(): void
  onPrev(): void
  onNext(): void
  onNextUnexamined(): void
  onStart(): void
}

const SIDE_LABEL = { L: 'Left', R: 'Right', C: 'Midline' } as const

export default function JointEditor({
  joint,
  finding,
  editable,
  position,
  onChange,
  onClear,
  onNormalNext,
  onPrev,
  onNext,
  onNextUnexamined,
  onStart,
}: Props) {
  if (!joint) {
    return (
      <div className="empty-editor">
        <h3>Select a joint</h3>
        <p>
          Click a marker on the body, pick a joint from the list, or start the guided examination. Findings are recorded
          immediately — no dialogs.
        </p>
        <button type="button" className="btn primary" onClick={onStart} disabled={!editable}>
          Start examination
        </button>
        <ul className="hint-list">
          <li>
            <kbd>T</kbd> toggle tender · <kbd>S</kbd> toggle swollen
          </li>
          <li>
            <kbd>N</kbd> normal &amp; next · <kbd>←</kbd> <kbd>→</kbd> previous / next joint
          </li>
        </ul>
      </div>
    )
  }

  const disabled = !editable
  const tags = findingTags(finding)

  return (
    <div className="editor" data-joint={joint.id}>
      <div className="editor-head">
        <div>
          <h3 data-testid="selected-joint-name">{joint.name}</h3>
          <p className="muted small">
            {SIDE_LABEL[joint.side]} · {joint.group.toUpperCase()}
            {position ? ` · ${position.index} of ${position.total} in 28-joint set` : ''}
          </p>
        </div>
        <span className={`pill ${joint.cdai28 ? 'cdai' : 'neutral'}`}>
          {joint.cdai28 ? 'CDAI 28-joint set' : 'Pain map only · not in CDAI'}
        </span>
      </div>

      <div className="editor-nav">
        <button type="button" className="btn small" onClick={onPrev} aria-label="Previous joint">
          ← Prev
        </button>
        <button type="button" className="btn small" onClick={onNext} aria-label="Next joint">
          Next →
        </button>
        <button type="button" className="btn small ghost" onClick={onNextUnexamined}>
          Next unexamined
        </button>
      </div>

      <div className="tag-row" aria-label="Recorded findings summary">
        {tags.map((t) => (
          <span key={t.text} className={`tag ${t.tone}`}>
            {t.text}
          </span>
        ))}
      </div>

      <section className="field-group">
        <h4>
          Patient-reported <span className="source-tag patient">Patient</span>
        </h4>
        <div className="field">
          <span className="field-label" id="pain-l">
            Pain at this joint
          </span>
          <Seg<PainState>
            label="Pain reported"
            value={finding.pain}
            disabled={disabled}
            onChange={(v) => onChange({ pain: v })}
            options={[
              { value: 'yes', label: 'Yes', tone: 'pain' },
              { value: 'no', label: 'No' },
              { value: 'unknown', label: 'Unknown' },
            ]}
          />
        </div>
        {finding.pain === 'yes' && (
          <div className="field">
            <span className="field-label">
              Pain intensity <span className="muted">(optional, 0–10, not part of CDAI)</span>
            </span>
            <div className="scale-buttons compact" role="group" aria-label="Pain intensity">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  aria-pressed={finding.painIntensity === n}
                  onClick={() => onChange({ painIntensity: finding.painIntensity === n ? null : n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="field-group">
        <h4>
          Physician examination <span className="source-tag clinician">Clinician</span>
        </h4>
        <div className="field">
          <span className="field-label">Tenderness</span>
          <Seg<TenderState>
            label="Tenderness"
            value={finding.tenderness}
            disabled={disabled || finding.notAssessable}
            onChange={(v) => onChange({ tenderness: v })}
            options={[
              { value: 'tender', label: 'Tender', tone: 'tender' },
              { value: 'not_tender', label: 'Not tender', tone: 'normal' },
              { value: 'unknown', label: 'Not examined', tone: 'muted' },
            ]}
          />
        </div>
        <div className="field">
          <span className="field-label">Swelling</span>
          <Seg<SwellState>
            label="Swelling"
            value={finding.swelling}
            disabled={disabled || finding.notAssessable}
            onChange={(v) => onChange({ swelling: v })}
            options={[
              { value: 'swollen', label: 'Swollen', tone: 'swollen' },
              { value: 'not_swollen', label: 'Not swollen', tone: 'normal' },
              { value: 'unknown', label: 'Not examined', tone: 'muted' },
            ]}
          />
        </div>
        <div className="quick-row">
          <button type="button" className="btn primary" disabled={disabled} onClick={onNormalNext}>
            ✓ Normal &amp; next <kbd>N</kbd>
          </button>
          <button type="button" className="btn ghost" disabled={disabled} onClick={onClear}>
            Reset joint
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            disabled={disabled}
            checked={finding.notAssessable}
            onChange={(e) => onChange({ notAssessable: e.target.checked })}
          />
          <span>
            Joint not assessable <span className="muted">(prosthesis, fusion, amputation) — not counted</span>
          </span>
        </label>
      </section>

      <section className="field-group">
        <label className="field-label" htmlFor="joint-note">
          Examination note
        </label>
        <textarea
          id="joint-note"
          rows={3}
          disabled={disabled}
          value={finding.note}
          maxLength={500}
          placeholder="Optional — e.g. warmth, crepitus, limited range"
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </section>
    </div>
  )
}
