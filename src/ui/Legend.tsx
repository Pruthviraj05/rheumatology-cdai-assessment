import { KIND_META, PAIN_COLOR, SELECTED_COLOR, type MarkerKind } from './status'

const ORDER: MarkerKind[] = ['tender', 'swollen', 'both', 'normal', 'partial', 'unexamined', 'na']

/** Marker legend — identical encoding in 3D, 2D and lists. Always paired with text labels. */
export default function Legend({ inline }: { inline?: boolean }) {
  return (
    <section className={`legend${inline ? ' inline' : ''}`} aria-label="Legend">
      {!inline && <h3>Legend</h3>}
      <ul>
        {ORDER.map((k) => (
          <li key={k} title={KIND_META[k].description}>
            <span
              className="dot"
              data-kind={k}
              style={{
                background: KIND_META[k].color,
                borderStyle: k === 'unexamined' ? 'dashed' : 'solid',
                borderColor: k === 'unexamined' || k === 'partial' ? '#64748b' : '#fff',
              }}
            >
              {KIND_META[k].code}
            </span>
            {KIND_META[k].label}
          </li>
        ))}
        <li title="Patient reports pain at this joint (not an examination finding)">
          <span className="dot ring" style={{ borderColor: PAIN_COLOR }} />
          Pain reported by patient
        </li>
        <li>
          <span className="dot ring" style={{ borderColor: SELECTED_COLOR, borderWidth: 3 }} />
          Selected joint
        </li>
      </ul>
    </section>
  )
}
