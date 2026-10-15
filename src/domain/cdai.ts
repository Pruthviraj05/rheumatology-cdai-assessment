/**
 * Clinical Disease Activity Index (CDAI) for rheumatoid arthritis — pure calculation engine.
 *
 *   CDAI = TJC28 + SJC28 + PtGA + PrGA
 *
 *   TJC28  tender joint count      integer 0–28
 *   SJC28  swollen joint count     integer 0–28
 *   PtGA   patient global          0–10 (0 = very well, 10 = very poor)
 *   PrGA   physician global        0–10 (0 = very well, 10 = very poor)
 *
 * Range 0–76. Categories (Aletaha & Smolen; MDCalc calculator #2177):
 *   remission ≤ 2.8 · low > 2.8–10 · moderate > 10–22 · high > 22
 *
 * This module has no React, DOM or 3D dependencies and never mutates its input.
 * Global assessments are accepted at 0.1 resolution (VAS in cm, or the 0.5 steps
 * used by MDCalc). Arithmetic is done on integer tenths so that boundary values
 * such as 2.8 are never corrupted by floating-point error (1.1 + 1.7 !== 2.8 in IEEE-754).
 */

export const CDAI_MAX_JOINTS = 28
export const CDAI_MAX_GLOBAL = 10
export const CDAI_MAX_SCORE = 76

export type CdaiField = 'tjc28' | 'sjc28' | 'ptga' | 'prga'
export type CdaiCategory = 'remission' | 'low' | 'moderate' | 'high'

export interface CdaiInput {
  tjc28: number | null | undefined
  sjc28: number | null | undefined
  ptga: number | null | undefined
  prga: number | null | undefined
}

export type CdaiIssueCode =
  | 'missing'
  | 'not_a_number'
  | 'out_of_range'
  | 'not_integer'
  | 'bad_resolution'

export interface CdaiIssue {
  field: CdaiField
  code: CdaiIssueCode
  message: string
}

export interface CdaiComponents {
  tjc28: number
  sjc28: number
  ptga: number
  prga: number
}

export type CdaiResult =
  | {
      status: 'complete'
      score: number
      category: CdaiCategory
      components: CdaiComponents
    }
  | {
      status: 'incomplete'
      /** Components that are still missing (never defaulted to zero). */
      issues: CdaiIssue[]
      /** Sum of the valid components only. NOT a CDAI — for "so far" display. */
      partialSum: number
    }
  | {
      status: 'invalid'
      issues: CdaiIssue[]
    }

export interface CategoryDefinition {
  category: CdaiCategory
  label: string
  /** Inclusive upper bound; `null` means no upper bound. */
  upTo: number | null
  /** Human-readable range exactly as published. */
  range: string
}

export const CDAI_CATEGORIES: readonly CategoryDefinition[] = [
  { category: 'remission', label: 'Remission', upTo: 2.8, range: '≤ 2.8' },
  { category: 'low', label: 'Low disease activity', upTo: 10, range: '> 2.8 – 10.0' },
  { category: 'moderate', label: 'Moderate disease activity', upTo: 22, range: '> 10.0 – 22.0' },
  { category: 'high', label: 'High disease activity', upTo: null, range: '> 22.0' },
]

export const FIELD_LABELS: Record<CdaiField, string> = {
  tjc28: 'Tender joint count (TJC28)',
  sjc28: 'Swollen joint count (SJC28)',
  ptga: 'Patient global assessment (PtGA)',
  prga: 'Physician global assessment (PrGA)',
}

/**
 * Classify an exact CDAI score. Uses the unrounded value; comparisons are strict
 * at the published boundaries (2.8 is remission, 2.9 is low, 10 is low, 22 is moderate).
 */
export function classifyCdai(score: number): CdaiCategory {
  if (!Number.isFinite(score) || score < 0 || score > CDAI_MAX_SCORE) {
    throw new RangeError(`CDAI score must be a number between 0 and ${CDAI_MAX_SCORE}; received ${score}`)
  }
  if (score <= 2.8) return 'remission'
  if (score <= 10) return 'low'
  if (score <= 22) return 'moderate'
  return 'high'
}

export function categoryLabel(category: CdaiCategory): string {
  return CDAI_CATEGORIES.find((c) => c.category === category)!.label
}

const EPS = 1e-9

function validateCount(field: 'tjc28' | 'sjc28', value: unknown): CdaiIssue | null {
  const name = FIELD_LABELS[field]
  if (value === null || value === undefined) {
    return { field, code: 'missing', message: `${name} has not been entered.` }
  }
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return { field, code: 'not_a_number', message: `${name} must be a number.` }
  }
  if (!Number.isInteger(value)) {
    return { field, code: 'not_integer', message: `${name} must be a whole number of joints.` }
  }
  if (value < 0 || value > CDAI_MAX_JOINTS) {
    return { field, code: 'out_of_range', message: `${name} must be between 0 and ${CDAI_MAX_JOINTS}.` }
  }
  return null
}

function validateGlobal(field: 'ptga' | 'prga', value: unknown): CdaiIssue | null {
  const name = FIELD_LABELS[field]
  if (value === null || value === undefined) {
    return { field, code: 'missing', message: `${name} has not been entered.` }
  }
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return { field, code: 'not_a_number', message: `${name} must be a number.` }
  }
  if (value < 0 || value > CDAI_MAX_GLOBAL) {
    return { field, code: 'out_of_range', message: `${name} must be between 0 and ${CDAI_MAX_GLOBAL}.` }
  }
  if (Math.abs(value * 10 - Math.round(value * 10)) > EPS) {
    return { field, code: 'bad_resolution', message: `${name} must be in steps of 0.1 (e.g. 4 or 4.5).` }
  }
  return null
}

/** Validate a single component; returns `null` when it is valid. */
export function validateComponent(field: CdaiField, value: unknown): CdaiIssue | null {
  return field === 'tjc28' || field === 'sjc28' ? validateCount(field, value) : validateGlobal(field, value)
}

/** Compute the CDAI. Pure; missing values are reported, never treated as zero. */
export function computeCdai(input: CdaiInput): CdaiResult {
  const fields: CdaiField[] = ['tjc28', 'sjc28', 'ptga', 'prga']
  const issues: CdaiIssue[] = []
  let partialTenths = 0

  for (const field of fields) {
    const raw = input[field]
    const issue = validateComponent(field, raw)
    if (issue) issues.push(issue)
    else partialTenths += Math.round((raw as number) * 10)
  }

  if (issues.some((i) => i.code !== 'missing')) return { status: 'invalid', issues }
  if (issues.length > 0) return { status: 'incomplete', issues, partialSum: partialTenths / 10 }

  const score = partialTenths / 10
  return {
    status: 'complete',
    score,
    category: classifyCdai(score),
    components: {
      tjc28: input.tjc28 as number,
      sjc28: input.sjc28 as number,
      ptga: input.ptga as number,
      prga: input.prga as number,
    },
  }
}

/** Format a score for display: whole numbers without a decimal, otherwise one decimal. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

/**
 * Parse text typed into a numeric field.
 * Returns `null` for empty input (a missing value, never zero) and `NaN` for text that is not a number.
 */
export function parseNumericInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}
