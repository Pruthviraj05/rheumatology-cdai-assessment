/**
 * 2D joint chart: front/back body plus enlarged hand and foot panels.
 * Supports the identical clinical workflow as the 3D model (same registry, same selection,
 * same finding encoding) and is the automatic fallback when WebGL is unavailable.
 */
import { memo, useMemo } from 'react'
import { EMPTY_FINDING, type AssessmentData } from '../domain/assessment'
import { JOINTS, bodyPanelPoint, type JointDef, type Panel2D, type View } from '../domain/joints'
import { KIND_META, PAIN_COLOR, SELECTED_COLOR, UNEXAMINED_STROKE, findingTags, markerKind } from './status'

interface Props {
  data: AssessmentData
  selectedId: string | null
  onSelect(id: string): void
  view: View
  onViewChange(view: View): void
  /** Joints that match the active filter are emphasised; others dim. `null` = no filter. */
  highlightIds: ReadonlySet<string> | null
}

const SKIN = '#e3e9f0'
const SKIN_EDGE = '#c4cfdb'

interface MarkerProps {
  joint: JointDef
  x: number
  y: number
  r: number
  data: AssessmentData
  selected: boolean
  dim: boolean
  onSelect(id: string): void
}

const Marker = memo(function Marker({ joint, x, y, r, data, selected, dim, onSelect }: MarkerProps) {
  const f = data.joints[joint.id] ?? EMPTY_FINDING
  const kind = markerKind(f)
  const meta = KIND_META[kind]
  const tags = findingTags(f)
    .map((t) => t.text)
    .join(', ')
  const label = `${joint.name}${joint.cdai28 ? '' : ' (not in CDAI 28)'}: ${tags}`
  const filled = kind !== 'unexamined' && kind !== 'partial'
  const textColor = filled ? '#fff' : '#334155'
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-joint-id={joint.id}
      data-kind={kind}
      className="marker2d"
      opacity={dim ? 0.28 : 1}
      onClick={() => onSelect(joint.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(joint.id)
        }
      }}
    >
      <title>{label}</title>
      {f.pain === 'yes' && (
        <circle cx={x} cy={y} r={r + 4.5} fill="none" stroke={PAIN_COLOR} strokeWidth={2.2} strokeDasharray="3 2.4" />
      )}
      {selected && <circle cx={x} cy={y} r={r + 7.5} fill="none" stroke={SELECTED_COLOR} strokeWidth={2.6} />}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={meta.color}
        stroke={kind === 'unexamined' || kind === 'partial' ? UNEXAMINED_STROKE : '#fff'}
        strokeWidth={kind === 'unexamined' ? 1.6 : 1.4}
        strokeDasharray={kind === 'unexamined' ? '2.5 2' : undefined}
      />
      {meta.code && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={meta.code.length > 1 ? r * 0.82 : r * 1.05}
          fontWeight={700}
          fill={textColor}
          pointerEvents="none"
        >
          {meta.code}
        </text>
      )}
    </g>
  )
})

function Limb({ a, b, w }: { a: { x: number; y: number }; b: { x: number; y: number }; w: number }) {
  return (
    <>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SKIN_EDGE} strokeWidth={w + 3} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SKIN} strokeWidth={w} strokeLinecap="round" />
    </>
  )
}

