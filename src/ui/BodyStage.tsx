import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssessmentData } from '../domain/assessment'
import { REGIONS, type RegionId, type View } from '../domain/joints'
import type { SceneController, ViewName } from '../scene/Body3D'
import BodyMap2D from './BodyMap2D'
import Legend from './Legend'

const Body3D = lazy(() => import('../scene/Body3D'))

export type StageMode = '3d' | '2d'

export function webglAvailable(): boolean {
  try {
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

class SceneBoundary extends Component<{ onFail(e: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onFail(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

interface Props {
  data: AssessmentData
  selectedId: string | null
  onSelect(id: string): void
  highlightIds: ReadonlySet<string> | null
  /** Force a mode (tests / hosts without WebGL). */
  initialMode?: StageMode
  onFocusRegion?(firstJointId: string | undefined): void
}

const VIEW_BUTTONS: { id: ViewName; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

const MODE_KEY = 'rheum-cdai.stage-mode'

export default function BodyStage({ data, selectedId, onSelect, highlightIds, initialMode, onFocusRegion }: Props) {
  const supported = useMemo(() => webglAvailable(), [])
  const [mode, setMode] = useState<StageMode>(() => {
    if (initialMode) return initialMode
    if (!supported) return '2d'
    try {
      return window.localStorage.getItem(MODE_KEY) === '2d' ? '2d' : '3d'
    } catch {
      return '3d'
    }
  })
  const [failure, setFailure] = useState<string | null>(null)
  const [view3d, setView3d] = useState<ViewName | null>('front')
  const [view2d, setView2d] = useState<View>('front')
  const [region, setRegion] = useState<RegionId>('full')
  const controller = useRef<SceneController | null>(null)

  const effective: StageMode = supported && !failure ? mode : '2d'

  useEffect(() => {
    try {
      if (!initialMode) window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* preference only */
    }
  }, [mode, initialMode])

  // Selecting a joint outside the visible region should not move the camera abruptly; we only
  // focus the camera when the clinician explicitly picks a region.
  const focus = useCallback(
    (id: RegionId) => {
      setRegion(id)
      if (effective === '3d') controller.current?.focusRegion(id)
      onFocusRegion?.(REGIONS.find((r) => r.id === id)?.firstJointId)
    },
    [effective, onFocusRegion],
  )

  const onViewChange = useCallback((v: ViewName | null) => setView3d(v), [])

  return (
    <div className="stage">
      <div className="stage-toolbar">
        <div className="seg" role="group" aria-label="Display mode">
          <button type="button" aria-pressed={effective === '3d'} disabled={!supported || !!failure} onClick={() => setMode('3d')}>
            3D model
          </button>
          <button type="button" aria-pressed={effective === '2d'} onClick={() => setMode('2d')}>
            2D chart
          </button>
        </div>

        {effective === '3d' && (
          <>
            <div className="seg" role="group" aria-label="Camera view">
              {VIEW_BUTTONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  title={v.id === 'left' ? "View from the patient's left side" : v.id === 'right' ? "View from the patient's right side" : undefined}
                  aria-pressed={view3d === v.id}
                  onClick={() => {
                    controller.current?.setView(v.id)
                    setView3d(v.id)
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Zoom">
              <button type="button" onClick={() => controller.current?.zoom(0.75)} aria-label="Zoom in">
                ＋
              </button>
              <button type="button" onClick={() => controller.current?.zoom(1.33)} aria-label="Zoom out">
                －
              </button>
              <button
                type="button"
                onClick={() => {
                  controller.current?.reset()
                  setRegion('full')
                  setView3d('front')
                }}
              >
                Reset view
              </button>
            </div>
          </>
        )}
      </div>

      {effective === '3d' && (
        <div className="region-bar" role="group" aria-label="Jump to body region">
          {REGIONS.map((r) => (
            <button key={r.id} type="button" aria-pressed={region === r.id} onClick={() => focus(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {(!supported || failure) && (
        <p className="stage-notice" role="status">
          3D is not available on this device{failure ? ' (the 3D scene failed to load)' : ''} — the 2D chart supports the same
          examination workflow.
        </p>
      )}

      <div className="stage-canvas" data-mode={effective}>
        {effective === '3d' ? (
          <SceneBoundary onFail={(e) => setFailure(String(e))}>
            <Suspense fallback={<div className="stage-loading">Loading 3D model…</div>}>
              <Body3D
                data={data}
                selectedId={selectedId}
                onSelect={onSelect}
                controllerRef={controller}
                onViewChange={onViewChange}
                highlightIds={highlightIds}
              />
            </Suspense>
            <div className="stage-hint" aria-hidden="true">
              Drag: rotate · Scroll: zoom · Click a marker to examine
            </div>
            <div className="stage-badge">Procedural prototype model — not anatomically accurate</div>
          </SceneBoundary>
        ) : (
          <BodyMap2D
            data={data}
            selectedId={selectedId}
            onSelect={onSelect}
            view={view2d}
            onViewChange={setView2d}
            highlightIds={highlightIds}
          />
        )}
      </div>

      <Legend inline />
    </div>
  )
}
