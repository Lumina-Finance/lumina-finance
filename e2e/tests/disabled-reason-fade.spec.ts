import { expect, test, type Page } from '@playwright/test'

// Runs on desktop only: each test sets the one size it needs itself. The reason a greyed-out control gives
// only fades in, already where it belongs. It used to start at the top left of the window, and later
// from where it last showed, and travel to the pointer while it faded in

const FIX_FIELDS = 'Fix the fields with errors first'
const TOOLTIP = 'disabled-reason-tooltip'

// Two frames at a 60 Hz screen: a tooltip that slides moves further than this between its first
// visible frame and its resting place
const RESTING_TOLERANCE_PX = 0.5

type Frame = { opacity: number; left: number; top: number; right: number; bottom: number }

/** Opens sign-up with a wrong email, which holds the Sign up button off for a reason */
async function openHeldOffSignUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByLabel('Last name').fill('User')
  const submit = page.getByRole('button', { name: 'Sign up', exact: true })
  // The error line settles the layout, so the button is measured where it stays
  await expect(page.getByText('Enter a valid email address', { exact: true })).toBeVisible()
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  // The fields above it can still be loading, which would move the button from under a pointer put on it
  let lastBox = ''
  await expect.poll(async () => {
    const box = JSON.stringify(await submit.boundingBox())
    const isSettled = box === lastBox
    lastBox = box
    return isSettled
  }, { intervals: [250] }).toBe(true)
  await page.mouse.move(0, 0)
  const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: FIX_FIELDS })
  await expectFadedOut(tooltip)
  return { submit, tooltip }
}

async function expectFadedOut(tooltip: ReturnType<Page['getByTestId']>) {
  await expect.poll(() => tooltip.evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true)
}

/** Records, on every animation frame, the opacity and the box of the card the tooltip draws */
async function startRecording(page: Page) {
  await page.evaluate((testId) => {
    const frames: Frame[] = []
    ;(window as unknown as { tooltipFrames: Frame[] }).tooltipFrames = frames
    const record = () => {
      const wrapper = [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((node) => node.textContent)
      const card = wrapper?.firstElementChild
      if (wrapper && card) {
        const box = card.getBoundingClientRect()
        frames.push({ opacity: Number(getComputedStyle(wrapper).opacity), left: box.left, top: box.top, right: box.right, bottom: box.bottom })
      }
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, TOOLTIP)
}

async function readFrames(page: Page) {
  return page.evaluate(() => (window as unknown as { tooltipFrames: Frame[] }).tooltipFrames.slice())
}

async function clearFrames(page: Page) {
  await page.evaluate(() => { (window as unknown as { tooltipFrames: Frame[] }).tooltipFrames.length = 0 })
}

/** The frames from the first one the user could see, once the tooltip has come to rest */
async function readShown(page: Page) {
  let shown: Frame[] = []
  await expect.poll(async () => {
    shown = (await readFrames(page)).filter((frame) => frame.opacity > 0)
    return shown.length > 3 && shown.at(-1)!.opacity === 1 && shown.at(-1)!.left === shown.at(-2)!.left && shown.at(-1)!.top === shown.at(-2)!.top
  }).toBe(true)
  return shown
}

/** Fails when any visible frame is anywhere but the resting place, which is the last frame */
function expectInPlaceFromFirstFrame(shown: Frame[]) {
  const rest = shown.at(-1)!
  for (const frame of shown) {
    expect(Math.abs(frame.left - rest.left)).toBeLessThanOrEqual(RESTING_TOLERANCE_PX)
    expect(Math.abs(frame.top - rest.top)).toBeLessThanOrEqual(RESTING_TOLERANCE_PX)
  }
}

/** The frames in which the tooltip is part way between invisible and whole */
function fadingFrames(shown: Frame[]) {
  return shown.filter((frame) => frame.opacity < 1)
}

test('fades in at the pointer on the first show, follows it, and fades out on leaving', async ({ page }) => {
  const { submit, tooltip } = await openHeldOffSignUp(page)
  await startRecording(page)
  const box = (await submit.boundingBox())!
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.mouse.move(pointer.x, pointer.y)
  const shown = await readShown(page)
  expectInPlaceFromFirstFrame(shown)
  expect(fadingFrames(shown).length).toBeGreaterThan(1)
  // Beside the pointer: the card ends left of it and above it, and never reached the pointer from the top left
  expect(shown.at(-1)!.right).toBeLessThanOrEqual(pointer.x)
  expect(shown.at(-1)!.bottom).toBeLessThanOrEqual(pointer.y)

  // Following: the card keeps its distance from the pointer as it moves along the button
  const before = shown.at(-1)!
  await page.mouse.move(pointer.x - 40, pointer.y)
  await expect.poll(async () => Math.round((await readFrames(page)).at(-1)!.left - before.left)).toBe(-40)

  await page.mouse.move(0, 0)
  await expectFadedOut(tooltip)
})

test('fades in at the new pointer position when shown again from another place', async ({ page }) => {
  const { submit, tooltip } = await openHeldOffSignUp(page)
  await startRecording(page)
  const box = (await submit.boundingBox())!

  await page.mouse.move(box.x + box.width - 14, box.y + box.height / 2)
  await readShown(page)
  await page.mouse.move(0, 0)
  await expectFadedOut(tooltip)
  await clearFrames(page)

  await page.mouse.move(box.x + 14, box.y + box.height / 2)
  const shown = await readShown(page)
  expectInPlaceFromFirstFrame(shown)
  expect(fadingFrames(shown).length).toBeGreaterThan(1)
})

test('fades in already inside the window when the pointer rests at its edge', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { submit } = await openHeldOffSignUp(page)
  await startRecording(page)
  const box = (await submit.boundingBox())!

  await page.mouse.move(box.x + 14, box.y + box.height / 2)
  const shown = await readShown(page)
  expectInPlaceFromFirstFrame(shown)
  expect(fadingFrames(shown).length).toBeGreaterThan(1)
  for (const frame of shown) {
    expect(frame.left).toBeGreaterThanOrEqual(0)
    expect(frame.right).toBeLessThanOrEqual(390)
  }
})

test('fades in beside the control when it is tabbed to', async ({ page }) => {
  const { submit } = await openHeldOffSignUp(page)
  await startRecording(page)

  await page.getByLabel('Last name').press('Tab')
  for (let presses = 0; presses < 10 && !(await submit.evaluate((node) => node === document.activeElement)); presses += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(submit).toBeFocused()
  const shown = await readShown(page)
  expectInPlaceFromFirstFrame(shown)
  expect(fadingFrames(shown).length).toBeGreaterThan(1)

  // Beside the control, not over it
  const control = (await submit.boundingBox())!
  const rest = shown.at(-1)!
  const overlapsControl = rest.left < control.x + control.width && rest.right > control.x && rest.top < control.y + control.height && rest.bottom > control.y
  expect(overlapsControl).toBe(false)
})

test('appears in place with no animation under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { submit } = await openHeldOffSignUp(page)
  await startRecording(page)
  const box = (await submit.boundingBox())!

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const shown = await readShown(page)
  expectInPlaceFromFirstFrame(shown)
  expect(fadingFrames(shown)).toHaveLength(0)
})
