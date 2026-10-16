// Close-up of the head for visual review: node e2e/head.mjs <base> <out.png>
import { chromium } from 'playwright-core'
const [BASE = 'http://localhost:5199/', OUT = 'head.png'] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE + '?e2e', { waitUntil: 'networkidle' })
await page.waitForSelector('canvas')
await page.waitForTimeout(2500)
const c = await page.locator('canvas').boundingBox()
const head = await page.evaluate(() => window.__rheum.project('tmj_r'))
await page.mouse.move(c.x + c.width / 2, head.y)
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60) }
await page.waitForTimeout(1500)
await page.locator('.stage-canvas').screenshot({ path: OUT })
await browser.close()
