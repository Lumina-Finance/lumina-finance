// Record the product demo video against a running frontend
//
// The frontend address comes from an environment variable so no machine
// addresses ever live in the repository:
//     URL=<host:port> make take-demo-video
//
// Records from the login form onward, so the video opens on the sign-in and
// the app's loading animation, tours the dashboard, accounts, transactions,
// budgets, and insights pages with a visible mouse, and encodes the recording
// into docs/demo.mp4
//
//     URL=<host:port> make take-demo-video           rough draft, fast
//     URL=<host:port> PROD=1 make take-demo-video    polished cut, slow
//
// Frames come straight from the browser's screencast rather than Playwright's
// video recorder, whose hardcoded one-megabit encode is what used to cap the
// visual quality. The whole page runs several times slower than real time
// while recording and the encode speeds it back up, so the browser never has
// to render fast animation in real time and the result stays smooth

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { chromium } from 'playwright'
import {
  applyThemeAndClock,
  CONTENT_TIMEOUT_MS,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  resolveBaseUrl,
  VIEWPORTS,
  waitForContent,
} from './shared.mjs'

const THEME = 'light'

// PROD=1 records the polished cut with the slowed capture and the smooth
// sixty frame output, anything else records a fast rough draft for checking
// the tour end to end
const IS_PROD = process.env.PROD === '1'

// The shared desktop viewport, sized so the dashboard's bottom cards line up
// with the nav pane's bottom edge
const VIEWPORT = VIEWPORTS.desktop

// The page renders at double density and the screencast scales it back to
// the output size, so text stays supersampled and crisp
const CAPTURE_SCALE = 2
const CAPTURE_JPEG_QUALITY = 95

// Everything on the page runs this many times slower while recording and the
// encode plays the frames back proportionally faster, giving the browser
// several wall-clock frames to render each output frame so fast animations
// stop dropping frames. Raising it smooths more at the cost of a
// proportionally longer recording session, and the draft skips it entirely
const CAPTURE_SLOWDOWN = IS_PROD ? 4 : 1

// The polished cut plays at a smooth rate with a near-lossless quality
// factor, kept high because the app's flat beige surfaces band and pulse
// between keyframes at ordinary rates. The draft trades both for speed
const VIDEO_FPS = IS_PROD ? 60 : 30
const VIDEO_CRF = IS_PROD ? '15' : '28'

// The finished video plays this many times slower than the interactions ran,
// which reads as calmer pacing for a demo without affecting smoothness
const PLAYBACK_SLOWDOWN = 1.15

// Pauses between tour steps, tuned so viewers can register each change
const HOLD_FX_TOOLTIP_MS = 1000
const HOLD_AFTER_CREDIT_FLIP_MS = 1000
const HOLD_SAVINGS_BAR_MS = 1000
const HOLD_RUNWAY_SEGMENT_MS = 1000
const HOLD_AFTER_RANGE_MS = 500
const HOLD_AFTER_BREAKDOWN_FLIP_MS = 1500
const FILTER_PANEL_OPEN_MS = 600
const HOLD_AFTER_FILTER_MS = 500
const HOLD_ACCOUNT_DETAILS_MS = 1500
const HOLD_BUDGET_BAR_MS = 1000
const HOLD_MERCHANT_TILE_MS = 1000
const HOLD_TAC_LIMIT_MS = 1000
const MODAL_CLOSE_SETTLE_MS = 500
const HOLD_END_MS = 1500

// Beat after every click so interactions read as deliberate rather than
// machine paced
const HOLD_AFTER_CLICK_MS = 350

// Beat on each side of the theme switch so both looks register
const HOLD_AFTER_THEME_MS = 1500

// Grace period between applying a transaction filter and watching for its
// blocking refresh overlay, which needs a moment to mount
const FILTER_REFRESH_GRACE_MS = 300

// Keystroke pacing when the tour types into a field
const TYPE_DELAY_MS = 90

// Beat on the login form before typing starts, so its entrance animation has
// finished and the viewer registers where the tour begins
const HOLD_LOGIN_FORM_MS = 800

