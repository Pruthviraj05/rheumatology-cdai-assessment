import { useEffect, useMemo, useState } from 'react'
import { EMPTY_FINDING, type AssessmentResult } from '../domain/assessment'
import { JOINT_BY_ID, NAV_GROUPS } from '../domain/joints'
import type { AssessmentData } from '../domain/assessment'
import Legend from './Legend'
import { findingTags, markerKind, matchesFilter, KIND_META, type JointFilter } from './status'

interface Props {
  data: AssessmentData
  result: AssessmentResult
  selectedId: string | null
  filter: JointFilter
  onFilter(f: JointFilter): void
  onSelect(id: string): void
  editable: boolean
  onMarkRemainingNormal(): void
}

const FILTERS: { id: JointFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unexamined', label: 'Unexamined' },
  { id: 'tender', label: 'Tender' },
  { id: 'swollen', label: 'Swollen' },
  { id: 'pain', label: 'Pain' },
]

export default function Navigator({
  data,
  result,
  selectedId,
  filter,
  onFilter,
  onSelect,
  editable,
  onMarkRemainingNormal,
}: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const selectedGroup = selectedId ? NAV_GROUPS.find((g) => g.jointIds.includes(selectedId))?.id : undefined
  useEffect(() => {
    if (!selectedGroup) return
    setClosed((c) => {
      if (!c.has(selectedGroup)) return c
      const n = new Set(c)
      n.delete(selectedGroup)
      return n
    })
  }, [selectedGroup])

  const filterCounts = useMemo(() => {
    const counts: Record<JointFilter, number> = { all: 0, unexamined: 0, tender: 0, swollen: 0, pain: 0 }
    for (const id of Object.keys(JOINT_BY_ID)) {
      const f = data.joints[id] ?? EMPTY_FINDING
      for (const k of Object.keys(counts) as JointFilter[]) if (matchesFilter(f, k)) counts[k] += 1
    }
    return counts
  }, [data.joints])

  const c = result.counts.cdai
  const pct = Math.round((c.resolved / c.total) * 100)
  const manual = data.countSource === 'manual'

  return (
    <div className="navigator">
      <section className="progress-card" aria-label="Examination progress">
        <div className="progress-top">
          <strong>28-joint examination</strong>
          <span data-testid="progress-count">
            {c.resolved}/{c.total}
          </span>
        </div>
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={c.total}
          aria-valuenow={c.resolved}
          aria-label="Joints in the 28-joint set with both findings recorded"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-stats">
          <span>
            <b>{c.tender}</b> tender
          </span>
          <span>
            <b>{c.swollen}</b> swollen
          </span>
          <span>
            <b>{c.total - c.resolved}</b> to do
          </span>
        </div>
        {manual && (
          <p className="small muted">Manual counts are in use — the joint chart is documentation only.</p>
        )}
        <button
          type="button"
          className="btn small block"
          disabled={!editable || c.unresolvedIds.length === 0}
          onClick={onMarkRemainingNormal}
        >
          Mark remaining {c.unresolvedIds.length} as normal…
        </button>
      </section>

      <div className="filters" role="group" aria-label="Filter joints">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.label} <span className="count">{filterCounts[f.id]}</span>
          </button>
        ))}
      </div>

      <div className="groups">
        {NAV_GROUPS.map((g, i) => {
          const rows = g.jointIds.filter((id) => matchesFilter(data.joints[id] ?? EMPTY_FINDING, filter))
          if (rows.length === 0) return null
          const resolved = g.jointIds.filter((id) => {
            const f = data.joints[id] ?? EMPTY_FINDING
            return f.notAssessable || (f.tenderness !== 'unknown' && f.swelling !== 'unknown')
          }).length
          const prevCdai = i > 0 ? NAV_GROUPS[i - 1].cdai28 : null
          const open = !closed.has(g.id) && (filter !== 'all' || true)
          return (
            <div key={g.id}>
              {g.cdai28 !== prevCdai && (
                <h3 className="group-divider">{g.cdai28 ? 'CDAI 28-joint set' : 'Pain map only · not counted in CDAI'}</h3>
              )}
              <section className="group">
                <button
                  type="button"
                  className="group-head"
                  aria-expanded={open}
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s)
                      if (n.has(g.id)) n.delete(g.id)
                      else n.add(g.id)
                      return n
                    })
                  }
                >
                  <span className="chev" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="group-label">{g.label}</span>
                  <span className="group-count">
                    {resolved}/{g.jointIds.length}
                  </span>
                </button>
                {open && (
                  <ul>
                    {rows.map((id) => {
                      const j = JOINT_BY_ID[id]
                      const f = data.joints[id] ?? EMPTY_FINDING
                      const kind = markerKind(f)
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            className="joint-row"
                            data-joint-id={id}
                            data-kind={kind}
                            aria-current={selectedId === id ? 'true' : undefined}
                            onClick={() => onSelect(id)}
                          >
                            <span className="dot" style={{ background: KIND_META[kind].color }} data-kind={kind}>
                              {KIND_META[kind].code}
                            </span>
                            <span className="joint-name">{j.name}</span>
                            <span className="joint-tags">
                              {findingTags(f)
                                .filter((t) => t.tone !== 'muted' || kind === 'partial')
                                .map((t) => (
                                  <span key={t.text} className={`tag ${t.tone}`}>
                                    {t.text}
                                  </span>
                                ))}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          )
        })}
        {FILTERS.length > 0 && filterCounts[filter] === 0 && (
          <p className="muted small pad">No joints match this filter yet.</p>
        )}
      </div>

      <Legend />
    </div>
  )
}
