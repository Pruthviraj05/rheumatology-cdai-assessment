/**
 * Visual / textual state of a joint. Shared by the 3D scene, the 2D chart and the lists so that
 * the legend is identical everywhere. Colour is never the only carrier of meaning: every state
 * also has a text label and a short code that is drawn on markers.
 */
import { examState, type JointFinding } from '../domain/assessment'

export type MarkerKind = 'unexamined' | 'partial' | 'normal' | 'tender' | 'swollen' | 'both' | 'na'

export interface KindMeta {
  label: string
  /** Short code drawn on the marker. */
  code: string
  color: string
  description: string
}

export const KIND_META: Record<MarkerKind, KindMeta> = {
  unexamined: { label: 'Not examined', code: '', color: '#ffffff', description: 'Neither tenderness nor swelling recorded' },
  partial: { label: 'Partly examined', code: '·', color: '#e2e8f0', description: 'Only one of tenderness / swelling recorded' },
  normal: { label: 'Examined – normal', code: '✓', color: '#2f855a', description: 'Not tender and not swollen' },
  tender: { label: 'Tender', code: 'T', color: '#d9480f', description: 'Clinician found tenderness' },
  swollen: { label: 'Swollen', code: 'S', color: '#1c64f2', description: 'Clinician found swelling' },
  both: { label: 'Tender + swollen', code: 'TS', color: '#7e22ce', description: 'Tenderness and swelling both found' },
  na: { label: 'Not assessable', code: '∅', color: '#94a3b8', description: 'Prosthesis, fusion, amputation or otherwise not assessable' },
}

export const PAIN_COLOR = '#be185d'
export const SELECTED_COLOR = '#0b1220'
export const UNEXAMINED_STROKE = '#64748b'

export function markerKind(f: JointFinding): MarkerKind {
  if (f.notAssessable) return 'na'
  const t = f.tenderness === 'tender'
  const s = f.swelling === 'swollen'
  if (t && s) return 'both'
  if (t) return 'tender'
  if (s) return 'swollen'
  const state = examState(f)
  if (state === 'examined') return 'normal'
  if (state === 'partial') return 'partial'
  return 'unexamined'
}

export type TagTone = 'tender' | 'swollen' | 'pain' | 'normal' | 'muted'
export interface FindingTag {
  text: string
  tone: TagTone
}

/** Plain-language tags for a joint, used in lists and the review panel. */
export function findingTags(f: JointFinding): FindingTag[] {
  const tags: FindingTag[] = []
  if (f.notAssessable) tags.push({ text: 'Not assessable', tone: 'muted' })
  if (f.tenderness === 'tender') tags.push({ text: 'Tender', tone: 'tender' })
  if (f.swelling === 'swollen') tags.push({ text: 'Swollen', tone: 'swollen' })
  if (f.pain === 'yes') tags.push({ text: f.painIntensity === null ? 'Pain' : `Pain ${f.painIntensity}/10`, tone: 'pain' })
  const kind = markerKind(f)
  if (kind === 'normal') tags.push({ text: 'Normal', tone: 'normal' })
  if (kind === 'partial') {
    tags.push({
      text: f.tenderness === 'not_tender' ? 'Not tender · swelling not recorded' : 'Not swollen · tenderness not recorded',
      tone: 'muted',
    })
  }
  if (kind === 'unexamined' && f.pain !== 'yes') tags.push({ text: 'Not examined', tone: 'muted' })
  if (kind === 'unexamined' && f.pain === 'yes') tags.push({ text: 'Not examined', tone: 'muted' })
  return tags
}

export type JointFilter = 'all' | 'unexamined' | 'tender' | 'swollen' | 'pain'

export function matchesFilter(f: JointFinding, filter: JointFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'unexamined':
      return !f.notAssessable && (f.tenderness === 'unknown' || f.swelling === 'unknown')
    case 'tender':
      return f.tenderness === 'tender'
    case 'swollen':
      return f.swelling === 'swollen'
    case 'pain':
      return f.pain === 'yes'
  }
}
