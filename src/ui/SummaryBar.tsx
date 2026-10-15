import type { AssessmentSession } from './useAssessmentSession'
import { CATEGORY_COLOR } from './CdaiCard'
import { categoryLabel, formatScore } from '../domain/cdai'

interface Props {
  session: AssessmentSession
  onSaveDraft(): void
  onFinalize(): void
  onAmend(): void
}

function timeOf(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Persistent bottom bar: counts, live CDAI and the save actions. */
export default function SummaryBar({ session, onSaveDraft, onFinalize, onAmend }: Props) {
  const { result, record, dirty, saving, editable } = session
  const c = result.counts.cdai
  const complete = result.status === 'complete'
  const manual = result.countSource === 'manual'
  const finalized = record?.status === 'finalized'

  let state = 'Not saved yet'
  if (saving) state = 'Saving…'
  else if (dirty) state = 'Unsaved changes'
  else if (record) state = `${finalized ? 'Finalized' : 'Draft saved'} ${timeOf(record.updatedAt)}`.trim()

  return (
    <footer className="summary-bar" aria-label="Assessment summary">
      <dl className="stats">
        <div>
          <dt>{manual ? 'Counts' : 'Examined'}</dt>
          <dd data-testid="stat-examined">{manual ? 'manual' : `${c.resolved}/${c.total}`}</dd>
        </div>
        <div>
          <dt>Tender</dt>
          <dd data-testid="stat-tender">{result.tjc28 ?? '—'}</dd>
        </div>
        <div>
          <dt>Swollen</dt>
          <dd data-testid="stat-swollen">{result.sjc28 ?? '—'}</dd>
        </div>
        <div>
          <dt>Unexamined</dt>
          <dd data-testid="stat-unexamined">{manual ? '—' : c.total - c.resolved}</dd>
        </div>
        <div>
          <dt>PtGA</dt>
          <dd>{result.ptga === null ? '—' : result.ptga.toFixed(1)}</dd>
        </div>
        <div>
          <dt>PrGA</dt>
          <dd>{result.prga === null ? '—' : result.prga.toFixed(1)}</dd>
        </div>
      </dl>

      <div className="sum-cdai" aria-live="polite">
        <span className="sum-label">CDAI</span>
        {complete ? (
          <>
            <b style={{ color: CATEGORY_COLOR[result.category!] }} data-testid="summary-score">
              {formatScore(result.score!)}
            </b>
            <span className="sum-cat" style={{ background: CATEGORY_COLOR[result.category!] }}>
              {categoryLabel(result.category!)}
            </span>
          </>
        ) : (
          <>
            <b className="unset" data-testid="summary-score">
              —
            </b>
            <span className="sum-cat incomplete">Incomplete</span>
          </>
        )}
      </div>

      <div className="sum-actions">
        <span className={`save-state${dirty ? ' dirty' : ''}`} data-testid="save-state">
          {state}
        </span>
        <button type="button" className="btn ghost" onClick={session.undo} disabled={!session.canUndo} title="Undo last change (Ctrl+Z)">
          ↶ Undo
        </button>
        {finalized && !session.amending ? (
          <button type="button" className="btn" onClick={onAmend} disabled={!session.record || session.readOnlyReason?.includes('view-only') === true}>
            Amend…
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onSaveDraft} disabled={!editable || saving || !dirty}>
              Save draft
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={onFinalize}
              disabled={!editable || saving || !complete}
              title={complete ? 'Review and finalize this assessment' : 'Complete all components to finalize'}
            >
              {session.amending ? 'Save amendment…' : 'Finalize…'}
            </button>
          </>
        )}
      </div>
    </footer>
  )
}