// Each insights card gets time for its charts to draw once its data arrives,
// then a beat for the viewer before the scroll moves on
const INSIGHT_REVEAL_MS = 1500
const INSIGHT_HOLD_MS = 1000

// The fund flow card sits above the fold, so it has already revealed by the
// time the walk reaches it and its own stop only needs a brief pause
const INSIGHT_FUND_FLOW_PAUSE_MS = 500

// The savings rate stop is the walk's last scroll because the merchant row
// below it is already fully in view there, so it holds a little longer and
// the walk then moves straight to the closing merchant hover
const INSIGHT_LAST_STOP_PAUSE_MS = INSIGHT_REVEAL_MS + 1500

// Range preset code the walk applies before touring the cards, so every card
// shows a complete month of data
const INSIGHTS_RANGE_TAB = 'LM'

// Wheel scrolling pace, ticks small enough that the slowed capture films the
// scroll as near-continuous motion rather than discrete jumps
const SCROLL_TICK_PX = 30
const SCROLL_TICK_MS = 15

// Consecutive position reads showing no movement before concluding the page
// cannot scroll further, generous because scrolling applies asynchronously
// and lags behind the wheel at draft pacing
const SCROLL_STALL_TICKS = 8
const SCROLL_TOP_OFFSET_PX = 96

// Cursor glide pace, wall-clock based so movement stays visible on film even
// when the page is busy rendering
const GLIDE_MS_PER_PX = 0.45
const GLIDE_MIN_MS = 350
const GLIDE_MAX_MS = 900
const GLIDE_STEP_MS = 16

// Account whose detail page and transactions the tour features, filtered by
// its institution on the accounts page, the category stacked on top of the
// account filter, the budget whose details open, and the merchant whose
// distribution tile is hovered at the end of the insights walk
const ACCOUNT_DETAILS_NAME = 'Platinum Rewards Card'
const FILTER_INSTITUTION_NAME = 'Toronto Dominion Bank'
const FILTER_CATEGORY_NAME = 'Groceries'
const BUDGET_DETAILS_NAME = 'Utilities'

// A merchant whose spend varies month to month, so the hovered tile's
// tooltip shows a movement against the previous period rather than a flat
// zero change
const MERCHANT_TILE_NAME = 'Golden Pantry'

// Insights cards in page order, each with the spinner labels that must clear
// before the card counts as revealed
const INSIGHT_TOUR_STOPS = [
  { heading: 'This Period at a Glance', loadingLabels: ['Loading period at a glance'] },
  { heading: 'Fund Flow', loadingLabels: ['Loading fund flow'], pauseMs: INSIGHT_FUND_FLOW_PAUSE_MS },
  { heading: 'Breakdown', loadingLabels: ['Loading income and expense breakdown'] },
  { heading: 'Net Worth', loadingLabels: ['Loading net worth'] },
  { heading: 'Cash Flow', loadingLabels: ['Loading cash flow'] },
  {
    heading: 'Savings Rate Trend',
    loadingLabels: [
      'Loading savings rate trend',
      'Loading merchant spending distribution',
      'Loading merchant ranking',
    ],
    pauseMs: INSIGHT_LAST_STOP_PAUSE_MS,
  },
]

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

// Slows every clock the page can read, so scripted animations advance at the
// capture slowdown while wall time keeps passing normally. CSS transitions
// run on the compositor beyond these patches and are slowed separately
// through the browser's animation domain
const timeDilationScript = (slowdown) => {
  const BaseDate = window.Date
  const realPerformanceNow = performance.now.bind(performance)
  const performanceAnchor = realPerformanceNow()
  const dateAnchor = BaseDate.now()
  const dilatedPerformanceNow = () =>
    performanceAnchor + (realPerformanceNow() - performanceAnchor) / slowdown
  performance.now = dilatedPerformanceNow

  class DilatedDate extends BaseDate {
    constructor(...args) {
      if (args.length === 0) {
        super(dateAnchor + (realPerformanceNow() - performanceAnchor) / slowdown)
      } else {
        super(...args)
      }
    }

    static now() {
      return dateAnchor + (realPerformanceNow() - performanceAnchor) / slowdown
    }
  }
  window.Date = DilatedDate

  const realRequestAnimationFrame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    realRequestAnimationFrame(() => callback(dilatedPerformanceNow()))
  const realSetTimeout = window.setTimeout.bind(window)
  window.setTimeout = (callback, delay, ...rest) =>
    realSetTimeout(callback, (delay ?? 0) * slowdown, ...rest)
  const realSetInterval = window.setInterval.bind(window)
  window.setInterval = (callback, delay, ...rest) =>
    realSetInterval(callback, (delay ?? 0) * slowdown, ...rest)
}

