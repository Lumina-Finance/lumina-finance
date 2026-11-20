/**
 * Watching a submit button turn from its label into a spinner and back, one frame at a time, so a change
 * made within one render shows as a jump rather than being read as the end state
 */

import { expect, type Locator, type Page } from '@playwright/test'

import { nextFrame } from './app'
import { API_BASE_URL } from './target'

// The 40px circle a submit button shrinks to while its request is in flight
export const CIRCLE_WIDTH = 40

// One animation frame of slack for a width measured in fractions of a pixel
const WIDTH_TOLERANCE = 1

// Half a pixel of slack for a box measured in fractions of a pixel
const PADDING_TOLERANCE = 0.5

// How many points of each change the sampler reads by seeking its animations, so the in-between states are
// recorded however few frames a busy page draws. A button that snaps has no animation to seek
const SEEK_STEPS = 20

// The shortest time the width may spend between its two ends. The 300ms ease spends about half of it there on
// its ease-out curve, and an ease cut to a few milliseconds spends about that long, however finely it is seeked
const MIN_EASING_MS = 100

/** One frame of the button as the sampler saw it */
export interface ButtonFrame {
  /** When the frame shows, in milliseconds on the page's animation clock, the seeked time for a seeked frame */
  time: number

  width: number

  /** The label's opacity as a viewer sees it, or null while no label is drawn */
  label: number | null

  /** The spinner's opacity as a viewer sees it, or null while no spinner is drawn */
  spinner: number | null

  /**
   * How far the label's visible part reaches past the button's padding, in pixels, so a label wider than the
   * narrowing button shows as touching or passing its rounded ends. Zero while no label is drawn
   */
  labelPastPadding: number

  /** The footer's own box, which must not move while the button changes */
  footerTop: number
  footerHeight: number
}

/** The last frame the sampler recorded, rounded to whole pixels, or null before the first */
function lastFrame(page: Page): Promise<{ width: number; label: number | null; spinner: number | null } | null> {
  return page.evaluate(() => {
    const frame = (window as unknown as { __frames: ButtonFrame[] }).__frames.at(-1)
    return frame ? { width: Math.round(frame.width), label: frame.label, spinner: frame.spinner } : null
  })
}

/**
 * Record the button on every frame until `stopSampling` is called, and at evenly spaced points of each change
 * its animations make, read by seeking them. The seeked points are added after the frame that saw the change
 * begin, so the recording keeps its first and last frames in order but not the ones between
 */
