import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'
import { AT_EVERY_SIZE } from '../support/sizes'

test('fades in the crossed date range message of the filters as every field message does', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Fade account' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const panel = await openFilters(page, 'Transaction')
  await selectFacet(page, panel, 'Date')

  // Reads each message's opacity the moment it joins the page, before the first frame draws it
  await page.evaluate(() => {
    const seen: number[] = []
    ;(window as unknown as { alertOpacities: number[] }).alertOpacities = seen
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.getAttribute('role') === 'alert') seen.push(Number(getComputedStyle(node).opacity))
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  for (const [label, day] of [['From', '20'], ['To', '10']] as const) {
    const date = panel.getByRole('group', { name: label, exact: true })
    await date.getByRole('textbox', { name: 'Year', exact: true }).fill('2024')
    await date.getByRole('textbox', { name: 'Month', exact: true }).fill('03')
    await date.getByRole('textbox', { name: 'Day', exact: true }).fill(day)
  }
  await expect(panel.getByRole('alert')).toHaveText("From can't be after To")

  const opacities = await page.evaluate(() => (window as unknown as { alertOpacities: number[] }).alertOpacities)
  expect(opacities).toEqual([0])
})