/** Wait for an on-screen duration, stretched to wall time by the slowdown */
const pause = (page, ms) => page.waitForTimeout(ms * CAPTURE_SLOWDOWN)

/** Track the mouse position so every glide starts where the last one ended */
let mouseAt = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }

/** Glide the mouse to a target over real wall-clock time so it looks human

Playwright's stepped move dispatches every intermediate event as fast as the
browser accepts them, so a busy page paints the whole glide in a frame or two
and the cursor appears to snap. Pacing each step with a timeout keeps the
movement spread across captured frames no matter how busy the page is */
async function glideTo(page, x, y) {
  const from = { ...mouseAt }
  const distance = Math.hypot(x - from.x, y - from.y)
  const duration = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, distance * GLIDE_MS_PER_PX))

  // Steps land every GLIDE_STEP_MS of wall time rather than screen time,
  // because the cursor is driven from outside the page where the slowed
  // clocks cannot pace it. Progress comes from the elapsed clock rather than
  // the step index, so protocol latency jitter between steps cannot vary the
  // cursor's velocity
  const wallDuration = duration * CAPTURE_SLOWDOWN
  const startedAt = Date.now()
  for (;;) {
    const progress = Math.min(1, (Date.now() - startedAt) / wallDuration)

    // Ease in and out so the pointer accelerates away and settles onto target
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - (2 - 2 * progress) ** 2 / 2
    await page.mouse.move(from.x + (x - from.x) * eased, from.y + (y - from.y) * eased)
    if (progress >= 1) break
    await page.waitForTimeout(GLIDE_STEP_MS)
  }
  mouseAt = { x, y }
  await pause(page, 180)
}

/** Glide to the centre of a locator's bounding box */
async function glideToLocator(page, locator) {
  await locator.waitFor({ timeout: 10_000 })
  const box = await locator.boundingBox()
  if (!box) throw new Error('Tour target has no bounding box')
  await glideTo(page, box.x + box.width / 2, box.y + box.height / 2)
}

/** Press and release the mouse, then rest a beat like a person would */
async function click(page) {
  const { mouse } = page
  await mouse.down()
  await mouse.up()
  await pause(page, HOLD_AFTER_CLICK_MS)
}

/** Wheel the page in small ticks until the target sits near the viewport top

The loop re-reads the target's position every tick and stops once the page
has not moved for several consecutive reads, which happens for the last cards
on a page. A single unchanged read is not enough because the browser applies
wheel scrolling asynchronously and can lag a tick or two behind */
async function scrollIntoViewNaturally(page, locator) {
  let previousTop = Infinity
  let stalledTicks = 0
  for (let tick = 0; tick < 800; tick += 1) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Scroll target has no bounding box')
    const remaining = box.y - SCROLL_TOP_OFFSET_PX
    if (remaining <= 4) break
    stalledTicks = Math.abs(box.y - previousTop) < 1 ? stalledTicks + 1 : 0
    if (stalledTicks >= SCROLL_STALL_TICKS) break
    previousTop = box.y

    // Ticks land every SCROLL_TICK_MS of wall time with proportionally
    // smaller steps, for the same reason cursor glides do: the wheel is
    // driven from outside the page's slowed clocks
    await page.mouse.wheel(0, Math.min(remaining, SCROLL_TICK_PX / CAPTURE_SLOWDOWN))
    await page.waitForTimeout(SCROLL_TICK_MS)
  }
}

