import { expect, test, type Locator } from '@playwright/test'

import { waitPastMotion } from '../support/app'
import { finishImport, undoImport, UNDO_SIZES } from '../support/import-undo'

// Runs on desktop only: each test sets the widths it checks itself

/** The button's width and right edge, which a jump in its size would change */
async function measure(button: Locator) {
  const box = await button.boundingBox()
  return { width: Math.round(box!.width * 10) / 10, right: Math.round((box!.x + box!.width) * 10) / 10 }
}

for (const size of UNDO_SIZES) {
  for (const input of ['mouse', 'keyboard'] as const) {
    for (const motion of ['no-preference', 'reduce'] as const) {
      test(`keeps the button one size when an undo by ${input} turns Imported into Commit import at ${size.width}x${size.height}, with motion ${motion}`, async ({ page, request }) => {
        await page.emulateMedia({ reducedMotion: motion })
        const imported = await finishImport(page, request, size)
        const before = await measure(imported)

        // Records every frame from the undo on, so a jump shows even if it lasts one frame
        await page.evaluate(() => {
          const frames: Array<{ width: number, commitOpacity: number }> = []
          const tick = () => {
            const buttons = [...document.querySelectorAll('button.app-primary-button')]
              .filter((node) => /Imported|Commit import/.test(node.textContent ?? ''))
            const commit = buttons.length === 1
              ? [...buttons[0].querySelectorAll('span')].find((label) => label.textContent === 'Commit import')
              : undefined
            if (buttons.length === 1) {
              frames.push({
                width: Math.round(buttons[0].getBoundingClientRect().width * 10) / 10,
                commitOpacity: commit ? Number(getComputedStyle(commit).opacity) : 1,
              })
            }
            requestAnimationFrame(tick)
          }
          tick()
          Object.assign(window, { buttonFrames: frames })
        })
        await undoImport(page, input)
        const commit = page.getByRole('button', { name: 'Commit import', exact: true })
        await expect(commit).toBeEnabled()
        // Past the label's fade, which is shorter than the setup panel's motion this waits out
        await waitPastMotion(page)

        expect(await measure(commit)).toEqual(before)
        const frames = await page.evaluate(() => (window as unknown as { buttonFrames: Array<{ width: number, commitOpacity: number }> }).buttonFrames)
        expect(frames.length).toBeGreaterThan(0)
        expect(new Set(frames.map((frame) => frame.width))).toEqual(new Set([before.width]))

        // The label eases in rather than swapping, and swaps at once under reduced motion
        const partway = frames.filter((frame) => frame.commitOpacity > 0 && frame.commitOpacity < 1)
        if (motion === 'reduce') expect(partway).toEqual([])
        else expect(partway.length).toBeGreaterThan(0)
        expect(frames.at(-1)?.commitOpacity).toBe(1)
      })
    }
  }
}
