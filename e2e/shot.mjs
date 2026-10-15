// Usage: node e2e/shot.mjs <url> <out.png> [width] [height]
import { chromium } from 'playwright-core'
const [url, out, w = '1440', h = '900'] = process.argv.slice(2)
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: +w, height: +h } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
await page.screenshot({ path: out })
console.log(logs.slice(0, 15).join('\n') || 'no console output')
await browser.close()
