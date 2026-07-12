// Record the product demo video against a running frontend
//
// The frontend address comes from an environment variable so no machine
// addresses ever live in the repository:
//     URL=<host:port> make take-demo-video
//
// Signs in ahead of time, then records a fresh navigation so the video opens
// on the app's loading animation, tours the dashboard widgets with a visible
// mouse, and encodes the recording into docs/demo.mp4

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { chromium } from 'playwright'
import { applyThemeAndClock, logIn, resolveBaseUrl, VIEWPORTS, waitForContent } from './shared.mjs'

const THEME = 'light'
const VIEWPORT = VIEWPORTS.desktop

// The video keeps the recording's native resolution and is encoded at a
// smooth playback rate with a near-lossless quality factor
const VIDEO_FPS = 60

// Quality factor, near transparent for flat interface content
const VIDEO_CRF = '18' 

// Pauses between tour steps, tuned so viewers can register each change
const HOLD_FX_TOOLTIP_MS = 1000
const HOLD_AFTER_CREDIT_FLIP_MS = 1000
const HOLD_SAVINGS_BAR_MS = 1000
const HOLD_RUNWAY_SEGMENT_MS = 1000
const HOLD_AFTER_RANGE_MS = 500
const HOLD_AFTER_BREAKDOWN_FLIP_MS = 1500

const rawUrl = process.env.URL
if (!rawUrl) {
  console.error('URL is required, e.g. URL=<host:port> make take-demo-video')
  process.exit(1)
}
const baseUrl = resolveBaseUrl(rawUrl)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const videoOutputPath = path.join(repoRoot, 'docs', 'demo.mp4')

// The recorded cursor is drawn by the page because headless video capture
// has no operating system pointer, following real mouse events so scripted
// movement reads as a person driving the app
const cursorOverlayScript = () => {
  const CURSOR_ID = '__demo_cursor'
  const ensureCursor = () => {
    if (!document.body || document.getElementById(CURSOR_ID)) return
    const cursor = document.createElement('div')
    cursor.id = CURSOR_ID
    cursor.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'width:24px', 'height:24px',
      'z-index:2147483647', 'pointer-events:none', 'transition:transform 90ms ease',
    ].join(';')
    cursor.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M4 2l16 11.5-7.6 1L16.8 22l-3.4 1.5-4.3-7.4L4 20.5z" '
      + 'fill="#fefefe" stroke="#1c1917" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.body.appendChild(cursor)
  }
  window.addEventListener('mousemove', (event) => {
    ensureCursor()
    const cursor = document.getElementById(CURSOR_ID)
    if (cursor) {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    }
  }, true)
  window.addEventListener('mousedown', () => {
    const cursor = document.getElementById(CURSOR_ID)
    if (cursor) cursor.style.transform = 'scale(0.75)'
  }, true)
  window.addEventListener('mouseup', () => {
    const cursor = document.getElementById(CURSOR_ID)
    if (cursor) cursor.style.transform = 'scale(1)'
  }, true)
  document.addEventListener('DOMContentLoaded', ensureCursor)
}

/** Track the mouse position so every glide starts where the last one ended */
let mouseAt = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }

/** Glide the mouse to a target in small steps so the movement looks human */
async function glideTo(page, x, y) {
  const distance = Math.hypot(x - mouseAt.x, y - mouseAt.y)
  const steps = Math.min(80, Math.max(18, Math.round(distance / 14)))
  await page.mouse.move(x, y, { steps })
  mouseAt = { x, y }
  await page.waitForTimeout(180)
}

/** Glide to the centre of a locator's bounding box */
async function glideToLocator(page, locator) {
  await locator.waitFor({ timeout: 10_000 })
  const box = await locator.boundingBox()
  if (!box) throw new Error('Tour target has no bounding box')
  await glideTo(page, box.x + box.width / 2, box.y + box.height / 2)
}

