import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: a phone's narrow sheet is where a long label truncates beside the remove button

/**
 * Guards the keyboard focus ring on a selected-filter chip's remove button. It sat flush against the label,
 * so the ring was drawn over the label's last letter
 */

// The clear space the ring keeps from the label's edge, in pixels
const MIN_GAP = 4

const LONG_NAME = 'Everyday spending for the whole household and every holiday trip we take together'

const LISTS = [
  { domain: 'Account', path: '/accounts', facet: 'Type', option: /./, name: 'Everyday' },
  { domain: 'Transaction', path: '/transactions', facet: 'Accounts', option: 'Everyday', name: 'Everyday' },
  { domain: 'Transaction', path: '/transactions', facet: 'Accounts', option: LONG_NAME, name: LONG_NAME },
] as const

async function openPanelWithOneChip(page: Page, request: APIRequestContext, list: (typeof LISTS)[number]) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: list.name })
  await logInViaApi(page, user)
  await openPage(page, list.path)

  const panel = await openFilters(page, list.domain)
  await selectFacet(page, panel, list.facet)
  await panel.getByRole('checkbox', { name: list.option }).first().click()
  return panel.getByRole('group', { name: 'Selected filters', exact: true })
}

for (const colorScheme of ['light', 'dark'] as const) for (const list of LISTS) {
  test(`keeps the ${list.domain.toLowerCase()} chip "${list.name.slice(0, 20)}" focus ring clear of its label and at 3:1 in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const chips = await openPanelWithOneChip(page, request, list)
    const remove = chips.getByRole('button')
    await expect(remove).toHaveCount(1)
    await expect.poll(() => remove.evaluate((button) => getComputedStyle(button.parentElement!).opacity)).toBe('1')

    // Reached by keyboard, so the ring shows as it does for a user
    await page.keyboard.press('Tab')
    while (!(await remove.evaluate((button) => button === document.activeElement))) await page.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    await expect.poll(() => remove.evaluate((button) => getComputedStyle(button).outlineColor)).not.toMatch(/, 0\)$/)

    const geometry = await remove.evaluate((button) => {
      const label = button.previousElementSibling as HTMLElement
      const style = getComputedStyle(button)
      const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
      return {
        outline: style.outlineStyle,
        ringLeft: button.getBoundingClientRect().left - reach,
        labelRight: label.getBoundingClientRect().right,
        truncated: label.scrollWidth > label.clientWidth,
      }
    })

    // The ring is drawn half over the chip's tint and half over the panel behind it
    const contrast = await remove.evaluate((button) => {
      const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
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
      const surface = (from: Element | null) => {
        const fills: string[] = []
        for (let box = from; box; box = box.parentElement) fills.unshift(getComputedStyle(box).backgroundColor)
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = getComputedStyle(document.body).backgroundColor
        context.fillRect(0, 0, 1, 1)
        for (const fill of fills) {
          context.fillStyle = fill
          context.fillRect(0, 0, 1, 1)
        }
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
      }
      const ring = channels(getComputedStyle(button).outlineColor)
      const ratio = (behind: number[]) => {
        const [lighter, darker] = [luminance(ring), luminance(behind)].sort((a, b) => b - a)
        return (lighter + 0.05) / (darker + 0.05)
      }
      return { onChip: ratio(surface(button.parentElement)), onPanel: ratio(surface(button.parentElement!.parentElement)) }
    })

    expect(geometry.outline).toBe('solid')
    expect(contrast.onChip, 'ring against the chip fill').toBeGreaterThanOrEqual(3)
    expect(contrast.onPanel, 'ring against the panel').toBeGreaterThanOrEqual(3)
    expect(geometry.ringLeft - geometry.labelRight, 'clear space between the label and the ring').toBeGreaterThanOrEqual(MIN_GAP)
    if (list.name === LONG_NAME) expect(geometry.truncated, 'the long label is truncated').toBe(true)
  })
}
