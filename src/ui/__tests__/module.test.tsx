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
const ready = () => waitFor(() => expect(screen.getByTestId('assessment-status')).not.toHaveTextContent('Loading'))

async function toRating(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('to-rating'))
}

async function seed(repo: MemoryAssessmentRepository, intent: SaveRequest['intent'] = 'draft') {
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

describe('2D chart supports the full examination workflow', () => {
  it('renders every registry joint across the front and back charts', async () => {
    const { user } = mount()
    await ready()
    const ids = () => new Set(Array.from(document.querySelectorAll('g.marker2d')).map((g) => g.getAttribute('data-joint-id')))
    const front = ids()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    const back = ids()
    expect(back.has('lumbar_spine')).toBe(true)
    expect(new Set([...front, ...back]).size).toBe(54)
  })

  it('starts with a simple prompt and walks through the joints', async () => {
    const { user } = mount()
    await ready()
    expect(screen.getByRole('heading', { name: "Let's check the joints" })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByTestId('selected-joint-name')).toHaveTextContent('Right shoulder')
    expect(screen.getByText('Joint 1 of 28')).toBeInTheDocument()
  })

  it('records tender / swollen independently and keeps extra joints out of the count', async () => {
    const { user } = mount()
    await ready()

    await user.click(marker('wrist_r'))
    expect(screen.getByTestId('selected-joint-name')).toHaveTextContent('Right wrist')
    await user.click(screen.getByRole('button', { name: 'Yes, tender' }))
    await user.click(screen.getByRole('button', { name: 'Yes, swollen' }))

    // an ankle is an "extra" joint: never counted
    await user.click(marker('ankle_l'))
    expect(screen.getByText(/not counted in the score/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, tender' }))
    await user.click(screen.getByRole('button', { name: 'Yes, swollen' }))

    await toRating(user)
    expect(screen.getByText(/From the joint check/)).toHaveTextContent('1 tender · 1 swollen')
    expect(screen.getByText(/27 joints not checked yet/)).toBeInTheDocument()
  })

  it('shows no score until everything is entered, then the exact CDAI', async () => {
    const { user } = mount()
    await ready()
    await user.click(screen.getByRole('button', { name: /^3\s*Result$/ }))
    expect(screen.getByTestId('cdai-score')).toHaveTextContent('—')
    expect(screen.getByTestId('cdai-category')).toHaveTextContent('Not finished yet')
  })

  it('keyboard shortcut toggles tenderness', async () => {
    const { user } = mount()
    await ready()
    await user.click(marker('knee_l'))
    await user.keyboard('t')
    expect(screen.getByRole('button', { name: 'Yes, tender' })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('t')
    expect(screen.getByRole('button', { name: 'Yes, tender' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('saving and reopening', () => {
  it('reopens a saved assessment with the same findings and score (6+4+5+3 = 18)', async () => {
    const repo = new MemoryAssessmentRepository()
    await seed(repo)
    const { user } = mount(repo)
    await waitFor(() => expect(screen.getByTestId('assessment-status')).toHaveTextContent('Ready to finalize'))
    await user.click(screen.getByRole('button', { name: /^3\s*Result$/ }))
    expect(screen.getByTestId('cdai-score')).toHaveTextContent('18')
    expect(screen.getByTestId('cdai-category')).toHaveTextContent('Moderate disease activity')
  })

  it('a finalized assessment is locked and offers amendment', async () => {
    const repo = new MemoryAssessmentRepository()
    await seed(repo, 'finalize')
    mount(repo)
    await waitFor(() => expect(screen.getByTestId('assessment-status')).toHaveTextContent('Finalized'))
    expect(screen.getByText(/This assessment is finalized/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Amend/ }).length).toBeGreaterThan(0)
  })

  it('a failed save keeps every answer on screen and says so', async () => {
    const base = new MemoryAssessmentRepository()
    const failing: AssessmentRepository = {
      getForConsultation: (p, c) => base.getForConsultation(p, c),
      listForPatient: (p) => base.listForPatient(p),
      save: vi.fn().mockRejectedValue(new Error('network down')),
    }
    const { user } = mount(failing)
    await ready()
    await user.click(marker('wrist_r'))
    await user.click(screen.getByRole('button', { name: 'Yes, tender' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be saved/i)
    expect(alert).toHaveTextContent(/still on screen/i)
    expect(screen.getByRole('button', { name: 'Yes, tender' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved changes')
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
    await user.click(screen.getByRole('button', { name: 'Yes, tender' }))
    const btn = screen.getByRole('button', { name: 'Save draft' })
    await user.click(btn)
    await user.click(btn)
    release()
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Saved'))
    expect(save).toHaveBeenCalledTimes(1)
    expect((await base.listForPatient('P-1')).length).toBe(1)
  })
})

describe('permissions', () => {
  it('view-only users cannot change answers', async () => {
    const { user } = mount(new MemoryAssessmentRepository(), ctx(false))
    await ready()
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument()
    await user.click(marker('wrist_r'))
    expect(screen.getByRole('button', { name: 'Yes, tender' })).toBeDisabled()
    const rating = within(document.body)
    expect(rating.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument()
  })
})
