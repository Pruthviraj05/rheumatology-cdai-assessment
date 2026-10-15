// Smoothness probe: render stats + frame pacing during an orbit drag, and pick-occlusion check.
import { chromium } from 'playwright-core'
const BASE = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE + '?e2e', { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(2500)

console.log('render stats (idle):', await page.evaluate(() => window.__rheum.stats()))

// Pick occlusion: from the front, the lumbar spine marker sits behind the body.
const spine = await page.evaluate(() => window.__rheum.project('lumbar_spine'))
await page.mouse.move(spine.x, spine.y); await page.mouse.down(); await page.mouse.up()
await page.waitForTimeout(300)
const sel = await page.locator('[data-testid=selected-joint-name]').count()
console.log('front-view click on hidden spine marker selects nothing:', sel === 0)

// Frame pacing while orbiting.
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = (t) => { window.__frames.push(t - last); last = t; window.__raf = requestAnimationFrame(tick) }
  window.__raf = requestAnimationFrame(tick)
})
const box = await page.locator('canvas').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.move(cx - 150, cy)
await page.mouse.down()
for (let i = 0; i <= 60; i++) { await page.mouse.move(cx - 150 + i * 5, cy + Math.sin(i / 8) * 30); await page.waitForTimeout(12) }
await page.mouse.up()
await page.waitForTimeout(600)
const frames = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__frames.slice(1) })
frames.sort((a, b) => a - b)
const pct = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))].toFixed(1)
console.log(`orbit frames=${frames.length} p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${frames.at(-1).toFixed(1)}ms (software GL — real GPUs are far faster)`)
console.log('render stats (after orbit):', await page.evaluate(() => window.__rheum.stats()))
await browser.close()
