// End-to-end test of the simple 3-step flow, including CDAI calculations through the real UI.
// Usage: node e2e/flow.mjs [baseUrl] [screenshotDir]
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5199/'
const OUT = process.argv[3] ?? 'e2e/out'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 160)}`))

let passed = 0
let failed = 0
const check = (name, cond, extra = '') => {
  if (cond) passed++
  else failed++
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` ${extra}`}`)
}
const step = (t) => console.log(`\n${t}`)
const txt = async (sel) => (await page.locator(sel).first().innerText()).trim()
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })
const wait = (ms = 350) => page.waitForTimeout(ms)
const btn = (name, exact = true) => page.getByRole('button', { name, exact })
const goStep = async (n) => {
  await page.getByRole('navigation', { name: 'Steps' }).getByRole('button').nth(n - 1).click()
  await wait(200)
}
const score = () => txt('[data-testid=cdai-score]')
const category = () => txt('[data-testid=cdai-category]')
const ptgaSlider = () => page.getByRole('slider', { name: "Patient's rating" })
const prgaSlider = () => page.getByRole('slider', { name: "Doctor's rating" })
const setRating = async (slider, v) => {
  await slider().fill(String(v))
  await wait(120)
}
const tjcBox = () => page.getByRole('textbox', { name: 'Tender joints' })
const sjcBox = () => page.getByRole('textbox', { name: 'Swollen joints' })
const typeCount = async (box, v) => {
  await box().fill(String(v))
  await box().press('Enter')
  await wait(100)
}
const click3d = async (id) => {
  const pt = await page.evaluate((i) => window.__rheum.project(i), id)
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.mouse.up()
  await wait(250)
}

