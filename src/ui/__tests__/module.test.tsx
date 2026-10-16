import { render, screen, waitFor } from '@testing-library/react'
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
const stepButton = (n: number) => screen.getByRole('navigation', { name: 'Steps' }).querySelectorAll('button')[n - 1] as HTMLButtonElement

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

describe('quick joint examination: tap only the affected joints', () => {
  it('renders every registry joint across the front and back charts', async () => {
    const { user } = mount()
    await ready()
    const ids = () => new Set(Array.from(document.querySelectorAll('g.marker2d')).map((g) => g.getAttribute('data-joint-id')))
    const front = ids()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(new Set([...front, ...ids()]).size).toBe(54)
  })

  it('shows the 28-joint form with a T and S button for every joint', async () => {
    mount()
    await ready()
    expect(screen.getByRole('heading', { name: 'Tap the affected joints' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: / tender$/ })).toHaveLength(28)
    expect(screen.getAllByRole('button', { name: / swollen$/ })).toHaveLength(28)
  })

  it('a typical exam is a few taps plus one "Done" (all other joints become normal)', async () => {
    const { user } = mount()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Right wrist tender' }))
    await user.click(screen.getByRole('button', { name: 'Right wrist swollen' }))
    await user.click(screen.getByRole('button', { name: 'Left knee tender' }))
    expect(screen.getByTestId('count-tender')).toHaveTextContent('2')
    expect(screen.getByTestId('count-swollen')).toHaveTextContent('1')
    expect(screen.getByTestId('progress-count')).toHaveTextContent('1/28')

    await user.click(screen.getByTestId('joints-done'))
    // moved to the rating step with all 28 recorded and the findings untouched
    expect(screen.getByText(/From the joint check/)).toHaveTextContent('2 tender · 1 swollen')
    expect(screen.queryByText(/joints not checked yet/)).not.toBeInTheDocument()
  })

  it('tapping the body applies the chosen marker; extra joints never change the counts', async () => {
    const { user } = mount()
    await ready()
    await user.click(marker('knee_r')) // default tool = Tender
    expect(screen.getByRole('button', { name: 'Right knee tender' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /Swollen/ }))
    await user.click(marker('knee_r'))
    expect(screen.getByRole('button', { name: 'Right knee swollen' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(marker('ankle_l')) // pain-map joint
    expect(screen.getByTestId('selected-joint-name')).toHaveTextContent('Left ankle')
    expect(screen.getByTestId('count-swollen')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: /Erase/ }))
    await user.click(marker('knee_r'))
    expect(screen.getByRole('button', { name: 'Right knee tender' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('count-tender')).toHaveTextContent('0')
  })

  it('turning a finding off after "Done" keeps the joint examined (negative, not unknown)', async () => {
    const { user } = mount()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Right wrist tender' }))
    await user.click(screen.getByTestId('joints-done'))
    await user.click(stepButton(1))
    await user.click(screen.getByRole('button', { name: 'Right wrist tender' }))
    expect(screen.getByTestId('progress-count')).toHaveTextContent('28/28')
    expect(screen.getByTestId('count-tender')).toHaveTextContent('0')
  })

  it('Done is undoable', async () => {
    const { user } = mount()
    await ready()
    await user.click(screen.getByTestId('joints-done'))
    await user.click(stepButton(1))
    expect(screen.getByTestId('progress-count')).toHaveTextContent('28/28')
    await user.click(screen.getByRole('button', { name: '↶ Undo' }))
    expect(screen.getByTestId('progress-count')).toHaveTextContent('0/28')
  })

  it('shows no score until everything is entered', async () => {
    const { user } = mount()
    await ready()
    await user.click(stepButton(3))
    expect(screen.getByTestId('cdai-score')).toHaveTextContent('—')
    expect(screen.getByTestId('cdai-category')).toHaveTextContent('Not finished yet')
  })
})

describe('saving and reopening', () => {
  it('reopens a saved assessment with the same findings and score (6+4+5+3 = 18)', async () => {
    const repo = new MemoryAssessmentRepository()
    await seed(repo)
    const { user } = mount(repo)
    await waitFor(() => expect(screen.getByTestId('assessment-status')).toHaveTextContent('Ready to finalize'))
    await user.click(stepButton(3))
    expect(screen.getByTestId('cdai-score')).toHaveTextContent('18')
    expect(screen.getByTestId('cdai-category')).toHaveTextContent('Moderate disease activity')
  })

  it('a finalized assessment is locked and offers amendment', async () => {
    const repo = new MemoryAssessmentRepository()
    await seed(repo, 'finalize')
    mount(repo)
    await waitFor(() => expect(screen.getByTestId('assessment-status')).toHaveTextContent('Finalized'))
    expect(screen.getByText(/This assessment is finalized/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Right wrist tender' })).toBeDisabled()
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
    await user.click(screen.getByRole('button', { name: 'Right wrist tender' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be saved/i)
    expect(alert).toHaveTextContent(/still on screen/i)
    expect(screen.getByRole('button', { name: 'Right wrist tender' })).toHaveAttribute('aria-pressed', 'true')
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
    await user.click(screen.getByRole('button', { name: 'Right wrist tender' }))
    const btn = screen.getByRole('button', { name: 'Save draft' })
    await user.click(btn)
    await user.click(btn)
    release()
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('Saved'))
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('permissions', () => {
  it('view-only users cannot change answers', async () => {
    const { user } = mount(new MemoryAssessmentRepository(), ctx(false))
    await ready()
    expect(screen.getByText(/view-only access/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Right wrist tender' })).toBeDisabled()
    await user.click(marker('wrist_r'))
    expect(screen.getByTestId('count-tender')).toHaveTextContent('0')
    expect(screen.queryByTestId('joints-done')).not.toBeInTheDocument()
  })
})
