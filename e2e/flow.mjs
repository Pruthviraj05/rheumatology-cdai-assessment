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
check('one clear call to action', await btn('Start').isVisible())
await shot('01-start')

step('2. Guided check: two answers move to the next joint automatically')
await btn('Start').click()
await wait(300)
check('starts at Right shoulder', (await txt('[data-testid=selected-joint-name]')) === 'Right shoulder')
await page.getByRole('group', { name: 'Is it tender?' }).getByRole('button', { name: 'No' }).click()
await page.getByRole('group', { name: 'Is it swollen?' }).getByRole('button', { name: 'No' }).click()
await wait(700)
check('auto-advanced to Left shoulder', (await txt('[data-testid=selected-joint-name]')) === 'Left shoulder')
check('progress 1 of 28', (await txt('[data-testid=progress-count]')) === '1 of 28')
await wait(1200)
await shot('02-guided')

step('3. Tap joints on the 3D body')
await btn('Reset view', false).click()
await wait(1300)
await click3d('wrist_r')
check('3D tap selects Right wrist', (await txt('[data-testid=selected-joint-name]')) === 'Right wrist')
await btn('Yes, tender').click()
await btn('Yes, swollen').click()
await wait(600)
check('no auto-advance after a direct tap', (await txt('[data-testid=selected-joint-name]')) === 'Right wrist')
await click3d('ankle_l')
check('Left ankle selected', (await txt('[data-testid=selected-joint-name]')) === 'Left ankle')
check('ankle labelled "not counted"', await page.getByText(/not counted in the score/i).isVisible())
await btn('Yes, tender').click()
await btn('Yes, swollen').click()
await click3d('lumbar_spine')
check('hidden back joint cannot be tapped through the body', (await txt('[data-testid=selected-joint-name]')) === 'Left ankle')

step('4. Fill the rest as normal (never overwrites answers) + undo')
await page.getByRole('button', { name: /Everything else is normal/ }).click()
await btn('Yes, mark them normal').click()
await wait()
check('28 of 28 checked', (await txt('[data-testid=progress-count]')) === '28 of 28')
await page.getByRole('button', { name: '↶ Undo' }).click()
check('undo restores', (await txt('[data-testid=progress-count]')) !== '28 of 28')
await page.getByRole('button', { name: /Everything else is normal/ }).click()
await btn('Yes, mark them normal').click()
await wait()

step('5. Rating step — counts come from the joint check')
await page.getByTestId('to-rating').click()
check('counts: 1 tender · 1 swollen (ankle excluded)', (await page.getByText(/From the joint check/).innerText()).includes('1 tender · 1 swollen'))
check('ratings start "Not rated yet" (never 0)', (await txt('[data-testid=ptga-value]')) === 'Not rated yet')
await setRating(ptgaSlider, 5)
for (let i = 0; i < 7; i++) await page.getByRole('button', { name: "Doctor's rating: higher" }).click()
check('PtGA 5.0 via slider', (await txt('[data-testid=ptga-value]')) === '5.0')
check('PrGA 3.0 via + button', (await txt('[data-testid=prga-value]')) === '3.0')

step('6. Calculations through the UI (MDCalc boundaries)')
await page.getByTestId('to-result').click()
check('1 + 1 + 5 + 3 = 10 → Low (upper boundary)', (await score()) === '10' && (await category()).includes('Low'))
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
await setRating(prgaSlider, 3)
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
check('chart tap selects joint', (await txt('[data-testid=selected-joint-name]')).includes('MCP 2'))
await btn('Yes, tender').click()
await page.getByTestId('to-rating').click()
check('chart answer counted', (await page.getByText(/From the joint check/).innerText()).includes('1 tender'))
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
