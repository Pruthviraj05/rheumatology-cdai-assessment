import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssessmentData } from '../domain/assessment'
import type { View } from '../domain/joints'
import type { SceneController, ViewName } from '../scene/Body3D'
import BodyMap2D from './BodyMap2D'
import { KIND_META, PAIN_COLOR } from './status'

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
  initialMode?: StageMode
  /** Ask the camera to follow a joint (guided examination). */
  focusRequest: { jointId: string; nonce: number } | null
}

const MODE_KEY = 'rheum-cdai.stage-mode'

function LegendDot({ color, label, dashed, ring }: { color: string; label: string; dashed?: boolean; ring?: boolean }) {
  return (
    <li>
      <span className={`ldot${ring ? ' ring' : ''}${dashed ? ' dashed' : ''}`} style={ring ? { borderColor: color } : { background: color }} />
      {label}
    </li>
  )
}

/** The body: 3D model or 2D chart, with only the controls a clinician needs. */
export default function BodyStage({ data, selectedId, onSelect, initialMode, focusRequest }: Props) {
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
  const [showBones, setShowBones] = useState(false)
  const controller = useRef<SceneController | null>(null)

  const effective: StageMode = supported && !failure ? mode : '2d'

  useEffect(() => {
    try {
      if (!initialMode) window.localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* preference only */
    }
  }, [mode, initialMode])

  // Camera follows the guided examination. Retry briefly: the lazy scene may still be mounting.
  const lastNonce = useRef(0)
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastNonce.current || effective !== '3d') return
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      if (controller.current) {
        controller.current.focusJoint(focusRequest.jointId)
        lastNonce.current = focusRequest.nonce
        window.clearInterval(id)
      } else if (tries > 20) window.clearInterval(id)
    }, 100)
    return () => window.clearInterval(id)
  }, [focusRequest, effective])

  const onViewChange = useCallback((v: ViewName | null) => setView3d(v), [])

  return (
    <div className="stage">
      <div className="stage-toolbar">
        <div className="seg" role="group" aria-label="Display mode">
          <button type="button" aria-label="3D body" aria-pressed={effective === '3d'} disabled={!supported || !!failure} onClick={() => setMode('3d')}>
            3D<span className="wide-only"> body</span>
          </button>
          <button type="button" aria-label="Joint chart" aria-pressed={effective === '2d'} onClick={() => setMode('2d')}>
            <span className="wide-only">Joint chart</span>
            <span className="narrow-only">Chart</span>
          </button>
        </div>
        {effective === '3d' && (
          <>
            <div className="seg" role="group" aria-label="Side of the body">
              <button
                type="button"
                aria-pressed={view3d === 'front'}
                onClick={() => {
                  controller.current?.setView('front')
                  setView3d('front')
                }}
              >
                Front
              </button>
              <button
                type="button"
                aria-pressed={view3d === 'back'}
                onClick={() => {
                  controller.current?.setView('back')
                  setView3d('back')
                }}
              >
                Back
              </button>
            </div>
            <button type="button" className="toggle" aria-pressed={showBones} onClick={() => setShowBones((v) => !v)} title="Show the skeleton through the skin">
              X-ray
            </button>
            <button
              type="button"
              className="link"
              aria-label="Reset view"
              onClick={() => {
                controller.current?.reset()
                setView3d('front')
              }}
            >
              Reset<span className="wide-only"> view</span>
            </button>
          </>
        )}
      </div>

      {(!supported || failure) && (
        <p className="stage-notice" role="status">
          3D isn't available on this device — the joint chart works the same way.
        </p>
      )}

      <div className="stage-canvas" data-mode={effective}>
        {effective === '3d' ? (
          <SceneBoundary onFail={(e) => setFailure(String(e))}>
            <Suspense fallback={<div className="stage-loading">Loading 3D body…</div>}>
              <Body3D
                data={data}
                selectedId={selectedId}
                onSelect={onSelect}
                controllerRef={controller}
                onViewChange={onViewChange}
                highlightIds={null}
                showBones={showBones}
              />
            </Suspense>
            <div className="stage-hint" aria-hidden="true">
              Drag to turn · scroll to zoom · tap a joint
            </div>
          </SceneBoundary>
        ) : (
          <BodyMap2D data={data} selectedId={selectedId} onSelect={onSelect} view={view2d} onViewChange={setView2d} highlightIds={null} />
        )}
      </div>

      <ul className="mini-legend" aria-label="What the colours mean">
        <LegendDot color={KIND_META.tender.color} label="Tender" />
        <LegendDot color={KIND_META.swollen.color} label="Swollen" />
        <LegendDot color={KIND_META.both.color} label="Both" />
        <LegendDot color={KIND_META.normal.color} label="Normal" />
        <LegendDot color="#ffffff" label="Not checked" dashed />
        <LegendDot color={PAIN_COLOR} label="Pain reported" ring />
      </ul>
      <p className="stage-proto">Stylised 3D model for orientation — not a medically accurate anatomical model.</p>
    </div>
  )
}
