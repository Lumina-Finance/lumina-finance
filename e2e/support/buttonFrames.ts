/**
 * Watching a submit button turn from its label into a spinner and back, one frame at a time, so a change
 * made within one render shows as a jump rather than being read as the end state
 */

import { expect, type Locator, type Page } from '@playwright/test'

import { API_BASE_URL } from './target'

// The 40px circle a submit button shrinks to while its request is in flight
export const CIRCLE_WIDTH = 40

// One animation frame of slack for a width measured in fractions of a pixel
const WIDTH_TOLERANCE = 1

/** One frame of the button as the sampler saw it */
export interface ButtonFrame {
  width: number

  /** The label's opacity as a viewer sees it, or null while no label is drawn */
  label: number | null

  /** The spinner's opacity as a viewer sees it, or null while no spinner is drawn */
  spinner: number | null

  /** The footer's own box, which must not move while the button changes */
  footerTop: number
  footerHeight: number
}

/** Record the button on every frame until `stopSampling` is called */
export async function startSampling(button: Locator, label: string): Promise<void> {
  await button.evaluate((node, text) => {
    const opacityWithin = (element: Element): number => {
      let opacity = 1
      for (let current: Element | null = element; current && current !== node; current = current.parentElement) {
        opacity *= Number(getComputedStyle(current).opacity)
      }
      return opacity
    }
    const frames: ButtonFrame[] = []
    const holder = window as unknown as { __frames: ButtonFrame[]; __sampling: boolean }
    holder.__frames = frames
    holder.__sampling = true
    const tick = () => {
      const footer = node.parentElement!.getBoundingClientRect()
      // The label is a text node, bare in the button or inside a layer of its own
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let labelNode: Element | null = null
      for (let current = walker.nextNode(); current && !labelNode; current = walker.nextNode()) {
        if (current.textContent === text) labelNode = current.parentElement
      }
      const spinnerNode = node.querySelector('.app-spinner')
      frames.push({
        width: node.getBoundingClientRect().width,
        label: labelNode ? opacityWithin(labelNode) : null,
        spinner: spinnerNode ? opacityWithin(spinnerNode) : null,
        footerTop: footer.top,
        footerHeight: footer.height,
      })
      if (holder.__sampling) requestAnimationFrame(tick)
    }
    tick()
  }, label)
}

/** Stop recording and return every frame since `startSampling` */
export async function stopSampling(page: Page): Promise<ButtonFrame[]> {
  return page.evaluate(() => {
    const holder = window as unknown as { __frames: ButtonFrame[]; __sampling: boolean }
    holder.__sampling = false
    return holder.__frames
  })
}

/**
 * Check the frames of one change between the label and the spinner. With motion, the width passes through
 * widths between the two and the label and spinner are drawn together; under reduced motion neither happens
 */
export function expectEased(frames: ButtonFrame[], restingWidth: number, reducedMotion: boolean): void {
  const between = frames.filter((frame) => frame.width > CIRCLE_WIDTH + WIDTH_TOLERANCE && frame.width < restingWidth - WIDTH_TOLERANCE)
  const bothDrawn = frames.filter((frame) => frame.label !== null && frame.spinner !== null)
  const widths = `widths ${frames.map((frame) => Math.round(frame.width)).join(' ')}`
  const layers = `label ${frames.map((frame) => frame.label?.toFixed(2) ?? '-').join(' ')}`
  if (reducedMotion) {
    expect(between, `the width changes in one frame, ${widths}`).toHaveLength(0)
    expect(bothDrawn, `the label and spinner swap in one frame, ${layers}`).toHaveLength(0)
  } else {
    expect(between.length, `the width eases through frames between the two, ${widths}`).toBeGreaterThanOrEqual(2)
    expect(bothDrawn.length, `the label and spinner are drawn together, ${layers}`).toBeGreaterThanOrEqual(2)
  }
}

/** Hold the request a form sends until `release` is called, then refuse it so the form stays open with its label back */
export async function holdThenRefuse(
  page: Page,
  method: string,
  path: string,
): Promise<{ release: () => void; sent: Promise<void> }> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let markSent!: () => void
  const sent = new Promise<void>((resolve) => { markSent = resolve })
  await page.route(`${API_BASE_URL}${path}`, async (route) => {
    if (route.request().method() !== method) return route.fallback()
    markSent()
    await gate
    return route.fulfill({ status: 500, json: { detail: 'The server refused.' } })
  })
  return { release, sent }
}

/** Wait until the button has stopped moving, since a dialog scales in as it opens */
export async function settledWidth(button: Locator): Promise<number> {
  let previous = -1
  await expect.poll(async () => {
    const width = (await button.boundingBox())!.width
    const settled = Math.abs(width - previous) < 0.01
    previous = width
    return settled
  }).toBe(true)
  return previous
}

/**
 * Press a submit button whose request is held, check the label turns into the spinner as motion allows, then
 * release the refusal and check the label comes back the same way, once with motion and once without
 */
export async function checkSubmitTransition(
  page: Page,
  button: Locator,
  label: string,
  request: { method: string; path: string },
  press: () => Promise<void> = () => button.click(),
  // A button that leaves the page when its request is refused has no way back to check, and runs one
  // round of motion per call, since the page is reached again for the next
  options: { returns?: boolean; motions?: Array<'no-preference' | 'reduce'> } = {},
): Promise<void> {
  const { returns = true, motions = ['no-preference', 'reduce'] } = options
  const restingWidth = await settledWidth(button)
  expect(restingWidth).toBeGreaterThan(CIRCLE_WIDTH + 10)

  for (const reducedMotion of motions) {
    await page.emulateMedia({ reducedMotion })
    const held = await holdThenRefuse(page, request.method, request.path)

    // The button turns pending
    await startSampling(button, label)
    await press()
    await held.sent
    await expect(button).toBeDisabled()
    await expect(button).toHaveAccessibleName(label)
    expect(await settledWidth(button)).toBeCloseTo(CIRCLE_WIDTH, 0)
    const pending = await stopSampling(page)
    expect(pending[0].label, 'the label is drawn before the press').toBe(1)
    expect(pending.at(-1)!.label, 'the label is gone once the spinner has settled').toBeNull()
    expect(pending.at(-1)!.spinner).toBe(1)
    expectEased(pending, restingWidth, reducedMotion === 'reduce')
    // Only the first round starts without an error in the footer, which the later rounds' refusals leave there
    if (reducedMotion === 'no-preference') {
      for (const frame of pending) {
        expect(frame.footerTop).toBeCloseTo(pending[0].footerTop, 0)
        expect(frame.footerHeight).toBeCloseTo(pending[0].footerHeight, 0)
      }
    }

    if (!returns) {
      await page.unroute(`${API_BASE_URL}${request.path}`)
      continue
    }

    // The request fails and the label comes back the same way
    await startSampling(button, label)
    held.release()
    await expect(button).toBeEnabled()
    expect(await settledWidth(button)).toBeCloseTo(restingWidth, 0)
    await expect(button).toHaveAccessibleName(label)
    const returning = await stopSampling(page)
    expect(returning.at(-1)!.spinner).toBeNull()
    expect(returning.at(-1)!.label).toBe(1)
    expectEased(returning, restingWidth, reducedMotion === 'reduce')
    await page.unroute(`${API_BASE_URL}${request.path}`)
  }
}
