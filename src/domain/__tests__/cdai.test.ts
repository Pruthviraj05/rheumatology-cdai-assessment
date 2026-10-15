import { describe, expect, it } from 'vitest'
import { classifyCdai, computeCdai, parseNumericInput, CDAI_MAX_SCORE } from '../cdai'

const calc = (tjc28: number | null, sjc28: number | null, ptga: number | null, prga: number | null) =>
  computeCdai({ tjc28, sjc28, ptga, prga })

describe('CDAI classification', () => {
  it.each([
    [0, 'remission'],
    [2, 'remission'],
    [2.8, 'remission'],
    [2.9, 'low'],
    [8, 'low'],
    [10, 'low'],
    [10.1, 'moderate'],
    [18, 'moderate'],
    [22, 'moderate'],
    [22.1, 'high'],
    [23, 'high'],
    [76, 'high'],
  ] as const)('score %s → %s', (score, category) => {
    expect(classifyCdai(score)).toBe(category)
  })

  it('rejects scores outside 0–76', () => {
    expect(() => classifyCdai(-0.1)).toThrow(RangeError)
    expect(() => classifyCdai(76.1)).toThrow(RangeError)
    expect(() => classifyCdai(Number.NaN)).toThrow(RangeError)
  })
})

describe('computeCdai', () => {
  it('matches the MDCalc worked example: 6 + 4 + 5 + 3 = 18 (moderate)', () => {
    expect(calc(6, 4, 5, 3)).toMatchObject({ status: 'complete', score: 18, category: 'moderate' })
  })

  it('maximum is 76 (28 + 28 + 10 + 10) and is high', () => {
    expect(calc(28, 28, 10, 10)).toMatchObject({ status: 'complete', score: CDAI_MAX_SCORE, category: 'high' })
  })

  it('all zero is remission', () => {
    expect(calc(0, 0, 0, 0)).toMatchObject({ status: 'complete', score: 0, category: 'remission' })
  })

  it('is immune to floating point drift at the 2.8 boundary', () => {
    // Naive float addition misses 2.8 for these pairs (e.g. 0.1 + 2.7); the engine works in integer tenths.
    expect(0.1 + 2.7).not.toBe(2.8)
    for (const [a, b] of [[0.1, 2.7], [0.2, 2.6], [0.6, 2.2], [2.2, 0.6], [2.6, 0.2], [2.7, 0.1], [1.4, 1.4]]) {
      expect(calc(0, 0, a, b)).toMatchObject({ score: 2.8, category: 'remission' })
    }
    expect(calc(0, 0, 0.1, 2.8)).toMatchObject({ score: 2.9, category: 'low' })
  })

  it('handles 0.5 steps used by MDCalc', () => {
    expect(calc(1, 0, 0.5, 1.5)).toMatchObject({ score: 3, category: 'low' })
    expect(calc(2, 1, 4.5, 4.5)).toMatchObject({ score: 12, category: 'moderate' })
    expect(calc(10, 5, 3.5, 3.5)).toMatchObject({ score: 22, category: 'moderate' })
    expect(calc(10, 5, 3.5, 4)).toMatchObject({ score: 22.5, category: 'high' })
  })

  it('category boundaries via components: 10 low, 10.5 moderate', () => {
    expect(calc(4, 3, 2, 1)).toMatchObject({ score: 10, category: 'low' })
    expect(calc(4, 3, 2, 1.5)).toMatchObject({ score: 10.5, category: 'moderate' })
  })

  it('missing global assessments are NOT treated as zero', () => {
    const r = calc(5, 3, null, 2)
    expect(r.status).toBe('incomplete')
    if (r.status === 'incomplete') {
      expect(r.issues.map((i) => i.field)).toEqual(['ptga'])
      expect(r.partialSum).toBe(10)
    }
    expect(calc(5, 3, undefined as unknown as number, null).status).toBe('incomplete')
  })

  it.each([
    ['negative TJC', -1, 0, 0, 0, 'tjc28'],
    ['TJC above 28', 29, 0, 0, 0, 'tjc28'],
    ['fractional SJC', 0, 2.5, 0, 0, 'sjc28'],
    ['PtGA above 10', 0, 0, 10.5, 0, 'ptga'],
    ['negative PrGA', 0, 0, 0, -0.5, 'prga'],
    ['NaN TJC', Number.NaN, 0, 0, 0, 'tjc28'],
    ['Infinity PtGA', 0, 0, Number.POSITIVE_INFINITY, 0, 'ptga'],
    ['0.05 resolution PrGA', 0, 0, 0, 0.05, 'prga'],
  ])('rejects %s', (_label, tjc, sjc, ptga, prga, field) => {
    const r = calc(tjc, sjc, ptga, prga)
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') expect(r.issues.some((i) => i.field === field && i.code !== 'missing')).toBe(true)
  })

  it('a non-number type is invalid, not zero', () => {
    const r = computeCdai({ tjc28: '5' as unknown as number, sjc28: 0, ptga: 0, prga: 0 })
    expect(r.status).toBe('invalid')
  })
})

describe('parseNumericInput', () => {
  it('maps empty to null (missing) and junk to NaN', () => {
    expect(parseNumericInput('')).toBeNull()
    expect(parseNumericInput('  ')).toBeNull()
    expect(parseNumericInput('4,5')).toBe(4.5)
    expect(parseNumericInput('7')).toBe(7)
    expect(parseNumericInput('abc')).toBeNaN()
    expect(parseNumericInput('1e3')).toBeNaN()
  })
})

describe('parity with the official MDCalc calculator (#2177)', () => {
  // Captured by driving https://www.mdcalc.com/calc/2177 directly (see docs/CLINICAL_NOTES.md).
  const mdcalc: [number, number, number, number, number, string][] = [
    [6, 4, 5, 3, 18, 'moderate'],
    [0, 0, 1.5, 1, 2.5, 'remission'],
    [0, 1, 1.5, 0.5, 3, 'low'],
    [0, 0, 1.5, 1.5, 3, 'low'],
    [4, 3, 2, 1, 10, 'low'],
    [4, 3, 2, 1.5, 10.5, 'moderate'],
    [10, 5, 3.5, 3.5, 22, 'moderate'],
    [10, 5, 4, 3.5, 22.5, 'high'],
    [28, 28, 10, 10, 76, 'high'],
  ]
  it.each(mdcalc)('TJC %s + SJC %s + PtGA %s + PrGA %s = %s (%s)', (t, s, p, r, score, category) => {
    expect(calc(t, s, p, r)).toMatchObject({ status: 'complete', score, category })
  })
})
