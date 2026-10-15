/**
 * Context handed to the module by the host application. The module never creates patients,
 * consultations or users — it only receives references to the existing ones.
 */
import type { ClinicianRef } from './records'

export interface PatientRef {
  id: string
  name: string
  /** Optional demographics for the header (display only). */
  dateOfBirth?: string
  sex?: string
}

export interface ConsultationRef {
  id: string
  /** ISO date yyyy-mm-dd */
  date: string
}

export interface ConsultationContext {
  patient: PatientRef
  consultation: ConsultationRef
  clinician: ClinicianRef
  permissions: {
    /** May open and read assessments. */
    canView: boolean
    /** May create and change assessments (enforced again server-side in a real deployment). */
    canEdit: boolean
  }
}
