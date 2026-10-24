/**
 * Guards the six-box code field's active box against a pale tint nobody can see: it takes the same focus
 * border as every other field, at 3:1 or more against its box, and only while the field has focus
 */
import { expect, test, type Locator } from '@playwright/test'

import { signUpUser } from '../support/api'
import { reachTwoFactorChallenge } from '../support/app'
import { API_BASE_URL } from '../support/target'
import { enrollTotp } from '../support/totp'

// Runs on desktop only: the field is drawn the same at every size

// WCAG's minimum for the outline of a control
const MIN_BORDER_CONTRAST = 3

interface BoxLook {
  border: string
  shadow: string
  contrast: number
}

/** What each box shows, with the focus border and its contrast against the box read from the real tokens */
async function readBoxes(boxes: Locator): Promise<{ looks: BoxLook[]; ring: string; ringShadow: string }> {
  return boxes.evaluateAll((elements) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const channels = (colour: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = colour
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }
    const luminance = (colour: number[]) => {
      const [r, g, b] = colour.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrastOf = (a: number[], b: number[]) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (high + 0.05) / (low + 0.05)
    }

    // The token's own text is resolved on a probe, since a custom property reads back as written
    const probe = document.createElement('div')
    probe.style.borderColor = 'var(--app-focus-ring)'
    probe.style.boxShadow = 'var(--app-focus-border)'
    document.body.append(probe)
    const probeStyle = getComputedStyle(probe)
    const ring = probeStyle.borderTopColor
    const ringShadow = probeStyle.boxShadow
    probe.remove()

    const looks = elements.map((element) => {
      const style = getComputedStyle(element)
      return {
        border: style.borderTopColor,
        shadow: style.boxShadow,
        contrast: contrastOf(channels(style.borderTopColor), channels(style.backgroundColor)),
      }
    })
    return { looks, ring, ringShadow }
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`marks the box the next digit goes into with the shared focus border in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    await enrollTotp(request, user)

    // Holds the check of the finished code, so the field can be looked at while it is disabled
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(`${API_BASE_URL}/auth/2fa/verify`, async (route) => {
      await held
      await route.continue()
    })

    await reachTwoFactorChallenge(page, user)
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    const field = page.getByLabel('One-time code')
    // The six boxes are drawn after the field that captures the typing
    const boxes = field.locator('xpath=following-sibling::div')
    await expect(boxes).toHaveCount(6)

    // The mark is only on the box that takes the next digit, and fully the shared look
    const markedBoxes = async () => {
      const { looks, ring, ringShadow } = await readBoxes(boxes)
      return looks.flatMap((look, index) => look.border === ring && look.shadow === ringShadow ? [index] : [])
    }
    await field.focus()
    await expect.poll(markedBoxes).toEqual([0])
    const { looks } = await readBoxes(boxes)
    expect(looks[0].contrast).toBeGreaterThanOrEqual(MIN_BORDER_CONTRAST)

    await page.keyboard.type('123')
    await expect.poll(markedBoxes).toEqual([3])

    // The last digit sends the code, which disables the field, and a disabled field shows no mark
    await page.keyboard.type('456')
    await expect(field).toBeDisabled()
    await expect.poll(markedBoxes).toEqual([])
    release()
  })
}
