// Screenshots the simple flow at desktop / tablet / phone sizes: node e2e/layouts.mjs <base> <outDir>
import { chromium } from 'playwright-core'
const [BASE = 'http://localhost:5199/', OUT = 'e2e/out'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const [w, h, name] of [[1440, 900, 'desktop'], [820, 1180, 'tablet'], [390, 844, 'phone']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/${name}-1-start.png` })
  for (const n of ['Right wrist tender', 'Right wrist swollen', 'Left knee tender']) await page.getByRole('button', { name: n, exact: true }).click()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/${name}-2-joint.png` })
  await page.getByRole('button', { name: 'Load example' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /3\s*Result/ }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}-3-result.png` })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)
  console.log(name, 'horizontal overflow:', overflow)
  await page.close()
}
await browser.close()
