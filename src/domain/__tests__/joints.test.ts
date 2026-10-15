import { describe, expect, it } from 'vitest'
import { CDAI28_JOINTS, JOINTS, JOINT_BY_ID, NAV_GROUPS, isValidJointId } from '../joints'

describe('canonical joint registry', () => {
  it('has exactly the 28-joint CDAI set', () => {
    expect(CDAI28_JOINTS).toHaveLength(28)
    const count = (g: string) => CDAI28_JOINTS.filter((j) => j.group === g).length
    expect(count('shoulder')).toBe(2)
    expect(count('elbow')).toBe(2)
    expect(count('wrist')).toBe(2)
    expect(count('mcp')).toBe(10)
    expect(count('pip')).toBe(10)
    expect(count('knee')).toBe(2)
  })

  it('is bilateral for every paired group', () => {
    for (const g of ['shoulder', 'elbow', 'wrist', 'mcp', 'pip', 'knee']) {
      const rows = CDAI28_JOINTS.filter((j) => j.group === g)
      expect(rows.filter((j) => j.side === 'L').length).toBe(rows.filter((j) => j.side === 'R').length)
    }
  })

  it('never counts feet, ankles, hips, DIP, TMJ or spine', () => {
    const excluded = ['ankle', 'mtp', 'hip', 'dip', 'tmj', 'spine']
    for (const j of JOINTS) if (excluded.includes(j.group)) expect(j.cdai28).toBe(false)
    expect(JOINTS.filter((j) => j.group === 'mtp')).toHaveLength(10)
    expect(JOINTS.filter((j) => j.group === 'ankle')).toHaveLength(2)
  })

  it('has unique, stable, valid IDs and complete geometry', () => {
    const ids = JOINTS.map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const j of JOINTS) {
      expect(isValidJointId(j.id)).toBe(true)
      expect(j.position.every(Number.isFinite)).toBe(true)
      expect(Number.isFinite(j.map2d.x) && Number.isFinite(j.map2d.y)).toBe(true)
    }
    expect(isValidJointId('constructor')).toBe(false)
    expect(isValidJointId('__proto__')).toBe(false)
    expect(JOINT_BY_ID['wrist_r'].name).toBe('Right wrist')
  })

  it('places patient-right joints on −x and patient-left on +x', () => {
    for (const j of JOINTS) {
      if (j.side === 'R') expect(j.position[0]).toBeLessThan(0)
      if (j.side === 'L') expect(j.position[0]).toBeGreaterThan(0)
    }
  })

  it('navigation groups cover every joint exactly once', () => {
    const all = NAV_GROUPS.flatMap((g) => g.jointIds)
    expect(all).toHaveLength(JOINTS.length)
    expect(new Set(all).size).toBe(JOINTS.length)
  })
})