/** Encode the recorded capture into the shareable video file

The browser screencast only yields roughly twenty-five irregular frames per
second, so the in-between frames are synthesised with motion interpolation
rather than duplicated, which is what makes the cursor glide smoothly */
async function encodeVideo(capturePath) {
  const smoothing = `minterpolate=fps=${VIDEO_FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
  await promisify(execFile)(ffmpegPath, [
    '-y', '-i', capturePath,
    '-vf', smoothing,
    '-c:v', 'libx264', '-crf', VIDEO_CRF, '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    videoOutputPath,
  ], { maxBuffer: 64 * 1024 * 1024 })
}

const videoDir = await mkdtemp(path.join(os.tmpdir(), 'lumina-demo-'))
const browser = await chromium.launch()
try {
  // Sign in outside the recording so the video opens on the app loading
  // rather than the login form, carrying the session over as cookies
  const loginContext = await browser.newContext({ viewport: VIEWPORT })
  await applyThemeAndClock(loginContext, THEME)
  const loginPage = await loginContext.newPage()
  await loginPage.goto(`${baseUrl}/login`)
  await logIn(loginPage)
  const storageState = await loginContext.storageState()
  await loginContext.close()

  const context = await browser.newContext({
    viewport: VIEWPORT,
    storageState,
    recordVideo: { dir: videoDir, size: VIEWPORT },
  })
  await applyThemeAndClock(context, THEME)
  await context.addInitScript(cursorOverlayScript)

  const page = await context.newPage()

  // The recording is already rolling here, so the navigation itself puts the
  // loading animation on film before the dashboard settles
  await page.goto(baseUrl)
  await waitForContent(page, 'Net Worth')

  // Rest the cursor mid-screen before the tour starts
  await glideTo(page, VIEWPORT.width / 2, VIEWPORT.height / 2)

  // Hover the net worth FX badge and hold so its tooltip can be read
  await glideToLocator(page, page.getByLabel('Net worth FX status').first())
  await page.waitForTimeout(HOLD_FX_TOOLTIP_MS)

  // Flip the credit widget to its remaining side, then back again
  await glideToLocator(page, page.getByLabel('Show credit remaining').first())
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(HOLD_AFTER_CREDIT_FLIP_MS)
  await glideToLocator(page, page.getByLabel('Show credit used').first())
  await page.mouse.down()
  await page.mouse.up()

  // Rest on the savings rate bar for the current month so its tooltip shows
  const savingsCard = page.locator('.app-card').filter({ hasText: 'Savings Rate' })
  const savingsBarBoxes = await Promise.all(
    (await savingsCard.locator('.recharts-bar-rectangle').all()).map((bar) => bar.boundingBox()),
  )
  const currentMonthBar = savingsBarBoxes
    .filter(Boolean)
    .sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
    .at(-1)
  if (!currentMonthBar) throw new Error('Savings rate bars not found')
  await glideTo(
    page,
    currentMonthBar.x + currentMonthBar.width / 2,
    currentMonthBar.y + currentMonthBar.height / 2,
  )
  await page.waitForTimeout(HOLD_SAVINGS_BAR_MS)

  // Hover the first section of the runway bar so its segment tooltip shows
  const runwayFirstSegment = page
    .locator('.app-card')
    .filter({ hasText: 'Runway' })
    .locator('.rounded-xl.overflow-hidden > div')
    .first()
  await glideToLocator(page, runwayFirstSegment)
  await page.waitForTimeout(HOLD_RUNWAY_SEGMENT_MS)

  // Switch the spending comparison to the quarter to date range
  await glideToLocator(
    page,
    page.getByRole('tablist', { name: 'Spending range' }).getByRole('tab', { name: 'QTD' }),
  )
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(HOLD_AFTER_RANGE_MS)

  // Flip the spending breakdown to its income side and let it settle
  await glideToLocator(page, page.getByLabel('Show income breakdown').first())
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(HOLD_AFTER_BREAKDOWN_FLIP_MS)

  const video = page.video()
  await context.close()

  await mkdir(path.dirname(videoOutputPath), { recursive: true })
  await encodeVideo(await video.path())
  console.log(`Demo video written to ${videoOutputPath}`)
} finally {
  await browser.close()
  await rm(videoDir, { recursive: true, force: true })
}
