import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createMonthlyBudget, signUpUser } from '../support/api'
import { logInViaApi, openPage, readSettledBox } from '../support/app'

// Runs on desktop only: each test sets the size it checks itself. The reason of a held-back button, shown by
// a hover, stays where the hover put it when a click, Enter or keyboard focus follows. It never slides across
// the button, and one shown again while the last one fades out appears at its new place. A tap on a touch
// screen still places it beside the button

const SIZES = [
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
]

// Frames the reason must hold still for before it counts as at rest, and the frames read after the press.
// They outlast its fade and glide at 60 frames a second
const REST_FRAMES = 30
const FRAMES_AFTER_PRESS = 60
const SAME_PLACE_PX = 0.5

type Box = { x: number; y: number; width: number; height: number }
type Frame = { shown: number; panel: Box | null }

declare global {
  interface Window {
    __reasonFrames?: { frames: Frame[]; isStopped: boolean }
  }
}

/** Opens the edit window of a one-off budget too old to repeat, so its Recurring option is held back */
async function openHeldBackRecurring(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Old one-off',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart: '1900-01-01',
    recurs: false,
  })
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Old one-off', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })
  const recurring = edit.getByRole('button', { name: 'Recurring', exact: true })
  await expect(recurring).toHaveAttribute('aria-disabled', 'true')
  return { recurring, once: edit.getByRole('button', { name: 'Once', exact: true }) }
}

/** Starts reading the box of the shown reason on every frame, at any opacity above 0 */
async function startReadingFrames(page: Page) {
  await page.evaluate(() => {
    const reading = { frames: [] as Frame[], isStopped: false }
    window.__reasonFrames = reading
    const read = () => {
      const shown = [...document.querySelectorAll('[data-testid="disabled-reason-tooltip"]')].filter(
        (tooltip) => Number(getComputedStyle(tooltip).opacity) > 0,
      )
      const card = shown[0]?.querySelector('.app-cursor-tooltip-flip')
      const box = card?.getBoundingClientRect()
      reading.frames.push({ shown: shown.length, panel: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null })
      if (!reading.isStopped) requestAnimationFrame(read)
    }
    requestAnimationFrame(read)
  })
}

/**
 * Waits until one reason shows and has held still for a run of frames, and until `framesAfter` more frames
 * than `from` have been read, then returns how many frames there are
 */
async function waitForRest(page: Page, framesAfter = 0, from = 0) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ restFrames, after, start }) => {
          const frames = window.__reasonFrames!.frames
          const last = frames.slice(-restFrames)
          const isStill = last.length === restFrames && last.every((frame) => frame.shown === 1 && JSON.stringify(frame) === JSON.stringify(last[0]))
          return isStill && frames.length - start >= after
        },
        { restFrames: REST_FRAMES, after: framesAfter, start: from },
      ),
    )
    .toBe(true)
  return page.evaluate(() => window.__reasonFrames!.frames.length)
}

async function stopReadingFrames(page: Page) {
  return page.evaluate(() => {
    window.__reasonFrames!.isStopped = true
    return window.__reasonFrames!.frames
  })
}

/** Moves the pointer to the middle of the control from outside the control, as a user reaching for it does */
async function hoverMiddleOf(page: Page, control: Locator) {
  await page.mouse.move(1, 1)
  const box = (await control.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
}

function isAt(panel: Box, place: Box) {
  return Math.abs(panel.x - place.x) <= SAME_PLACE_PX && Math.abs(panel.y - place.y) <= SAME_PLACE_PX
}

/** The frames from `from` on in which the reason is shown away from every one of the places */
function findStrays(frames: Frame[], from: number, places: Box[]) {
  return frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame, index }) => index >= from && frame.panel !== null && !places.some((place) => isAt(frame.panel!, place)))
    .map(({ index }) => index)
}

