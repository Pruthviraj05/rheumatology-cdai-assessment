import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyAssessment, markNormal, setGlobal, toPayload, updateJoint } from '../../domain/assessment'
import type { ConsultationContext } from '../../domain/context'
import { CDAI28_JOINTS } from '../../domain/joints'
import type { SaveRequest } from '../../domain/records'
import { MemoryAssessmentRepository, type AssessmentRepository } from '../../persistence/repository'
import RheumatologyAssessmentModule from '../RheumatologyAssessmentModule'

const ctx = (canEdit = true): ConsultationContext => ({
  patient: { id: 'P-1', name: 'Test Patient' },
  consultation: { id: 'C-1', date: '2026-10-16' },
  clinician: { id: 'dr', name: 'Dr Test' },
  permissions: { canView: true, canEdit },
})

const all28 = CDAI28_JOINTS.map((j) => j.id)

function mount(repo: AssessmentRepository = new MemoryAssessmentRepository(), context = ctx()) {
  const user = userEvent.setup()
  render(<RheumatologyAssessmentModule context={context} repository={repo} initialStageMode="2d" />)
  return { user, repo }
}

const marker = (id: string) => document.querySelector<SVGGElement>(`g.marker2d[data-joint-id="${id}"]`)!
const stat = (name: string) => screen.getByTestId(`stat-${name}`)

async function ready() {
  await waitFor(() => expect(screen.getByTestId('assessment-status')).not.toHaveTextContent('Loading'))
}

describe('2D fallback supports the full examination workflow', () => {
  it('renders every registry joint as an operable marker across the front and back charts', async () => {
    const { user } = mount()
    await ready()
    const ids = () => new Set(Array.from(document.querySelectorAll('g.marker2d')).map((g) => g.getAttribute('data-joint-id')))
    const front = ids()
    expect(front.has('tmj_r')).toBe(true)
    expect(front.has('lumbar_spine')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    const back = ids()
    expect(back.has('lumbar_spine')).toBe(true)
    expect(back.has('cervical_spine')).toBe(true)
    expect(new Set([...front, ...back]).size).toBe(54)
  })

  it('selects joints, records independent findings and updates counts', async () => {
    const { user } = mount()
    await ready()

    await user.click(marker('wrist_r'))
    expect(screen.getByTestId('selected-joint-name')).toHaveTextContent('Right wrist')
    await user.click(screen.getByRole('button', { name: 'Tender' }))
    expect(stat('tender')).toHaveTextContent('1')
    expect(stat('swollen')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'Swollen' }))
    expect(stat('swollen')).toHaveTextContent('1')

    // ankle is a pain-map joint: must not change TJC28 / SJC28
    await user.click(marker('ankle_l'))
    await user.click(screen.getByRole('button', { name: 'Tender' }))
    await user.click(screen.getByRole('button', { name: 'Swollen' }))
    expect(stat('tender')).toHaveTextContent('1')
    expect(stat('swollen')).toHaveTextContent('1')

    // unexamined joints are not negatives
    expect(stat('unexamined')).toHaveTextContent('27')
    expect(screen.getByTestId('summary-score')).toHaveTextContent('—')
  })

  it('computes the live CDAI and keeps keyboard shortcuts working', async () => {
    const { user } = mount()
    await ready()
    await user.click(marker('knee_l'))
    await user.keyboard('t')
    expect(stat('tender')).toHaveTextContent('1')
    await user.keyboard('t') // toggles to not tender
    expect(stat('tender')).toHaveTextContent('0')
    await user.keyboard('p')
    expect(within(screen.getByLabelText('Recorded findings summary')).getByText('Pain')).toBeInTheDocument()
  })
})

describe('persistence behaviour', () => {
  async function seedComplete(repo: MemoryAssessmentRepository, intent: SaveRequest['intent'] = 'draft') {
    let d = markNormal(createEmptyAssessment(), all28)
    for (const id of ['wrist_r', 'mcp2_r', 'mcp3_r', 'knee_l', 'wrist_l', 'pip2_l']) d = updateJoint(d, id, { tenderness: 'tender' })
    for (const id of ['wrist_r', 'mcp2_r', 'mcp3_r', 'knee_l']) d = updateJoint(d, id, { swelling: 'swollen' })
    d = setGlobal(setGlobal(d, 'ptga', 5), 'prga', 3)
    await repo.save({
      intent,
      patientId: 'P-1',
      consultationId: 'C-1',
      consultationDate: '2026-10-16',
      clinician: { id: 'dr', name: 'Dr Test' },
      payload: toPayload(d),
      expectedRevision: 0,
    })
  }

  it('reopens a saved assessment with the same findings and score (6+4+5+3 = 18)', async () => {
    const repo = new MemoryAssessmentRepository()
    await seedComplete(repo)
    mount(repo)
    await waitFor(() => expect(screen.getByTestId('summary-score')).toHaveTextContent('18'))
    expect(stat('tender')).toHaveTextContent('6')
    expect(stat('swollen')).toHaveTextContent('4')
    expect(screen.getByText('Moderate disease activity')).toBeInTheDocument()
  })

  it('a finalized assessment is locked and offers amendment', async () => {
    const repo = new MemoryAssessmentRepository()
    await seedComplete(repo, 'finalize')
    mount(repo)
    await waitFor(() => expect(screen.getByTestId('assessment-status')).toHaveTextContent('Finalized'))
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Amend/ }).length).toBeGreaterThan(0)
  })

  it('a failed save keeps every entry on screen and reports the error', async () => {
    const base = new MemoryAssessmentRepository()
    const failing: AssessmentRepository = {
      getForConsultation: (p, c) => base.getForConsultation(p, c),
      listForPatient: (p) => base.listForPatient(p),
      save: vi.fn().mockRejectedValue(new Error('network down')),
    }
    const { user } = mount(failing)
    await ready()
    await user.click(marker('wrist_r'))
    await user.click(screen.getByRole('button', { name: 'Tender' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i)
    expect(stat('tender')).toHaveTextContent('1')
    expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled() // can retry
  })

  it('prevents duplicate saves while one is in flight', async () => {
    const base = new MemoryAssessmentRepository()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const save = vi.fn(async (req: SaveRequest) => {
      await gate
      return base.save(req)
    })
    const repo: AssessmentRepository = {
      getForConsultation: (p, c) => base.getForConsultation(p, c),
      listForPatient: (p) => base.listForPatient(p),
      save,
    }
    const { user } = mount(repo)
    await ready()
    await user.click(marker('wrist_r'))
    await user.click(screen.getByRole('button', { name: 'Tender' }))
    const btn = screen.getByRole('button', { name: 'Save draft' })
    await user.click(btn)
    await user.click(btn) // second click while the first is pending
    release()
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent(/Draft saved/))
    expect(save).toHaveBeenCalledTimes(1)
    expect((await base.listForPatient('P-1')).length).toBe(1)
  })
})

describe('permissions', () => {
  it('view-only users cannot change findings', async () => {
    const { user } = mount(new MemoryAssessmentRepository(), ctx(false))
    await ready()
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument()
    await user.click(marker('wrist_r'))
    expect(screen.getByRole('button', { name: 'Tender' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  })
})
