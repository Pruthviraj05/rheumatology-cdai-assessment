import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { JOINTS } from '../../domain/joints'
import { GeometryBuilder, buildAnatomy } from '../anatomy'

describe('procedural anatomy', () => {
  const { skin, bones } = buildAnatomy(1)

  it('builds valid merged geometry with colours and normals (one draw call each)', () => {
    for (const g of [skin, bones]) {
      const pos = g.getAttribute('position')
      expect(pos.count).toBeGreaterThan(1000)
      expect(g.getAttribute('normal')).toBeTruthy()
      expect(g.getAttribute('color').count).toBe(pos.count)
      expect(g.groups.length).toBe(0)
      const arr = pos.array as Float32Array
      expect(arr.every(Number.isFinite)).toBe(true)
    }
  })

  it('has realistic adult proportions (≈1.8 m tall, feet on the floor) and is left/right symmetric', () => {
    const box = skin.boundingBox!
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01)
    expect(box.min.y).toBeLessThan(0.02)
    expect(box.max.y).toBeGreaterThan(1.8)
    expect(box.max.y).toBeLessThan(1.86)
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.01)
  })

  it('keeps every joint anchor within the body envelope', () => {
    const box = skin.boundingBox!.clone().expandByScalar(0.01)
    for (const j of JOINTS) expect(box.containsPoint(new THREE.Vector3(...j.position))).toBe(true)
  })

  it('skeleton sits inside the skin envelope', () => {
    const outer = skin.boundingBox!.clone().expandByScalar(0.01)
    expect(outer.containsBox(bones.boundingBox!)).toBe(true)
  })

  it('reduced detail produces fewer vertices (low-power devices)', () => {
    const low = buildAnatomy(0.75).skin
    expect(low.getAttribute('position').count).toBeLessThan(skin.getAttribute('position').count)
  })

  it('lofted surfaces face outward', () => {
    const b = new GeometryBuilder()
    b.loft(
      [
        { y: 1, rx: 0.2, rz: 0.1 },
        { y: 0.5, rx: 0.2, rz: 0.1 },
      ],
      new THREE.Color('#fff'),
      16,
    )
    const g = b.build()
    const pos = g.getAttribute('position')
    const nrm = g.getAttribute('normal')
    // vertex 0 is on the +x side of the top ring → its normal must point to +x (outward)
    expect(pos.getX(0)).toBeCloseTo(0.2)
    expect(nrm.getX(0)).toBeGreaterThan(0)
  })
})