/** Hovers the option to rest, runs `press`, and expects the reason to stay in the place the hover put it */
async function expectStaysAfter(page: Page, request: APIRequestContext, press: (option: Locator, other: Locator) => Promise<void>) {
  const { recurring, once } = await openHeldBackRecurring(page, request)
  for (const size of SIZES) {
    await page.setViewportSize(size)
    // One key press makes a focus that follows count as the keyboard's, as a Tab onto the option would
    await page.keyboard.press('Tab')
    await page.mouse.move(1, 1)
    await startReadingFrames(page)
    await hoverMiddleOf(page, recurring)
    const hovered = await waitForRest(page)
    const frames = await page.evaluate(() => window.__reasonFrames!.frames)
    const place = frames[hovered - 1].panel!

    await press(recurring, once)
    await waitForRest(page, FRAMES_AFTER_PRESS, hovered)

    const after = await stopReadingFrames(page)
    expect(findStrays(after, hovered, [place]), `frames with the reason away from where the hover put it at ${size.width} wide`).toEqual([])
    expect(after.filter((frame) => frame.shown > 1)).toEqual([])
    await page.mouse.move(1, 1)
    await recurring.evaluate((node) => node.blur())
  }
}

test('keeps the reason where the hover put it when Enter follows', async ({ page, request }) => {
  await expectStaysAfter(page, request, async (recurring) => {
    // A click only focuses the option, and Enter on the focused option is the press that shows the reason again
    await page.mouse.down()
    await page.mouse.up()
    await expect(recurring).toBeFocused()
    await recurring.press('Enter')
  })
})

test('keeps the reason where the hover put it when a click follows', async ({ page, request }) => {
  await expectStaysAfter(page, request, async () => {
    await page.mouse.down()
    await page.mouse.up()
  })
})

test('keeps the reason where the hover put it when focus arrives while the pointer stays on the option', async ({ page, request }) => {
  await expectStaysAfter(page, request, async (recurring) => {
    await recurring.focus()
    await expect(recurring).toBeFocused()
  })
})

test('keeps the reason where the hover put it when Shift+Tab reaches the option from the next one', async ({ page, request }) => {
  await expectStaysAfter(page, request, async (recurring, once) => {
    await once.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(recurring).toBeFocused()
  })
})

test('shows a reason again after the pointer leaves at its new place, without gliding there', async ({ page, request }) => {
  const { recurring } = await openHeldBackRecurring(page, request)
  await page.setViewportSize(SIZES[1])
  await page.keyboard.press('Tab')
  await startReadingFrames(page)
  await hoverMiddleOf(page, recurring)
  const hovered = await waitForRest(page)
  const hoverPlace = (await page.evaluate(() => window.__reasonFrames!.frames))[hovered - 1].panel!

  // The reason is still fading out where the hover put it when focus brings it back, beside the option
  await page.mouse.move(1, 1)
  await recurring.focus()
  await waitForRest(page, FRAMES_AFTER_PRESS, hovered)

  const frames = await stopReadingFrames(page)
  const focusPlace = frames[frames.length - 1].panel!
  expect(findStrays(frames, hovered, [hoverPlace, focusPlace]), 'frames with the reason between the two places').toEqual([])
})

test.describe('on a touch screen', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  // A touch has no hover to keep, so a tap still places the reason beside the button, as it always did
  test('places the reason beside the button after a tap, off the finger', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('First name').fill('Test')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Last name').fill('User')
    const submit = page.getByRole('button', { name: 'Sign up', exact: true })
    await expect(submit).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText('Enter a valid email address', { exact: true })).toBeVisible()
    await readSettledBox(submit)

    await startReadingFrames(page)
    await submit.tap({ force: true })
    await waitForRest(page)
    const frames = await stopReadingFrames(page)
    const panel = frames[frames.length - 1].panel!
    const button = (await submit.boundingBox())!
    expect(panel.y + panel.height <= button.y || panel.y >= button.y + button.height, 'the reason lies wholly above or below the button').toBe(true)
  })
})
