// Compose the project's hero image from fresh dashboard captures
//
// The frontend address and theme come from environment variables so no
// machine addresses ever live in the repository:
//     URL=<host:port> THEME=<light|dark> make take-hero-image
//
// Signs in at desktop, tablet, and mobile sizes, captures the dashboard at
// double density, lays the three shots out as framed devices on one canvas,
// and writes the montage to docs/screenshots/hero_<theme>.png

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  applyThemeAndClock,
  CLOCK_HOUR_BY_THEME,
  logIn,
  resolveBaseUrl,
  VIEWPORTS,
  waitForContent,
} from './shared.mjs'

// The montage canvas, sized generously so the hero stays crisp on retina
// displays at README width
const CANVAS = { width: 3200, height: 1800 }

// The page renders at double density so text stays crisp after the shots
// are scaled down into the montage
const CAPTURE_SCALE = 2

const rawUrl = process.env.URL
if (!rawUrl) {
  console.error('URL is required, e.g. URL=<host:port> THEME=light make take-hero-image')
  process.exit(1)
}
const theme = process.env.THEME
if (!theme || !(theme in CLOCK_HOUR_BY_THEME)) {
  console.error(`THEME must be one of ${Object.keys(CLOCK_HOUR_BY_THEME).join(', ')}`)
  process.exit(1)
}
const baseUrl = resolveBaseUrl(rawUrl)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputPath = path.join(repoRoot, 'docs', 'screenshots', `hero_${theme}.png`)

/** Capture the dashboard at one viewport and write it to the working dir */
async function captureDashboard(browser, workDir, name) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[name],
    deviceScaleFactor: CAPTURE_SCALE,
    reducedMotion: 'reduce',
  })
  await applyThemeAndClock(context, theme)
  const page = await context.newPage()
  await page.goto(`${baseUrl}/login`)
  await logIn(page)
  await waitForContent(page, 'Net Worth')
  const shotPath = path.join(workDir, `${name}.png`)
  await page.screenshot({ path: shotPath })
  await context.close()
  console.log(`  captured ${name}`)
  return shotPath
}

/** Build the montage page that frames the three shots as devices */
function buildMontageHtml(shots) {
  const bezel = '#1c1917'
  const shadow = '0 48px 96px -24px rgba(28, 25, 23, 0.5), 0 16px 32px -16px rgba(28, 25, 23, 0.35)'
  return `<!doctype html>
<html>
<head>
<style>
  * { margin: 0; box-sizing: border-box; }
  body { background: transparent; }
  .canvas {
    position: relative;
    width: ${CANVAS.width}px;
    height: ${CANVAS.height}px;
  }
  .device {
    position: absolute;
    background: ${bezel};
    box-shadow: ${shadow};
  }

  /* Screen corners stay concentric with the frame, inner radius equals the
     outer radius minus the bezel width */
  .device img { display: block; width: 100%; height: auto; }
  .desktop { left: 120px; top: 140px; width: 2210px; padding: 14px; border-radius: 28px; }
  .desktop img { border-radius: 14px; }
  .tablet { right: 480px; bottom: 110px; width: 940px; padding: 16px; border-radius: 36px; }
  .tablet img { border-radius: 20px; }
  .phone { right: 190px; bottom: 70px; width: 330px; padding: 12px; border-radius: 52px; }
  .phone img { border-radius: 40px; }
</style>
</head>
<body>
  <div class="canvas">
    <div class="device desktop"><img src="file://${shots.desktop}"></div>
    <div class="device tablet"><img src="file://${shots.tablet}"></div>
    <div class="device phone"><img src="file://${shots.mobile}"></div>
  </div>
</body>
</html>`
}

const workDir = await mkdtemp(path.join(os.tmpdir(), 'lumina-hero-'))
const browser = await chromium.launch()
try {
  console.log(`${theme} theme hero`)
  const shots = {}
  for (const name of ['desktop', 'tablet', 'mobile']) {
    shots[name] = await captureDashboard(browser, workDir, name)
  }

  const montagePath = path.join(workDir, 'montage.html')
  await writeFile(montagePath, buildMontageHtml(shots))
  const page = await browser.newPage({ viewport: { width: CANVAS.width, height: CANVAS.height } })
  await page.goto(`file://${montagePath}`)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await page.locator('.canvas').screenshot({ path: outputPath, omitBackground: true })
  console.log(`Hero image written to ${outputPath}`)
} finally {
  await browser.close()
  await rm(workDir, { recursive: true, force: true })
}
