import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

/**
 * Guards the Balance and Change switch above an account's balance chart. It was a fixed width sized for
 * the English labels, so a longer translation, such as "Veränderung" from a browser's translation, was
 * cut off by its edge
 */

/** Whether each option shows its whole label, and the switch's width */
function measure(control: Locator) {
  return control.evaluate((node) => ({
    width: Math.round(node.getBoundingClientRect().width),
    clipped: [...node.querySelectorAll('[role="tab"]')]
      .some((tab) => tab.scrollWidth > tab.clientWidth + 1 || tab.getBoundingClientRect().right > node.getBoundingClientRect().right),
  }))
}

test('shows both options in full in English and in a longer translation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const control = page.getByRole('tablist', { name: 'Balance chart view' }).filter({ visible: true })
  await expect(control.getByRole('tab', { name: 'Change', exact: true })).toBeVisible()

  // English keeps the width it has always had
  expect(await measure(control)).toEqual({ width: 152, clipped: false })

  // The labels a browser translating the page into German puts in place
  await control.evaluate((node) => {
    const [balance, change] = node.querySelectorAll('[role="tab"]')
    balance.textContent = 'Kontostand'
    change.textContent = 'Veränderung'
  })
  const translated = await measure(control)
  expect(translated.clipped).toBe(false)
  expect(translated.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})
