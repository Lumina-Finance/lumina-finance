// Helpers shared by the screenshot and demo recording scripts

// Demo login the captures are taken as
export const DEMO_EMAIL = 'alice@example.com'
export const DEMO_PASSWORD = 'password'

export const THEME_STORAGE_KEY = 'lumina:settings:theme'

// Captures run at a fixed clock so light mode reads as morning and dark mode
// as evening, on the same pinned day the seed script anchors its data window
// to, so captured pages never show future-dated entries
export const CLOCK_DAY_OF_MONTH = 15
export const CLOCK_HOUR_BY_THEME = { light: 9, dark: 19 }

export const VIEWPORTS = {
  desktop: { width: 2200, height: 1400 },
  tablet: { width: 1180, height: 820 },
  mobile: { width: 390, height: 844 },
}

// Every capture waits at least this long after its anchor content appears so
// animations finish, a fixed delay because the app keeps polling endpoints
// alive, which never lets Playwright's network-idle heuristic fire
export const SETTLE_MS = 2000

// How long a page may take to render its anchor before the run fails,
// generous because the dev server compiles each route on first visit
export const CONTENT_TIMEOUT_MS = 30_000

/** Normalise the URL input into a scheme-qualified base URL without a trailing slash */
export function resolveBaseUrl(rawUrl) {
  const trimmed = rawUrl.replace(/\/$/, '')
  return trimmed.startsWith('http') ? trimmed : `http://${trimmed}`
}

/** Preload the theme and shift the app clock before any page in the context boots */
export async function applyThemeAndClock(context, theme) {
  // The theme must be in localStorage before the app boots so the first paint
  // already uses it
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, theme],
  )

  // Shift only Date by a constant offset so the app reads the pinned day and
  // the theme's time of day while real timers keep running, because
  // Playwright's clock API fakes timers and stalls the app's loading screen.
  // Before the real 15th the pin steps back to the previous month's 15th,
  // matching the seed so the shown day never outruns the seeded data
  const clockTime = new Date()
  if (clockTime.getDate() < CLOCK_DAY_OF_MONTH) clockTime.setMonth(clockTime.getMonth() - 1)
  clockTime.setDate(CLOCK_DAY_OF_MONTH)
  clockTime.setHours(CLOCK_HOUR_BY_THEME[theme], 0, 0, 0)
  const clockOffsetMs = clockTime.getTime() - Date.now()
  await context.addInitScript((offsetMs) => {
    const RealDate = Date
    const realNow = RealDate.now.bind(RealDate)
    class OffsetDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(realNow() + offsetMs)
        } else {
          super(...args)
        }
      }

      static now() {
        return realNow() + offsetMs
      }
    }
    window.Date = OffsetDate
  }, clockOffsetMs)
}

/** Sign in through the real login form and wait until the app leaves the login page */
export async function logIn(page) {
  await page.getByLabel('Email').or(page.getByPlaceholder('Email')).first().fill(DEMO_EMAIL)
  await page.getByLabel('Password').or(page.getByPlaceholder('Password')).first().fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: CONTENT_TIMEOUT_MS })
}

/** Wait until the page shows its anchor content and stays showing it

The anchor is text that only renders once the page's own data has loaded,
because generic readiness checks pass on the navigation chrome while the
content area is still a spinner. The app can also fall back to its boot
splash seconds after content first appears, when the dev server compiles a
lazy chunk on first visit, so the state is re-checked after the settle delay
and the wait starts over if the splash won */
export async function waitForContent(page, anchor) {
  // Layouts render some text in both a desktop and a mobile variant with only
  // one visible, so the anchor must match the visible occurrence
  const anchorText = page.getByText(anchor).filter({ visible: true }).first()
  const splash = page.getByText(/financial future awaits/i)

  for (let attempt = 0; attempt < 3; attempt++) {
    await anchorText.waitFor({ timeout: CONTENT_TIMEOUT_MS })
    await splash.waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
    await page.waitForTimeout(SETTLE_MS)
    if ((await anchorText.isVisible()) && !(await splash.isVisible())) {
      return
    }
  }
  throw new Error(`Content for "${anchor}" did not stay visible`)
}