await page.goto(BASE + '?e2e', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.goto(BASE + '?e2e', { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await wait(2500)

step('1. First screen is simple')
check('status "Not started"', (await txt('[data-testid=assessment-status]')) === 'Not started')
check('clear instruction', await page.getByRole('heading', { name: 'Tap the affected joints' }).isVisible())
check('28-joint form: 28 T + 28 S buttons', (await page.getByRole('button', { name: / tender$/ }).count()) === 28 && (await page.getByRole('button', { name: / swollen$/ }).count()) === 28)
await shot('01-start')

step('2. Mark only the affected joints (form + body)')
await btn('Right wrist tender').click()
await btn('Right wrist swollen').click()
check('form taps counted', (await txt('[data-testid=count-tender]')) === '1' && (await txt('[data-testid=count-swollen]')) === '1')
await btn('Reset view', false).click()
await wait(1300)
await click3d('knee_l') // default tool: Tender
check('3D tap with "Tender" marks Left knee', (await btn('Left knee tender').getAttribute('aria-pressed')) === 'true')
await btn('Joint chart').click()
await wait(300)
await page.locator('g.marker2d[data-joint-id=ankle_l]').click()
check('Left ankle can be marked but is not counted', (await txt('[data-testid=count-tender]')) === '2')
await btn('3D body').click()
await page.waitForSelector('canvas')
await wait(2000)
await btn('Back').click()
await wait(1300)
await click3d('knee_l') // the knee marker sits on the front of the leg: hidden from behind
check('a joint hidden behind the body cannot be tapped through it', (await txt('[data-testid=selected-joint-name]')) === 'Left ankle' && (await txt('[data-testid=count-tender]')) === '2')
await btn('Front').click()
await wait(1000)
await shot('02-marked')

step('3. One tap finishes the joints')
check('Done button names the remaining joints', (await txt('[data-testid=joints-done]')).includes('27'))
await page.getByTestId('joints-done').click()
await wait(300)
check('moved to the rating step', await page.getByRole('heading', { name: 'How is the patient doing overall?' }).isVisible())
check('counts kept: 2 tender · 1 swollen', (await page.getByText(/From the joint check/).innerText()).includes('2 tender · 1 swollen'))

step('4. Undo is available')
await goStep(1)
check('28/28 recorded', (await txt('[data-testid=progress-count]')) === '28/28')
await page.getByRole('button', { name: '↶ Undo' }).click()
check('undo restores', (await txt('[data-testid=progress-count]')) === '1/28')
await page.getByTestId('joints-done').click()
await wait(300)

step('5. Rating step')
check('ratings start "Not rated yet" (never 0)', (await txt('[data-testid=ptga-value]')) === 'Not rated yet')
await setRating(ptgaSlider, 5)
for (let i = 0; i < 5; i++) await page.getByRole('button', { name: "Doctor's rating: higher" }).click()
check('PtGA 5.0 via slider', (await txt('[data-testid=ptga-value]')) === '5.0')
check('PrGA 2.0 via + button', (await txt('[data-testid=prga-value]')) === '2.0')

step('6. Calculations through the UI (MDCalc boundaries)')
await page.getByTestId('to-result').click()
check('2 + 1 + 5 + 2 = 10 → Low (upper boundary)', (await score()) === '10' && (await category()).includes('Low'))
await goStep(2)
await page.getByRole('button', { name: "Doctor's rating: higher" }).click()
await goStep(3)
check('10.5 → Moderate', (await score()) === '10.5' && (await category()).includes('Moderate'))
await goStep(2)
await btn('Type the counts instead').click()
const cases = [
  [0, 0, 1.5, 1, '2.5', 'Remission'],
  [0, 0, 1.5, 1.5, '3', 'Low'],
  [10, 5, 3.5, 3.5, '22', 'Moderate'],
  [10, 5, 4, 3.5, '22.5', 'High'],
  [6, 4, 5, 3, '18', 'Moderate'],
  [28, 28, 10, 10, '76', 'High'],
  [0, 0, 0, 0, '0', 'Remission'],
]
for (const [t, s, pt, pr, exp, cat] of cases) {
  await goStep(2)
  await typeCount(tjcBox, t)
  await typeCount(sjcBox, s)
  await setRating(ptgaSlider, pt)
  await setRating(prgaSlider, pr)
  await goStep(3)
  const got = `${await score()} ${await category()}`
  check(`${t} + ${s} + ${pt} + ${pr} = ${exp} → ${cat}`, (await score()) === exp && (await category()).includes(cat), `(got ${got})`)
}
await goStep(2)
await typeCount(tjcBox, 29)
check('29 joints rejected', await page.getByText('Enter a whole number from 0 to 28').isVisible())
await typeCount(tjcBox, 1)
await btn('Use the joint check instead').click()
await setRating(ptgaSlider, 5)
await setRating(prgaSlider, 2)
await goStep(3)
check('back to joint check: 10 Low', (await score()) === '10')
await shot('03-result')

step('7. Save, reload, reopen')
await page.locator('.step-footer').getByRole('button', { name: 'Save draft' }).click()
await wait(500)
check('saved', (await txt('[data-testid=save-state]')) === 'Saved')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await wait(1500)
await goStep(3)
check('reopened with the same score', (await score()) === '10')

step('8. Finalize and amend')
await page.getByRole('button', { name: 'Finalize…' }).click()
await btn('Finalize').click()
await wait(500)
check('status Finalized', (await txt('[data-testid=assessment-status]')) === 'Finalized')
check('answers locked', await page.getByRole('button', { name: 'Amend…' }).isVisible())
await page.getByRole('button', { name: 'Amend…' }).click()
await goStep(2)
await page.getByRole('button', { name: "Doctor's rating: higher" }).click()
await goStep(3)
await page.getByRole('button', { name: 'Save amendment…' }).click()
check('reason required', await btn('Save amendment').isDisabled())
await page.getByPlaceholder(/Doctor's rating corrected/).fill('Doctor rating corrected after review')
await btn('Save amendment').click()
await wait(500)
check('amended 10.5 Moderate', (await score()) === '10.5' && (await category()).includes('Moderate'))
await page.getByRole('button', { name: /Show details/ }).click()
check('change history kept', await page.getByText('Changes to this assessment').isVisible())

step('9. New visit + history')
await page.getByRole('button', { name: /Demo options/ }).click()
await page.getByRole('button', { name: '+ New visit' }).click()
await wait(500)
check('new visit is empty', (await txt('[data-testid=assessment-status]')) === 'Not started')
await goStep(3)
await page.getByRole('button', { name: /Show details/ }).click()
check('history lists the earlier assessment', (await page.locator('table.history tbody tr').count()) === 1)

step('10. Joint chart (2D) works the same')
await btn('Joint chart').click()
await wait(300)
await page.locator('g.marker2d[data-joint-id=mcp2_r]').click()
check('chart tap marks the joint', (await btn('Right MCP 2 (index) tender').getAttribute('aria-pressed')) === 'true')
check('chart answer counted', (await txt('[data-testid=count-tender]')) === '1')
await btn('3D body').click()

step('11. Read-only role')
await page.getByLabel('Role').selectOption('viewer')
await wait(500)
check('view-only banner', await page.getByText(/view-only access/i).isVisible())

step('12. Responsive')
for (const [w, h, n] of [[1024, 768, 'tablet-landscape'], [820, 1180, 'tablet'], [390, 844, 'phone'], [360, 640, 'small-phone']]) {
  await page.setViewportSize({ width: w, height: h })
  await wait(700)
  await shot(`04-${n}`)
  check(`${n} ${w}×${h}: no sideways scrolling`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)))
}

step('13. Runtime errors')
check('no errors in the console', problems.length === 0, problems.join(' | '))

console.log(`\n${passed} passed, ${failed} failed`)
await browser.close()
process.exit(failed ? 1 : 0)
