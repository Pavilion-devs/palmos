// Headless screenshot of a local HTML file for visual review.
//   node scripts/shot-arch.mjs <html-path> <out-png> [width]
import puppeteer from 'puppeteer-core'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const html = resolve(process.argv[2] ?? 'palmos-architecture.html')
const out = resolve(process.argv[3] ?? '/tmp/palmos-arch.png')
const width = Number(process.argv[4] ?? 2012)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width, height: 1300, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 600)) // let webfonts settle
await page.screenshot({ path: out, fullPage: true })
await browser.close()
console.log('wrote', out)
