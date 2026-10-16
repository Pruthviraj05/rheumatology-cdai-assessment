import type { AssessmentResult, JointFinding } from '../../domain/assessment'
import type { JointDef } from '../../domain/joints'

interface Props {
  joint: JointDef | null
  finding: JointFinding
  editable: boolean
  result: AssessmentResult
  /** 1-based position inside the 28-joint set, or null for pain-map joints. */
  position: number | null
  canUndo: boolean
  onUndo(): void
  onAnswer(patch: Partial<JointFinding>): void
  onPrev(): void
  onNext(): void
  onStart(): void
  onRemainingNormal(): void
  onGoRating(): void
}

function YesNo({
  label,
  hint,
  yesLabel,
  value,
  yesValue,
  noValue,
  tone,
  disabled,
  onPick,
}: {
  label: string
  hint: string
  yesLabel: string
  value: string
  yesValue: string
  noValue: string
  tone: 'tender' | 'swollen'
  disabled: boolean
  onPick(v: string): void
}) {
  return (
    <div className="question">
      <div className="q-text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="yesno" role="group" aria-label={label}>
        <button type="button" disabled={disabled} aria-pressed={value === yesValue} data-tone={tone} onClick={() => onPick(value === yesValue ? 'unknown' : yesValue)}>
          {yesLabel}
        </button>
        <button type="button" disabled={disabled} aria-pressed={value === noValue} data-tone="no" onClick={() => onPick(value === noValue ? 'unknown' : noValue)}>
          No
        </button>
      </div>
    </div>
  )
}

export default function ExamStep({
  joint,
  finding,
  editable,
  result,
  position,
  canUndo,
  onUndo,
  onAnswer,
  onPrev,
  onNext,
  onStart,
  onRemainingNormal,
  onGoRating,
}: Props) {
  const c = result.counts.cdai
  const allDone = c.unresolvedIds.length === 0
  const pct = Math.round((c.resolved / c.total) * 100)
  const manual = result.countSource === 'manual'

  return (
    <div className="step-body">
      <div className="progress" aria-label="Examination progress">
        <div className="progress-text">
          <strong data-testid="progress-count">
            {c.resolved} of {c.total}
          </strong>{' '}
          joints checked
          {canUndo && (
            <button type="button" className="link undo" onClick={onUndo}>
              ↶ Undo
            </button>
          )}
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.resolved} aria-label="Joints checked">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      {manual && (
        <p className="note-box">
          You chose to type the joint counts yourself (step 2). The joint check below is optional documentation.
        </p>
      )}

      {!joint ? (
        <div className="start-card">
          {allDone ? (
            <>
              <h2>All 28 joints checked ✓</h2>
              <p>
                {c.tender} tender · {c.swollen} swollen. You can still tap any joint on the body to change an answer.
              </p>
              <button type="button" className="btn big primary" onClick={onGoRating}>
                Continue to overall rating →
              </button>
            </>
          ) : (
            <>
              <h2>{c.resolved === 0 ? "Let's check the joints" : 'Continue the joint check'}</h2>
              <p>
                We go through the 28 joints one at a time. For each one, answer two quick questions: <b>tender?</b> and{' '}
                <b>swollen?</b> You can also tap a joint on the body.
              </p>
              <button type="button" className="btn big primary" onClick={onStart} disabled={!editable}>
                {c.resolved === 0 ? 'Start' : 'Continue'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="joint-card" data-joint={joint.id}>
          <div className="joint-title">
            <h2 data-testid="selected-joint-name">{joint.name}</h2>
            <span className="joint-sub">
              {position ? `Joint ${position} of 28` : 'Extra joint — not counted in the score'}
            </span>
          </div>

          <YesNo
            label="Is it tender?"
            hint="Painful when pressed"
            yesLabel="Yes, tender"
            value={finding.tenderness}
            yesValue="tender"
            noValue="not_tender"
            tone="tender"
            disabled={!editable || finding.notAssessable}
            onPick={(v) => onAnswer({ tenderness: v as JointFinding['tenderness'] })}
          />
          <YesNo
            label="Is it swollen?"
            hint="Puffy, visible or felt"
            yesLabel="Yes, swollen"
            value={finding.swelling}
            yesValue="swollen"
            noValue="not_swollen"
            tone="swollen"
            disabled={!editable || finding.notAssessable}
            onPick={(v) => onAnswer({ swelling: v as JointFinding['swelling'] })}
          />

          <details className="more">
            <summary>More options</summary>
            <div className="more-body">
              <div className="question compact">
                <div className="q-text">
                  <strong>Does the patient report pain here?</strong>
                </div>
                <div className="yesno small" role="group" aria-label="Pain reported by patient">
                  {(['yes', 'no'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={!editable}
                      aria-pressed={finding.pain === v}
                      data-tone={v === 'yes' ? 'pain' : 'no'}
                      onClick={() => onAnswer({ pain: finding.pain === v ? 'unknown' : v })}
                    >
                      {v === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
              {finding.pain === 'yes' && (
                <label className="range-line">
                  <span>Pain level (0–10, not part of the score)</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    disabled={!editable}
                    value={finding.painIntensity ?? 0}
                    onChange={(e) => onAnswer({ painIntensity: Number(e.target.value) })}
                    aria-label="Pain level"
                  />
                  <output>{finding.painIntensity ?? '—'}</output>
                </label>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={finding.notAssessable}
                  onChange={(e) => onAnswer({ notAssessable: e.target.checked })}
                />
                <span>Can't be assessed (replaced, fused or missing joint)</span>
              </label>
              <label className="field">
                <span>Note</span>
                <textarea
                  rows={2}
                  disabled={!editable}
                  value={finding.note}
                  maxLength={500}
                  placeholder="Optional"
                  onChange={(e) => onAnswer({ note: e.target.value })}
                />
              </label>
            </div>
          </details>

          <div className="nav-row">
            <button type="button" className="btn" onClick={onPrev}>
              ← Previous
            </button>
            <button type="button" className="btn primary" onClick={onNext}>
              {allDone ? 'Next joint →' : 'Next joint →'}
            </button>
          </div>
        </div>
      )}

      {!allDone && c.resolved > 0 && editable && (
        <button type="button" className="link shortcut" onClick={onRemainingNormal}>
          Everything else is normal — fill in the remaining {c.unresolvedIds.length} joints
        </button>
      )}
    </div>
  )
}
