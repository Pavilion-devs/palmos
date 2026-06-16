import puppeteer from 'puppeteer-core'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox','--force-color-profile=srgb','--hide-scrollbars'] })
const p = await b.newPage()
await p.setViewport({ width: 2200, height: 1300, deviceScaleFactor: 2 })
await p.goto(pathToFileURL(resolve('palmos-architecture.html')).href, { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 700))
const [x, y, w, h] = process.argv.slice(2, 6).map(Number)
await p.screenshot({ path: process.argv[6], clip: { x, y, width: w, height: h } })
await b.close()
console.log('ok', process.argv[6])
