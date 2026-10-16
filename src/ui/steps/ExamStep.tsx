/**
 * Step 1 — quick joint examination.
 *
 * Doctors mark ONLY the affected joints (tap on the body or on the 28-joint form), then press one
 * button to record every other joint as normal. A typical patient takes a handful of taps.
 */
import type { AssessmentData, AssessmentResult, JointFinding } from '../../domain/assessment'
import { EMPTY_FINDING } from '../../domain/assessment'
import { DIGIT_NAMES, JOINT_BY_ID, type JointDef } from '../../domain/joints'

export type Tool = 'tender' | 'swollen' | 'pain' | 'erase'

interface Props {
  data: AssessmentData
  result: AssessmentResult
  editable: boolean
  tool: Tool
  onTool(t: Tool): void
  /** Toggle tender / swollen on one joint (used by the form). */
  onToggle(jointId: string, field: 'tenderness' | 'swelling'): void
  selected: JointDef | null
  selectedFinding: JointFinding
  onDetail(patch: Partial<JointFinding>): void
  canUndo: boolean
  onUndo(): void
}

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'tender', label: 'Tender' },
  { id: 'swollen', label: 'Swollen' },
  { id: 'pain', label: 'Pain' },
  { id: 'erase', label: 'Erase' },
]

/** Rows of the classic 28-joint form; each cell lists the joint groups on that row. */
const ROWS: { label: string; cells: { prefix: string; short: string }[] }[] = [
  { label: 'Shoulder', cells: [{ prefix: 'shoulder', short: '' }] },
  { label: 'Elbow', cells: [{ prefix: 'elbow', short: '' }] },
  { label: 'Wrist', cells: [{ prefix: 'wrist', short: '' }] },
  ...([1, 2, 3, 4, 5] as const).map((d) => ({
    label: DIGIT_NAMES[d][0].toUpperCase() + DIGIT_NAMES[d].slice(1),
    cells: [
      { prefix: `mcp${d}`, short: 'MCP' },
      { prefix: `pip${d}`, short: d === 1 ? 'IP' : 'PIP' },
    ],
  })),
  { label: 'Knee', cells: [{ prefix: 'knee', short: '' }] },
]

function Cell({
  id,
  short,
  data,
  editable,
  onToggle,
}: {
  id: string
  short: string
  data: AssessmentData
  editable: boolean
  onToggle: Props['onToggle']
}) {
  const f = data.joints[id] ?? EMPTY_FINDING
  const name = JOINT_BY_ID[id].name
  const checked = f.notAssessable || (f.tenderness !== 'unknown' && f.swelling !== 'unknown')
  return (
    <div className="cell" data-checked={checked} title={short ? `${name}` : undefined}>
      <button
        type="button"
        className="ts t"
        aria-pressed={f.tenderness === 'tender'}
        aria-label={`${name} tender`}
        disabled={!editable || f.notAssessable}
        onClick={() => onToggle(id, 'tenderness')}
      >
        T
      </button>
      <button
        type="button"
        className="ts s"
        aria-pressed={f.swelling === 'swollen'}
        aria-label={`${name} swollen`}
        disabled={!editable || f.notAssessable}
        onClick={() => onToggle(id, 'swelling')}
      >
        S
      </button>
    </div>
  )
}

