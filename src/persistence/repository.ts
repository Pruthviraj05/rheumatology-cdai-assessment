/**
 * Persistence seam. The host clinic application's backend is the source of truth for saved
 * clinical records; the module only talks to this interface. The bundled implementation
 * stores to localStorage so the standalone demo works with no server.
 *
 * To integrate: implement AssessmentRepository against the clinic API (GET/PUT with the
 * existing authentication) and pass it to <RheumatologyAssessmentModule repository=… />.
 * Server-side, re-run `applySave` (domain/records.ts) so validation never relies on the browser.
 */
import { applySave, SaveError, type AssessmentRecord, type SaveRequest } from '../domain/records'

export interface AssessmentRepository {
  getForConsultation(patientId: string, consultationId: string): Promise<AssessmentRecord | null>
  listForPatient(patientId: string): Promise<AssessmentRecord[]>
  save(request: SaveRequest): Promise<AssessmentRecord>
}

const KEY = 'rheum-cdai.records.v1'

function readAll(storage: Storage): AssessmentRecord[] {
  try {
    const raw = storage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AssessmentRecord[]) : []
  } catch {
    return []
  }
}

function writeAll(storage: Storage, records: AssessmentRecord[]) {
  try {
    storage.setItem(KEY, JSON.stringify(records))
  } catch (e) {
    throw new SaveError('STORAGE', 'The assessment could not be written to storage.', [String(e)])
  }
}

function sortByVisit(records: AssessmentRecord[]) {
  return records.sort(
    (a, b) => a.consultationDate.localeCompare(b.consultationDate) || a.createdAt.localeCompare(b.createdAt),
  )
}

export class LocalStorageAssessmentRepository implements AssessmentRepository {
  private readonly storage: Storage
  constructor(storage?: Storage) {
    this.storage = storage ?? window.localStorage
  }

  async getForConsultation(patientId: string, consultationId: string) {
    return readAll(this.storage).find((r) => r.patientId === patientId && r.consultationId === consultationId) ?? null
  }

  async listForPatient(patientId: string) {
    return sortByVisit(readAll(this.storage).filter((r) => r.patientId === patientId))
  }

  async save(request: SaveRequest) {
    const all = readAll(this.storage)
    const idx = all.findIndex((r) => r.patientId === request.patientId && r.consultationId === request.consultationId)
    const saved = applySave(idx >= 0 ? all[idx] : null, request)
    if (idx >= 0) all[idx] = saved
    else all.push(saved)
    writeAll(this.storage, all)
    return saved
  }

  /** Demo helper: remove everything. */
  clear() {
    this.storage.removeItem(KEY)
  }
}

/** Non-persistent repository, used by tests. */
export class MemoryAssessmentRepository implements AssessmentRepository {
  private records: AssessmentRecord[] = []
  async getForConsultation(patientId: string, consultationId: string) {
    return this.records.find((r) => r.patientId === patientId && r.consultationId === consultationId) ?? null
  }
  async listForPatient(patientId: string) {
    return sortByVisit(this.records.filter((r) => r.patientId === patientId))
  }
  async save(request: SaveRequest) {
    const idx = this.records.findIndex((r) => r.patientId === request.patientId && r.consultationId === request.consultationId)
    const saved = applySave(idx >= 0 ? this.records[idx] : null, request)
    if (idx >= 0) this.records[idx] = saved
    else this.records.push(saved)
    return saved
  }
}