export async function startSampling(button: Locator, label: string): Promise<void> {
  await button.evaluate((node, { text, steps }) => {
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
    const read = (time: number): ButtonFrame => {
      const footer = node.parentElement!.getBoundingClientRect()
      // The label is a text node, bare in the button or inside a layer of its own
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let labelNode: Element | null = null
      for (let current = walker.nextNode(); current && !labelNode; current = walker.nextNode()) {
        if (current.textContent === text) labelNode = current.parentElement
      }
      const spinnerNode = node.querySelector('.app-spinner')

      // The part of the label a viewer sees: its text box cut by every ancestor that clips, up to the button
      let labelPastPadding = 0
      if (labelNode) {
        const range = document.createRange()
        range.selectNodeContents(labelNode)
        let left = range.getBoundingClientRect().left
        let right = range.getBoundingClientRect().right
        for (let current: Element | null = labelNode; current; current = current.parentElement) {
          const style = getComputedStyle(current)
          if (style.overflowX !== 'visible') {
            const box = current.getBoundingClientRect()
            // A clip cuts at the padding edge, inside the border. A clip margin only ever moves it outward, so
            // padding on the clipping element is no protection for the label
            const insets = (side: 'Left' | 'Right') => parseFloat(style[`border${side}Width`])
            left = Math.max(left, box.left + insets('Left'))
            right = Math.min(right, box.right - insets('Right'))
          }
          if (current === node) break
        }
        // The button's resting side padding, 1rem, and less once the button is too narrow to leave the
        // 24px spinner room between two of them
        const box = node.getBoundingClientRect()
        const padding = Math.min(16, Math.max(0, (box.width - 24) / 2))
        const innerLeft = box.left + padding
        const innerRight = box.right - padding
        labelPastPadding = Math.max(0, innerLeft - left, right - innerRight)
      }
      return {
        time,
        labelPastPadding,
        width: node.getBoundingClientRect().width,
        label: labelNode ? opacityWithin(labelNode) : null,
        spinner: spinnerNode ? opacityWithin(spinnerNode) : null,
        footerTop: footer.top,
        footerHeight: footer.height,
      }
    }

    // Seeks the running animations of the button and its content together from the earliest start to the last
    // end, reading each point, then sets each back where it was, all inside one task so the page never draws a
    // seeked state. The seek runs again whenever an animation joins, since a fade can start a frame after the
    // width. Each start is read from the current time rather than the start time. An animation gets a start time
    // only once the frame after it was made is drawn. The spinner's endless turn has no end to seek to
    const seen = new WeakSet<Animation>()
    const seekThrough = () => {
      const running = node.getAnimations({ subtree: true }).filter((animation) =>
        animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
      if (running.every((animation) => seen.has(animation))) return
      const now = Number(document.timeline.currentTime)
      const starts = running.map((animation) => now - Number(animation.currentTime))
      const lengths = running.map((animation) => Number(animation.effect!.getComputedTiming().endTime))
      const from = Math.min(...starts)
      const to = Math.max(...starts.map((start, index) => start + lengths[index]))
      const resting = running.map((animation) => animation.currentTime)
      for (let step = 0; step <= steps; step++) {
        const at = from + ((to - from) * step) / steps
        // An animation seeked past its end draws what follows it. Its finish waits for a microtask that does
        // nothing once the animation is set back below, so no end handler runs
        running.forEach((animation, index) => {
          animation.currentTime = at - starts[index]
        })
        frames.push(read(at))
      }
      running.forEach((animation, index) => {
        animation.currentTime = resting[index]
        seen.add(animation)
      })
    }

    const tick = () => {
      frames.push(read(Number(document.timeline.currentTime)))
      seekThrough()
      if (holder.__sampling) requestAnimationFrame(tick)
    }
    tick()
  }, { text: label, steps: SEEK_STEPS })
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
 * widths between the two for a time a viewer sees, and the label and spinner are drawn together. Under reduced
 * motion neither happens
 */
export function expectEased(frames: ButtonFrame[], restingWidth: number, reducedMotion: boolean): void {
  const between = frames.filter((frame) => frame.width > CIRCLE_WIDTH + WIDTH_TOLERANCE && frame.width < restingWidth - WIDTH_TOLERANCE)
  const bothDrawn = frames.filter((frame) => frame.label !== null && frame.spinner !== null)
  const pastPadding = frames.filter((frame) => frame.labelPastPadding > PADDING_TOLERANCE)
  expect(pastPadding.map((frame) => `${frame.width.toFixed(1)}px wide, label ${frame.label?.toFixed(2)}, spinner ${frame.spinner?.toFixed(2)}, ${frame.labelPastPadding.toFixed(1)}px past`),
    'the label stays inside the button\'s padding on every frame').toEqual([])
  const widths = `widths ${frames.map((frame) => Math.round(frame.width)).join(' ')}`
  const layers = `label ${frames.map((frame) => frame.label?.toFixed(2) ?? '-').join(' ')}`
  if (reducedMotion) {
    expect(between, `the width changes in one frame, ${widths}`).toHaveLength(0)
    expect(bothDrawn, `the label and spinner swap in one frame, ${layers}`).toHaveLength(0)
  } else {
    expect(between.length, `the width eases through frames between the two, ${widths}`).toBeGreaterThanOrEqual(2)
    const times = between.map((frame) => frame.time)
    expect(Math.max(...times) - Math.min(...times), `ms the width spends between the two, ${widths}`)
      .toBeGreaterThanOrEqual(MIN_EASING_MS)
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

/**
 * Wait until the button has stopped moving and nothing around it is scaled, since a dialogue scales in as
 * it opens. Two equal reads alone can both come before the scale begins on a busy page
 */
export async function settledWidth(button: Locator): Promise<number> {
  let previous = -1
  await expect.poll(async () => {
    const { width, isScaled } = await button.evaluate((node) => {
      let scaled = false
      for (let current: Element | null = node; current; current = current.parentElement) {
        const transform = getComputedStyle(current).transform
        const matrix = new DOMMatrix(transform === 'none' ? undefined : transform)
        if (matrix.a !== 1 || matrix.d !== 1) scaled = true
      }
      return { width: node.getBoundingClientRect().width, isScaled: scaled }
    })
    const settled = !isScaled && Math.abs(width - previous) < 0.01
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
  // A change of 20px or more spends the shortest easing time between its ends. A smaller one ends too close
  // to its start for that time to tell an ease from a snap
  expect(restingWidth).toBeGreaterThan(CIRCLE_WIDTH + 20)

  for (const reducedMotion of motions) {
    await page.emulateMedia({ reducedMotion })
    const held = await holdThenRefuse(page, request.method, request.path)

    // The button turns pending. The wait for the change's end checks what only the end draws, since a busy
    // page can hold the old width for several reads before the change begins
    await startSampling(button, label)
    await press()
    await held.sent
    await expect(button).toBeDisabled()
    await expect(button).toHaveAccessibleName(label)
    await expect.poll(() => lastFrame(page)).toEqual({ width: CIRCLE_WIDTH, label: null, spinner: 1 })
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
    await expect.poll(() => lastFrame(page)).toEqual({ width: Math.round(restingWidth), label: 1, spinner: null })
    await expect(button).toHaveAccessibleName(label)
    const returning = await stopSampling(page)
    expect(returning.at(-1)!.width).toBeCloseTo(restingWidth, 0)
    expect(returning.at(-1)!.spinner).toBeNull()
    expect(returning.at(-1)!.label).toBe(1)
    expectEased(returning, restingWidth, reducedMotion === 'reduce')
    await page.unroute(`${API_BASE_URL}${request.path}`)
  }
}

// `off` is how far, in px, the idle content's or the spinner's vertical centre sits from the button's
type IconFrame = { icon: number | null; spinner: number | null; off: number }

/**
 * Press a button whose icon gives way to the spinner while its request is held, and check the two fade
 * through each other as motion allows, going and coming back. Under reduced motion they swap in one frame
 */
export async function checkIconSwap(
  page: Page,
  button: Locator,
  request: { method: string; path: string },
  press: () => Promise<void> = () => button.click(),
  // Finds the idle content inside the button, which is its icon unless a label with no icon is given
  content = 'svg',
  // A button that stays enabled while pending says so with aria-busy instead
  options: { staysEnabled?: boolean } = {},
): Promise<void> {
  const sample = () => button.evaluate((node, idle) => {
    const opacityWithin = (element: Element | null): number | null => {
      if (!element) return null
      let opacity = 1
      for (let current: Element | null = element; current && current !== node; current = current.parentElement) {
        opacity *= Number(getComputedStyle(current).opacity)
      }
      return opacity
    }
    const frames: IconFrame[] = []
    const holder = window as unknown as { __iconFrames: IconFrame[]; __sampling: boolean }
    holder.__iconFrames = frames
    holder.__sampling = true
    const tick = () => {
      const centre = node.getBoundingClientRect()
      const middle = centre.top + centre.height / 2
      const off = [node.querySelector(idle), node.querySelector('.app-spinner')].reduce((worst, element) => {
        if (!element) return worst
        const box = element.getBoundingClientRect()
        return Math.max(worst, Math.abs(box.top + box.height / 2 - middle))
      }, 0)
      frames.push({ icon: opacityWithin(node.querySelector(idle)), spinner: opacityWithin(node.querySelector('.app-spinner')), off })
      if (holder.__sampling) requestAnimationFrame(tick)
    }
    tick()
  }, content)
  // The opacity of the first match as a viewer sees it, through the layers it sits in, or null while nothing
  // matches, so a wait for full opacity is not met by an element that has not been drawn yet or has left
  const seenOpacity = (selector: string) => button.evaluate((node, within) => {
    const element = node.querySelector(within)
    if (!element) return null
    let opacity = 1
    for (let current: Element | null = element; current && current !== node; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity)
    }
    return opacity
  }, selector)
  const stop = () => page.evaluate(() => {
    const holder = window as unknown as { __iconFrames: IconFrame[]; __sampling: boolean }
    holder.__sampling = false
    return holder.__iconFrames
  })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion })
    const held = await holdThenRefuse(page, request.method, request.path)
    const expectFaded = (frames: IconFrame[]) => {
      // Whatever is fading stays on the button's middle, a row fading out from the top sat 7px off it. An icon
      // beside text sits a pixel or so off through its own alignment, so the limit is 2px
      expect(Math.max(...frames.map((frame) => frame.off)), 'px the content or spinner sits off the button centre').toBeLessThan(2)
      const both = frames.filter((frame) => frame.icon !== null && frame.spinner !== null)
      if (reducedMotion === 'reduce') expect(both, 'the icon and spinner swap in one frame').toHaveLength(0)
      else expect(both.length, 'the icon and spinner are drawn together').toBeGreaterThanOrEqual(2)
    }

    await sample()
    await press()
    await held.sent
    if (options.staysEnabled) await expect(button).toHaveAttribute('aria-busy', 'true')
    else await expect(button).toBeDisabled()
    await expect.poll(() => seenOpacity('.app-spinner')).toBe(1)
    await expect.poll(() => seenOpacity(content)).toBeNull()
    // The sampler records on each frame, so the last frame it holds is from before the reads above unless one more is painted
    await nextFrame(page)
    const going = await stop()
    expect(going[0].icon, 'the icon is drawn before the press').toBe(1)
    expect(going.at(-1)!.icon, 'the icon is gone once the spinner has settled').toBeNull()
    expectFaded(going)

    await sample()
    held.release()
    if (options.staysEnabled) await expect(button).toHaveAttribute('aria-busy', 'false')
    else await expect(button).toBeEnabled()
    await expect.poll(() => seenOpacity(content)).toBe(1)
    await expect.poll(() => seenOpacity('.app-spinner')).toBeNull()
    await nextFrame(page)
    const returning = await stop()
    expect(returning.at(-1)!.spinner).toBeNull()
    expectFaded(returning)
    await page.unroute(`${API_BASE_URL}${request.path}`)
  }
}
