import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage, readSettledScrollingBox, roomBelow } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the warning has to fit above the dialog's footer, which depends on the screen

/**
 * Guards the archive warning in the account edit dialog. It grows in at the foot of the dialog's
 * scrolling body, which used to stay where it was, so the sentence saying what archiving records sat
 * out of sight under the footer
 */

test('brings the whole archive warning into view above the footer', AT_EVERY_SIZE, async ({ page, request }) => {
  // A short window, so the sections above the switch fill the dialog
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000 })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })

  await dialog.getByText('Archive account', { exact: true }).click()
  await expect(dialog.getByRole('switch')).toBeChecked()
  // The sentence saying what archiving records, which closes the warning
  const warning = dialog.getByText('will be recorded as a Balance Adjustment')
  await expect(warning).toBeVisible()
  // Announced as it appears
  await expect(dialog.getByRole('alert')).toContainText('will be recorded as a Balance Adjustment')

  // The whole of it. The body it scrolls in ends at the footer, so what is under the footer is cut off and
  // not on screen
  await expect(warning).toBeInViewport({ ratio: 1 })
  // With the body's own bottom padding still showing below it, so it never sits flush on the footer
  const settled = await readSettledScrollingBox(dialog.getByRole('alert'))
  expect(roomBelow(settled)).toBeGreaterThanOrEqual(settled.paddingBottom)
})