const execFileAsync = promisify(execFile)
const FFMPEG_BUFFER = { maxBuffer: 64 * 1024 * 1024 }

/** Encode the captured screencast frames into the shareable video file

The slowed capture samples the tour several times over the playback rate, so
each output frame snaps to the nearest frame the browser really rendered and
nothing is synthesised. Interpolation filters were tried here and made the
motion worse, because they assume constant-rate input while the screencast's
timing is irregular */
async function encodeVideo(framesDir, frames, captureEndedAt) {
  if (frames.length < 2) throw new Error('The screencast produced too few frames')

  // The gap distribution shows how densely the screencast really sampled,
  // which is what the played-back smoothness depends on
  const gaps = frames.slice(1)
    .map((frame, index) => (frame.timestamp - frames[index].timestamp) * 1000)
    .sort((a, b) => a - b)
  const gapAt = (share) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * share))].toFixed(1)
  console.log(
    `Captured ${frames.length} frames, wall gaps ms: median ${gapAt(0.5)}, p10 ${gapAt(0.1)}, p90 ${gapAt(0.9)}`,
  )

  // Screencast JPEGs are full-range BT.601 while players assume limited-range
  // BT.709 for high-definition video, which skews every colour slightly, so
  // the frames are converted and the output tagged as BT.709. The restamp
  // gives each list entry the constant output cadence, because the concat
  // demuxer quantizes duration directives to a coarse timebase that would
  // collapse the dense capture onto twenty-five frames per second
  const filters = [
    'settb=AVTB',
    `setpts=N/(${VIDEO_FPS}*TB)`,
    'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709',
  ].join(',')

  // One list entry per output frame, each the latest capture at that frame's
  // moment. Timestamps are wall clock while the page ran slowed, so output
  // time maps to wall time through the slowdown, eased by the playback factor
  const wallSecondsPerVideoSecond = CAPTURE_SLOWDOWN / PLAYBACK_SLOWDOWN
  const firstTimestamp = frames[0].timestamp
  const videoSeconds = Math.max(1 / VIDEO_FPS, (captureEndedAt - firstTimestamp) / wallSecondsPerVideoSecond)
  const outputFrameCount = Math.ceil(videoSeconds * VIDEO_FPS)
  const listEntries = []
  let captureIndex = 0
  for (let slot = 0; slot < outputFrameCount; slot += 1) {
    const slotWallTime = firstTimestamp + (slot / VIDEO_FPS) * wallSecondsPerVideoSecond
    while (captureIndex + 1 < frames.length && frames[captureIndex + 1].timestamp <= slotWallTime) {
      captureIndex += 1
    }
    listEntries.push(`file '${frames[captureIndex].path}'`)
  }
  const listPath = path.join(framesDir, 'frames.txt')
  await writeFile(listPath, listEntries.join('\n'))

  // The output rate must be declared explicitly, because the restamped pts
  // alone leave ffmpeg on the concat demuxer's twenty-five default and it
  // resamples the whole video down to that
  await execFileAsync(ffmpegPath, [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', filters,
    '-r', String(VIDEO_FPS),
    '-c:v', 'libx264', '-crf', VIDEO_CRF, '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart',
    videoOutputPath,
  ], FFMPEG_BUFFER)
}

