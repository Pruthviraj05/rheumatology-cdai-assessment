# Plan — Interactive 3D Rheumatology Joint Examination & CDAI Module

## 1. Findings from discovery

| Item | Finding | Consequence |
|---|---|---|
| Existing application | The working directory was empty — no clinic app, design system, routes or DB to inspect | Build the module as a self-contained, mountable component with an explicit **host seam** (`ConsultationContext` + `AssessmentRepository`). A small demo host stands in for the clinic app. |
| Official CDAI (MDCalc #2177, Dr. Daniel Aletaha) | `CDAI = TJC + SJC + Patient global + Provider global`; ≤2.8 remission, >2.8–10 low, >10–22 moderate, >22 high; globals are 0–10 in **0.5 steps** (0 = very well, 10 = very poor); CRP/ESR not used | Engine implements exactly this; MDCalc was driven directly to cross-check 9 cases incl. every boundary |
| Joint set | 28 joints: shoulders 2, elbows 2, wrists 2, MCP 1–5 ×2, PIP 1–5 ×2 (thumb IP = "PIP 1"), knees 2 | One canonical registry; feet/ankles/hips/DIP/TMJ/spine are pain-map only |

## 2. Architecture

```
src/domain      pure TypeScript — no React, no 3D        (source of truth for clinical logic)
  cdai.ts         compute / classify / validate (integer-tenths arithmetic)
  joints.ts       canonical registry, stable anatomical IDs, 3D + 2D anchors, nav groups, camera regions
  assessment.ts   findings model, derived counts, completeness, payload (de)serialisation + strict validation
  records.ts      draft → finalized → amended lifecycle, revision history, compare-and-swap saves
  context.ts      what the host hands in (patient / consultation / clinician / permissions)
src/persistence AssessmentRepository interface (+ localStorage and in-memory adapters)
src/scene       Body3D — react-three-fiber, procedural prototype body, markers, camera rig (lazy-loaded)
src/ui          Module shell, navigator, joint editor, score panel, review/history, 2D chart, summary bar
src/host        Demo host (patient / visit / role switcher) — NOT part of the module
e2e/            Playwright flow, perf & picking probes (drives the real browser)
```

Key decisions

* **Geometry ≠ clinical state.** The scene only maps registry IDs → positions and findings → marker appearance. Swapping the procedural body for a licensed GLB touches `scene/` only.
* **Counts are derived, never stored** → a joint can't be double counted; changing a finding updates the count exactly once.
* **Missing ≠ zero.** `null` globals and `unknown` findings are first-class; the score is shown only when complete.
* **Server-grade validation in the browser module:** `applySave` is pure and reusable server-side.
* **No treatment output.** The score is displayed as a measurement; no prescriptions/recommendations.

## 3. Delivery steps (all complete)

1. Research official CDAI definition (MDCalc) ✔
2. Domain engine + registry + tests ✔ (TDD, 70+ unit tests)
3. Persistence, lifecycle, revision history ✔
4. UI: navigator, joint editor, score panel, review, history ✔
5. 3D scene + 2D fallback + camera rig + smoothness work ✔
6. Responsive layouts (desktop / tablet / phone) ✔
7. End-to-end browser testing + fixes ✔ (53 checks, found/fixed real bugs)
8. Cross-validation against live MDCalc ✔
9. Repo + GitHub Pages deployment ✔

## 4. Test strategy

| Layer | What | Where |
|---|---|---|
| Unit | CDAI maths, boundaries, FP drift, validation, registry, counting, payload, lifecycle | `src/domain/__tests__` |
| Component | 2D workflow, failed save, duplicate-save guard, reopen, permissions | `src/ui/__tests__` |
| E2E | Real browser: 3D clicks, camera, bulk actions, undo, live CDAI, boundaries, save/reopen, finalize, amend, history, 2D, read-only, responsive | `e2e/flow.mjs` |
| Perf | Draw calls, frame pacing, hidden-marker picking | `e2e/perf.mjs` |
| Oracle | Official MDCalc outputs (fixtures in `cdai.test.ts`) | manual capture, documented |