export default function BodyMap2D({ data, selectedId, onSelect, view, onViewChange, highlightIds }: Props) {
  const byPanel = useMemo(() => {
    const map: Record<Panel2D, JointDef[]> = { body: [], handR: [], handL: [], footR: [], footL: [] }
    for (const j of JOINTS) map[j.map2d.panel].push(j)
    return map
  }, [])

  const dim = (id: string) => highlightIds !== null && !highlightIds.has(id)
  const bodyPts = (id: string) => {
    const j = JOINTS.find((x) => x.id === id)!
    return bodyPanelPoint(j.position[0], j.position[1], view)
  }
  const sh = { R: bodyPts('shoulder_r'), L: bodyPts('shoulder_l') }
  const el = { R: bodyPts('elbow_r'), L: bodyPts('elbow_l') }
  const wr = { R: bodyPts('wrist_r'), L: bodyPts('wrist_l') }
  const hip = { R: bodyPts('hip_r'), L: bodyPts('hip_l') }
  const kn = { R: bodyPts('knee_r'), L: bodyPts('knee_l') }
  const an = { R: bodyPts('ankle_r'), L: bodyPts('ankle_l') }
  const head = bodyPanelPoint(0, 1.72, view)
  const neck = bodyPanelPoint(0, 1.56, view)
  const chest = bodyPanelPoint(0, 1.3, view)
  const pelvis = bodyPanelPoint(0, 0.95, view)
  const rightSideOnLeft = view === 'front'

  const renderMarkers = (panel: Panel2D, r: number, bodyOnlyView?: boolean) =>
    byPanel[panel]
      .filter((j) => !bodyOnlyView || j.bodyView === 'both' || j.bodyView === view)
      .map((j) => {
        const p = panel === 'body' ? bodyPanelPoint(j.position[0], j.position[1], view) : j.map2d
        return (
          <Marker
            key={j.id}
            joint={j}
            x={p.x}
            y={p.y}
            r={r}
            data={data}
            selected={selectedId === j.id}
            dim={dim(j.id)}
            onSelect={onSelect}
          />
        )
      })

  const hand = (side: 'R' | 'L') => {
    const panel: Panel2D = side === 'R' ? 'handR' : 'handL'
    const pts = byPanel[panel]
    const get = (g: string, d: number) => pts.find((j) => j.group === g && j.digit === d)!.map2d
    const mcps = ([1, 2, 3, 4, 5] as const).map((d) => get('mcp', d))
    const left = Math.min(...mcps.map((m) => m.x)) - 16
    const right = Math.max(...mcps.map((m) => m.x)) + 16
    return (
      <svg viewBox="0 0 200 236" className="panel2d" role="group" aria-label={`${side === 'R' ? 'Right' : 'Left'} hand`}>
        <text x="100" y="228" textAnchor="middle" className="panel2d-title">
          {side === 'R' ? 'Right hand & wrist' : 'Left hand & wrist'}
        </text>
        <rect x={left} y="26" width={right - left} height="72" rx="24" fill={SKIN} stroke={SKIN_EDGE} strokeWidth="2" />
        {([1, 2, 3, 4, 5] as const).map((d) => {
          const mcp = get('mcp', d)
          const pip = get('pip', d)
          const dip = d === 1 ? null : get('dip', d)
          const last = dip ?? pip
          const tip = { x: last.x, y: last.y + 22 }
          return (
            <g key={d}>
              <Limb a={mcp} b={pip} w={16} />
              {dip && <Limb a={pip} b={dip} w={15} />}
              <Limb a={last} b={tip} w={14} />
            </g>
          )
        })}
        {renderMarkers(panel, 8)}
      </svg>
    )
  }

  const foot = (side: 'R' | 'L') => {
    const panel: Panel2D = side === 'R' ? 'footR' : 'footL'
    return (
      <svg viewBox="0 0 160 236" className="panel2d" role="group" aria-label={`${side === 'R' ? 'Right' : 'Left'} foot`}>
        <text x="80" y="228" textAnchor="middle" className="panel2d-title">
          {side === 'R' ? 'Right foot & ankle' : 'Left foot & ankle'}
        </text>
        <ellipse cx="80" cy="112" rx="42" ry="68" fill={SKIN} stroke={SKIN_EDGE} strokeWidth="2" />
        {renderMarkers(panel, 8)}
      </svg>
    )
  }

  return (
    <div className="map2d">
      <div className="map2d-body">
        <div className="map2d-body-head">
          <div className="seg" role="group" aria-label="Body chart side">
            {(['front', 'back'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => onViewChange(v)}>
                {v === 'front' ? 'Front' : 'Back'}
              </button>
            ))}
          </div>
          <span className="muted small">Patient's right is on the {rightSideOnLeft ? 'left' : 'right'}</span>
        </div>
        <svg viewBox="0 0 300 640" className="panel2d body" role="group" aria-label={`Body chart, ${view} view`}>
          <Limb a={sh.R} b={el.R} w={22} />
          <Limb a={el.R} b={wr.R} w={18} />
          <Limb a={sh.L} b={el.L} w={22} />
          <Limb a={el.L} b={wr.L} w={18} />
          <Limb a={hip.R} b={kn.R} w={34} />
          <Limb a={kn.R} b={an.R} w={26} />
          <Limb a={hip.L} b={kn.L} w={34} />
          <Limb a={kn.L} b={an.L} w={26} />
          <Limb a={neck} b={head} w={16} />
          <rect x={sh.R.x < sh.L.x ? sh.R.x : sh.L.x} y={sh.R.y - 14} width={Math.abs(sh.L.x - sh.R.x)} height={chest.y - sh.R.y + 120} rx="34" fill={SKIN} stroke={SKIN_EDGE} strokeWidth="3" />
          <ellipse cx={pelvis.x} cy={pelvis.y} rx="58" ry="34" fill={SKIN} stroke={SKIN_EDGE} strokeWidth="3" />
          <ellipse cx={head.x} cy={head.y} rx="26" ry="32" fill={SKIN} stroke={SKIN_EDGE} strokeWidth="3" />
          <text x={rightSideOnLeft ? 20 : 280} y="30" textAnchor="middle" className="side-label">R</text>
          <text x={rightSideOnLeft ? 280 : 20} y="30" textAnchor="middle" className="side-label">L</text>
          {renderMarkers('body', 11, true)}
        </svg>
        <p className="muted small map2d-note">Wrists, hands and feet are charted in the enlarged panels →</p>
      </div>
      <div className="map2d-details">
        <div className="map2d-row">
          {hand('R')}
          {hand('L')}
        </div>
        <div className="map2d-row">
          {foot('R')}
          {foot('L')}
        </div>
      </div>
    </div>
  )
}