export default function ExamStep({
  data,
  result,
  editable,
  tool,
  onTool,
  onToggle,
  selected,
  selectedFinding,
  onDetail,
  canUndo,
  onUndo,
}: Props) {
  const c = result.counts.cdai
  const manual = result.countSource === 'manual'

  return (
    <div className="step-body">
      <div>
        <h2 className="step-title">Tap the affected joints</h2>
        <p className="step-help">Only mark joints that are tender or swollen. Leave normal joints alone — one tap at the end records them.</p>
      </div>

      {manual && <p className="note-box">You chose to type the counts yourself (step 2). Marking joints here is optional.</p>}

      <div className="tally" aria-live="polite">
        <span className="tally-item t">
          <b data-testid="count-tender">{c.tender}</b> tender
        </span>
        <span className="tally-item s">
          <b data-testid="count-swollen">{c.swollen}</b> swollen
        </span>
        <span className="tally-item">
          <b data-testid="progress-count">
            {c.resolved}/{c.total}
          </b>{' '}
          recorded
        </span>
        {canUndo && (
          <button type="button" className="link undo" onClick={onUndo}>
            ↶ Undo
          </button>
        )}
      </div>

      <section aria-label="Tapping a joint on the body marks it as">
        <p className="tool-label">Tapping the body marks:</p>
        <div className="tools" role="group" aria-label="Tapping the body marks">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" data-tool={t.id} aria-pressed={tool === t.id} disabled={!editable} onClick={() => onTool(t.id)}>
              <span className="tool-dot" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="form28" aria-label="28-joint form">
        <div className="form-head">
          <span>Right</span>
          <span />
          <span>Left</span>
        </div>
        {ROWS.map((row, i) => (
          <div key={row.label} className="form-group">
            {i === 3 && (
              <div className="form-row sub" aria-hidden="true">
                <div className="side">
                  <span>MCP</span>
                  <span>PIP</span>
                </div>
                <span className="row-label">Hand</span>
                <div className="side">
                  <span>MCP</span>
                  <span>PIP</span>
                </div>
              </div>
            )}
          <div className="form-row">
            <div className="side">
              {row.cells.map((cell) => (
                <Cell key={cell.prefix} id={`${cell.prefix}_r`} short={cell.short} data={data} editable={editable} onToggle={onToggle} />
              ))}
            </div>
            <span className="row-label">{row.label}</span>
            <div className="side">
              {row.cells.map((cell) => (
                <Cell key={cell.prefix} id={`${cell.prefix}_l`} short={cell.short} data={data} editable={editable} onToggle={onToggle} />
              ))}
            </div>
          </div>
          </div>
        ))}
        <p className="form-foot muted">T = tender · S = swollen. Feet, ankles, hips and spine can be marked on the body; they don't change the score.</p>
      </section>

      {selected && (
        <details className="more">
          <summary>
            More for <b data-testid="selected-joint-name">{selected.name}</b>
            {!selected.cdai28 && <span className="muted"> — not counted in the score</span>}
          </summary>
          <div className="more-body">
            <div className="question compact">
              <strong>Patient reports pain here?</strong>
              <div className="yesno small" role="group" aria-label="Pain reported by patient">
                {(['yes', 'no'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!editable}
                    aria-pressed={selectedFinding.pain === v}
                    data-tone={v === 'yes' ? 'pain' : 'no'}
                    onClick={() => onDetail({ pain: selectedFinding.pain === v ? 'unknown' : v })}
                  >
                    {v === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>
            {selectedFinding.pain === 'yes' && (
              <label className="range-line">
                <span>Pain level (0–10, not part of the score)</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  disabled={!editable}
                  value={selectedFinding.painIntensity ?? 0}
                  onChange={(e) => onDetail({ painIntensity: Number(e.target.value) })}
                  aria-label="Pain level"
                />
                <output>{selectedFinding.painIntensity ?? '—'}</output>
              </label>
            )}
            <label className="check">
              <input type="checkbox" disabled={!editable} checked={selectedFinding.notAssessable} onChange={(e) => onDetail({ notAssessable: e.target.checked })} />
              <span>Can't be assessed (replaced, fused or missing joint)</span>
            </label>
            <label className="field">
              <span>Note</span>
              <textarea rows={2} disabled={!editable} value={selectedFinding.note} maxLength={500} placeholder="Optional" onChange={(e) => onDetail({ note: e.target.value })} />
            </label>
          </div>
        </details>
      )}
    </div>
  )
}