const framesDir = await mkdtemp(path.join(os.tmpdir(), 'lumina-demo-frames-'))
const browser = await chromium.launch()
try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: CAPTURE_SCALE,
  })
  await applyThemeAndClock(context, THEME)
  await context.addInitScript(cursorOverlayScript)
  await context.addInitScript(timeDilationScript, CAPTURE_SLOWDOWN)

  const page = await context.newPage()

  // Frames arrive as they paint and each must be acknowledged promptly or
  // the browser stops sending more
  const frames = []
  const frameWrites = []
  const screencast = await context.newCDPSession(page)
  screencast.on('Page.screencastFrame', (event) => {
    const framePath = path.join(framesDir, `frame-${String(frames.length).padStart(6, '0')}.jpg`)
    frames.push({ path: framePath, timestamp: event.metadata.timestamp ?? Date.now() / 1000 })
    frameWrites.push(writeFile(framePath, Buffer.from(event.data, 'base64')))
    screencast.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  })
  await screencast.send('Page.startScreencast', {
    format: 'jpeg',
    quality: CAPTURE_JPEG_QUALITY,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  })

  // CSS transitions and animations play on the compositor where the page's
  // patched clocks cannot reach, so they are slowed through the browser
  await screencast.send('Animation.enable')
  await screencast.send('Animation.setPlaybackRate', { playbackRate: 1 / CAPTURE_SLOWDOWN })

  // The recording is already rolling here, so the sign-in itself is on film,
  // followed by the app's loading animation once the login submits
  await page.goto(`${baseUrl}/login`)
  const emailField = page.getByLabel('Email').or(page.getByPlaceholder('Email')).first()
  await emailField.waitFor({ timeout: CONTENT_TIMEOUT_MS })
  await pause(page, HOLD_LOGIN_FORM_MS)
  await glideToLocator(page, emailField)
  await click(page)
  await page.keyboard.type(DEMO_EMAIL, { delay: TYPE_DELAY_MS * CAPTURE_SLOWDOWN })
  await glideToLocator(page, page.getByLabel('Password').or(page.getByPlaceholder('Password')).first())
  await click(page)
  await page.keyboard.type(DEMO_PASSWORD, { delay: TYPE_DELAY_MS * CAPTURE_SLOWDOWN })
  await glideToLocator(page, page.getByRole('button', { name: 'Log in' }).first())
  await click(page)
  await waitForContent(page, 'Net Worth')

  // Rest the cursor mid-screen before the tour starts
  await glideTo(page, VIEWPORT.width / 2, VIEWPORT.height / 2)

  // Show the dashboard in dark mode, then return to light before touring
  // the widgets
  await glideToLocator(page, page.getByLabel('Dark theme').filter({ visible: true }).first())
  await click(page)
  await pause(page, HOLD_AFTER_THEME_MS)
  await glideToLocator(page, page.getByLabel('Light theme').filter({ visible: true }).first())
  await click(page)
  await pause(page, HOLD_AFTER_THEME_MS)

  // Hover the net worth FX badge and hold so its tooltip can be read
  await glideToLocator(page, page.getByLabel('Net worth FX status').first())
  await pause(page, HOLD_FX_TOOLTIP_MS)

  // Flip the credit widget to its remaining side, then back again
  await glideToLocator(page, page.getByLabel('Show credit remaining').first())
  await click(page)
  await pause(page, HOLD_AFTER_CREDIT_FLIP_MS)
  await glideToLocator(page, page.getByLabel('Show credit used').first())
  await click(page)

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
  await pause(page, HOLD_SAVINGS_BAR_MS)

  // Hover the first section of the runway bar so its segment tooltip shows
  const runwayFirstSegment = page
    .locator('.app-card')
    .filter({ hasText: 'Runway' })
    .locator('.rounded-xl.overflow-hidden > div')
    .first()
  await glideToLocator(page, runwayFirstSegment)
  await pause(page, HOLD_RUNWAY_SEGMENT_MS)

  // Switch the spending comparison to the quarter to date range
  await glideToLocator(
    page,
    page.getByRole('tablist', { name: 'Spending range' }).getByRole('tab', { name: 'QTD' }),
  )
  await click(page)
  await pause(page, HOLD_AFTER_RANGE_MS)

  // Flip the spending breakdown to its income side and let it settle
  await glideToLocator(page, page.getByLabel('Show income breakdown').first())
  await click(page)
  await pause(page, HOLD_AFTER_BREAKDOWN_FLIP_MS)

  // Move to the accounts page through the navigation like a person would,
  // then let the page settle and animate in
  await glideToLocator(page, page.getByRole('link', { name: 'Accounts' }).first())
  await click(page)
  await waitForContent(page, 'Everyday Chequing')

  // Rest on the TFSA annual contribution meter so its usage tooltip shows
  const tfsaLimitBlock = page
    .locator('[data-tooltip-bounds]')
    .filter({ hasText: 'TFSA' })
    .filter({ has: page.getByLabel('Annual usage') })
    .first()
  await glideToLocator(page, tfsaLimitBlock.getByLabel('Annual usage').first())
  await pause(page, HOLD_TAC_LIMIT_MS)

  // Open the filters and pick one institution. The institution facet is the
  // panel's default tab, so its options are already listed when it opens
  await glideToLocator(page, page.getByLabel('Account filters').filter({ visible: true }).first())
  await click(page)
  await pause(page, FILTER_PANEL_OPEN_MS)
  await glideToLocator(page, page.getByText(FILTER_INSTITUTION_NAME).filter({ visible: true }).first())
  await click(page)
  await glideToLocator(page, page.getByRole('button', { name: 'Apply filters' }).first())
  await click(page)

  // Accounts from other institutions leaving the list is what signals the
  // filter has applied
  await page.getByText('TFSA Investments').filter({ visible: true }).first()
    .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
  await pause(page, HOLD_AFTER_FILTER_MS)

  // Enter the account details page for the featured card and let it settle
  await glideToLocator(
    page,
    page.locator('a[href^="/accounts/"]', { hasText: ACCOUNT_DETAILS_NAME }).first(),
  )
  await click(page)
  await waitForContent(page, ACCOUNT_DETAILS_NAME)
  await pause(page, HOLD_ACCOUNT_DETAILS_MS)

  // Move to the transactions page and filter the list down to the featured
  // card. The account facet is the filter panel's default tab
  await glideToLocator(page, page.getByRole('link', { name: 'Transactions' }).first())
  await click(page)
  await waitForContent(page, 'Clay & Kiln Studio')
  await glideToLocator(page, page.getByLabel('Transaction filters').filter({ visible: true }).first())
  await click(page)
  await pause(page, FILTER_PANEL_OPEN_MS)

  // The featured card sits below the checklist's scroll fold, so the tour
  // narrows the options through the facet's search field instead of clicking
  // an option the panel has clipped away
  await glideToLocator(page, page.getByPlaceholder('Search accounts').first())
  await click(page)
  await page.keyboard.type('Platinum', { delay: TYPE_DELAY_MS * CAPTURE_SLOWDOWN })
  await glideToLocator(page, page.getByRole('checkbox', { name: ACCOUNT_DETAILS_NAME }).first())
  await click(page)

  // Stack a category filter on top of the account filter through the same
  // panel, so the applied result combines both
  await glideToLocator(page, page.getByRole('tab', { name: 'Category' }).first())
  await click(page)
  await pause(page, FILTER_PANEL_OPEN_MS)
  await glideToLocator(page, page.getByPlaceholder('Search category').first())
  await click(page)
  await page.keyboard.type('Groc', { delay: TYPE_DELAY_MS * CAPTURE_SLOWDOWN })
  await glideToLocator(page, page.getByRole('checkbox', { name: FILTER_CATEGORY_NAME }).first())
  await click(page)
  await glideToLocator(page, page.getByRole('button', { name: 'Apply filters' }).first())
  await click(page)

  // Rows outside the filtered account and category leaving the list is what
  // signals both filters have applied, alongside the refresh overlay clearing
  await pause(page, FILTER_REFRESH_GRACE_MS)
  await page.getByText('Loading transactions').first()
    .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
  await page.getByText('TFSA Investments').first()
    .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
  await page.getByText('Clay & Kiln Studio').first()
    .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
  await pause(page, HOLD_AFTER_FILTER_MS)

  // Open the featured budget's details and hover its second-last utilization
  // column so the on-hover period breakdown shows. The column is found by its
  // unique horizontal centre, and the hover lands mid-chart because the
  // tooltip activates anywhere in the plot area at that x position
  await glideToLocator(page, page.getByRole('link', { name: 'Budgets' }).first())
  await click(page)
  await waitForContent(page, 'Monthly Groceries')
  await glideToLocator(page, page.getByText(BUDGET_DETAILS_NAME).filter({ visible: true }).first())
  await click(page)
  await waitForContent(page, 'Electricity')

  // The utilization chart mounts its bars a beat after the modal's text,
  // slower still under the capture slowdown, so the measurement waits for
  // them rather than racing the entrance animation
  await page.locator('.recharts-bar-rectangle').first().waitFor({ timeout: CONTENT_TIMEOUT_MS })
  const budgetChartBox = await page.locator('.recharts-wrapper').first().boundingBox()
  const budgetBarBoxes = await Promise.all(
    (await page.locator('.recharts-bar-rectangle').all()).map((bar) => bar.boundingBox()),
  )
  const budgetColumnCentres = [...new Set(
    budgetBarBoxes.filter(Boolean).map((box) => Math.round(box.x + box.width / 2)),
  )].sort((a, b) => a - b)
  const budgetHoverX = budgetColumnCentres.at(-2) ?? budgetColumnCentres.at(-1)
  if (!budgetChartBox || budgetHoverX === undefined) {
    throw new Error('Budget utilization bars not found')
  }
  await glideTo(page, budgetHoverX, budgetChartBox.y + budgetChartBox.height / 2)
  await pause(page, HOLD_BUDGET_BAR_MS)
  await glideToLocator(page, page.getByLabel('Close budget details').filter({ visible: true }).first())
  await click(page)
  await pause(page, MODAL_CLOSE_SETTLE_MS)

  // Walk the insights cards top to bottom, scrolling each one into view and
  // letting its data arrive and charts draw before moving on. Cards load
  // lazily as they enter the viewport, so each spinner appears only after
  // its card has scrolled in
  await glideToLocator(page, page.getByRole('link', { name: 'Insights' }).first())
  await click(page)
  await waitForContent(page, 'This Period at a Glance')

  // Switch the range to last month before the walk. Fixed presets apply
  // immediately and collapse the range panel on their own
  await glideToLocator(page, page.getByLabel(/^Insights date range:/).first())
  await click(page)
  await pause(page, FILTER_PANEL_OPEN_MS)
  await glideToLocator(page, page.getByRole('tab', { name: INSIGHTS_RANGE_TAB }).first())
  await click(page)

  // Park the cursor over the card column so wheel events reach the page
  await glideTo(page, VIEWPORT.width / 2, VIEWPORT.height / 2)

  // The floating range control's saved-range rows reuse the card style, so
  // the walk is scoped to the insights card column to keep ordinals aligned
  const insightCards = page.locator('.space-y-4.pb-28 .app-card')
  for (const [cardIndex, stop] of INSIGHT_TOUR_STOPS.entries()) {
    const card = insightCards.nth(cardIndex)

    // The heading check confirms the ordinal still matches the page order
    await card.getByText(stop.heading).first().waitFor({ timeout: CONTENT_TIMEOUT_MS })

    // The first card is already on screen when the range applies, so its
    // pause starts immediately without nudging the page down
    if (cardIndex > 0) await scrollIntoViewNaturally(page, card)
    await pause(page, FILTER_REFRESH_GRACE_MS)
    for (const loadingLabel of stop.loadingLabels) {
      await page.getByLabel(loadingLabel).first()
        .waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
    }
    await pause(page, stop.pauseMs ?? INSIGHT_REVEAL_MS + INSIGHT_HOLD_MS)
  }

  // Rest on the featured merchant's distribution tile so its details show
  const distributionCard = insightCards
    .filter({ hasText: 'Spending Distribution by Merchant' })
    .first()
  await glideToLocator(page, distributionCard.getByText(MERCHANT_TILE_NAME).first())
  await pause(page, HOLD_MERCHANT_TILE_MS)
  await pause(page, HOLD_END_MS)

  await screencast.send('Page.stopScreencast').catch(() => {})
  const captureEndedAt = Date.now() / 1000
  await context.close()
  await Promise.all(frameWrites)

  await mkdir(path.dirname(videoOutputPath), { recursive: true })
  await encodeVideo(framesDir, frames, captureEndedAt)
  console.log(`Demo video written to ${videoOutputPath}`)
} finally {
  await browser.close()
  await rm(framesDir, { recursive: true, force: true })
}
