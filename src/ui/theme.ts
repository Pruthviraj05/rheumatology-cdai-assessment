import type { CdaiCategory } from '../domain/cdai'

export const CATEGORY_COLOR: Record<CdaiCategory, string> = {
  remission: '#15803d',
  low: '#4d7c0f',
  moderate: '#b45309',
  high: '#b91c1c',
}

/** One plain-language line per category — descriptive only, never a treatment recommendation. */
export const CATEGORY_PLAIN: Record<CdaiCategory, string> = {
  remission: 'Disease activity is in the remission range.',
  low: 'Disease activity is in the low range.',
  moderate: 'Disease activity is in the moderate range.',
  high: 'Disease activity is in the high range.',
}
