# Clinical notes & items requiring rheumatologist approval

> This software records findings and calculates a published index. It does not diagnose,
> recommend treatment or replace clinical judgement. It has **not** been clinically validated.
> All demo data is fictional.

## Calculation reference

* **CDAI = TJC28 + SJC28 + PtGA + PrGA** — range 0–76.
* Categories: remission ≤ 2.8 · low > 2.8–10 · moderate > 10–22 · high > 22 (unrounded total).
* Source: MDCalc "Clinical Disease Activity Index (CDAI) for Rheumatoid Arthritis" (creator Dr. Daniel Aletaha),
  and the original publications by Aletaha & Smolen. CRP/ESR are not part of the CDAI.

### Verification against the official calculator

Driven live on 2026-10-16:

| TJC | SJC | PtGA | PrGA | MDCalc | This module |
|---|---|---|---|---|---|
| 6 | 4 | 5 | 3 | 18.0 Moderate | 18 Moderate |
| 0 | 0 | 1.5 | 1 | 2.5 Remission | 2.5 Remission |
| 0 | 1 | 1.5 | 0.5 | 3.0 Low | 3 Low |
| 4 | 3 | 2 | 1 | 10.0 Low | 10 Low |
| 4 | 3 | 2 | 1.5 | 10.5 Moderate | 10.5 Moderate |
| 10 | 5 | 3.5 | 3.5 | 22.0 Moderate | 22 Moderate |
| 10 | 5 | 4 | 3.5 | 22.5 High | 22.5 High |
| 28 | 28 | 10 | 10 | 76.0 High | 76 High |

## Decisions that need rheumatologist sign-off

1. **Global assessment convention** — implemented as in MDCalc: 0 = very well, 10 = very poor, patient and
   physician scored independently. Confirm the clinic's wording of the patient question.
2. **Resolution of globals** — the engine accepts 0.1 steps (VAS in cm); the UI offers integer buttons, a +0.5
   toggle (MDCalc parity) and exact entry. Confirm whether finer than 0.5 should be allowed.
3. **Thumb IP counted as "PIP 1"** — standard 28-joint convention; confirm.
4. **"Not assessable" joints** (prosthesis, fusion, amputation) — recorded, never counted, and they satisfy
   completeness. This is not part of the published CDAI; confirm the clinic's handling (some protocols
   exclude the joint and note it, others require an assessable alternative).
5. **Completeness rule** — a CDAI is only produced when all 28 joints have *both* tenderness and swelling
   recorded (or are not assessable) and both globals are entered. Manual-count mode (as MDCalc) bypasses the joint
   examination but still requires both counts and both globals.
6. **"Everything else is normal"** — bulk convenience that fills only *missing* findings as negative after an
   explicit confirmation. Confirm it is acceptable in the clinic's documentation policy (undo is available).
7. **Non-CDAI joints** (TMJ, spine, hips, ankles, DIP, MTP) may carry tender/swollen findings for
   documentation; they never affect TJC28/SJC28.
8. **Finalize / amend** — finalized assessments are immutable except by amendment with a mandatory reason and
   retained previous version. Confirm required retention and who may amend.

## Known limitations

* The 3D body (with X-ray skeleton) is a **stylised procedural model**, not a medically accurate anatomical asset.
  A licensed model can replace `buildAnatomy()` in `src/scene/anatomy.ts`; the registry anchors and all clinical
  logic are independent of the mesh.
* Persistence in the demo is browser `localStorage`. A production deployment must implement
  `AssessmentRepository` against the clinic backend, re-run `applySave` server-side, enforce RBAC, and write to the
  existing audit log. No credentials or privileged logic live in this front end.
* Only the CDAI is implemented (no SDAI/DAS28, no ESR/CRP, no PROs).

## UX notes

* Step 1 asks the clinician to mark only abnormal joints (28-joint T/S form or taps on the body), then a single
  explicit button — "Done — the other N joints are normal" — records the unmarked joints as not tender / not
  swollen (`fillMissingAsNormal`, never overwrites a recorded finding, undoable). Until that button is pressed,
  unmarked joints remain "not examined" and no CDAI is produced. Confirm this matches the clinic's documentation
  policy (it is equivalent to ticking only abnormal joints on the paper 28-joint form).
* Turning a finding off after "Done" keeps the joint examined (negative), not "unknown".
