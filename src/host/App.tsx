/**
 * Demo host — a stand-in for the existing clinic management application.
 *
 * It owns the patient, consultation and clinician identity and hands them to the module as
 * references. None of this code ships with the module; in the real application these come from
 * the existing consultation screen, authentication and role system.
 */
import { useCallback, useMemo, useState } from 'react'
import { createEmptyAssessment, markNormal, setGlobal, toPayload, updateJoint } from '../domain/assessment'
import type { ConsultationContext } from '../domain/context'
import { CDAI28_JOINTS } from '../domain/joints'
import { LocalStorageAssessmentRepository } from '../persistence/repository'
import RheumatologyAssessmentModule from '../ui/RheumatologyAssessmentModule'

interface Visit {
  id: string
  date: string
}

const VISITS_KEY = 'rheum-cdai.demo-visits'
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadVisits(): Visit[] {
  try {
    const raw = window.localStorage.getItem(VISITS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Visit[]) : []
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    /* fall through */
  }
  return [{ id: 'CONS-0001', date: today() }]
}

const PATIENT = { id: 'DEMO-0001', name: 'Demo Patient (fictional)', sex: 'F', dateOfBirth: '1971-04-12' }
const CLINICIAN = { id: 'DR-DEMO', name: 'Dr. Demo Rheumatologist' }

type Role = 'rheumatologist' | 'viewer'

export default function App() {
  const repository = useMemo(() => new LocalStorageAssessmentRepository(), [])
  const [visits, setVisits] = useState<Visit[]>(loadVisits)
  const [visitId, setVisitId] = useState(() => loadVisits().at(-1)!.id)
  const [role, setRole] = useState<Role>('rheumatologist')
  const [nonce, setNonce] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showTools, setShowTools] = useState(false)

  const visit = visits.find((v) => v.id === visitId) ?? visits[0]

  const context: ConsultationContext = useMemo(
    () => ({
      patient: PATIENT,
      consultation: { id: visit.id, date: visit.date },
      clinician: CLINICIAN,
      permissions: { canView: true, canEdit: role === 'rheumatologist' },
    }),
    [visit.id, visit.date, role],
  )

  const persistVisits = (next: Visit[]) => {
    setVisits(next)
    try {
      window.localStorage.setItem(VISITS_KEY, JSON.stringify(next))
    } catch {
      /* demo only */
    }
  }

  const newVisit = () => {
    const id = `CONS-${String(visits.length + 1).padStart(4, '0')}`
    persistVisits([...visits, { id, date: today() }])
    setVisitId(id)
    setNote(`Started demo visit ${id}.`)
  }

  const loadExample = useCallback(async () => {
    const existing = await repository.getForConsultation(PATIENT.id, visit.id)
    if (existing?.status === 'finalized') {
      setNote('This visit is already finalized. Start a new demo visit to load the example.')
      return
    }
    let d = markNormal(
      createEmptyAssessment(),
      CDAI28_JOINTS.map((j) => j.id),
    )
    for (const id of ['wrist_r', 'wrist_l', 'mcp2_r', 'mcp3_r', 'knee_l', 'pip2_l']) d = updateJoint(d, id, { tenderness: 'tender' })
    for (const id of ['wrist_r', 'mcp2_r', 'mcp3_r', 'knee_l']) d = updateJoint(d, id, { swelling: 'swollen' })
    d = updateJoint(d, 'wrist_r', { pain: 'yes', painIntensity: 6, note: 'Demonstration data' })
    d = updateJoint(d, 'ankle_l', { pain: 'yes', painIntensity: 3 })
    d = setGlobal(setGlobal(d, 'ptga', 5), 'prga', 3)
    await repository.save({
      intent: 'draft',
      patientId: PATIENT.id,
      consultationId: visit.id,
      consultationDate: visit.date,
      clinician: CLINICIAN,
      payload: toPayload(d),
      expectedRevision: existing?.revision ?? 0,
    })
    setNonce((n) => n + 1)
    setNote('Demonstration findings loaded as a draft: TJC 6 + SJC 4 + PtGA 5 + PrGA 3 = CDAI 18 (moderate).')
  }, [repository, visit.id, visit.date])

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      window.setTimeout(() => setConfirmReset(false), 4000)
      return
    }
    repository.clear()
    try {
      window.localStorage.removeItem(VISITS_KEY)
    } catch {
      /* ignore */
    }
    setVisits([{ id: 'CONS-0001', date: today() }])
    setVisitId('CONS-0001')
    setConfirmReset(false)
    setNonce((n) => n + 1)
    setNote('Demo data cleared.')
  }

  return (
    <div className="host">
      <div className="host-bar" role="region" aria-label="Demo controls">
        <strong>Demo</strong>
        <span className="muted">fictional data · stored only in this browser</span>
        <span className="spacer" />
        <button type="button" aria-expanded={showTools} onClick={() => setShowTools((v) => !v)}>
          Demo options {showTools ? '▴' : '▾'}
        </button>
        <button type="button" onClick={() => void loadExample()}>
          Load example
        </button>
      </div>
      {showTools && (
        <div className="host-bar" role="group" aria-label="More demo options">
          <label>
            Visit
            <select value={visit.id} onChange={(e) => setVisitId(e.target.value)}>
              {visits.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} · {v.date}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={newVisit}>
            + New visit
          </button>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="rheumatologist">Rheumatologist (can edit)</option>
              <option value="viewer">Read-only viewer</option>
            </select>
          </label>
          <button type="button" onClick={reset}>
            {confirmReset ? 'Click again to confirm' : 'Reset demo data'}
          </button>
        </div>
      )}
      {note && (
        <div className="host-note" role="status">
          {note}{' '}
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
      <RheumatologyAssessmentModule
        key={`${visit.id}-${role}-${nonce}`}
        context={context}
        repository={repository}
        onReturnToConsultation={() => setNote('“Return to consultation” — in the clinic app this navigates back to the consultation screen.')}
      />
    </div>
  )
}
