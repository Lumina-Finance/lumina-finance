import { expect, test } from '@playwright/test'

import { asUser, createAccount, findReferenceId, signUpUser, TEST_CURRENCY, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: a box that loses the modal's sides shows only where the modal sits in the middle
// of a wide screen

// A modal too short for a list of five rows on either side of its field. That is when the list
// leaves the modal's height for the screen's while keeping to its sides. A box that lost the
// modal's sides on the way opened at the screen's left edge, away from its field
test('opens the replacement dropdown in the short merchant delete modal from its field, within the modal’s sides', async ({ page, request }) => {
  const user = await signUpUser(request)
  const headers = asUser(user)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const name = `Corner Market ${crypto.randomUUID()}`
  const merchant = await request.post(`${API_BASE_URL}/merchants`, { headers, data: { name } })
  expect(merchant.status(), await merchant.text()).toBe(201)
  const { id: merchantId } = await merchant.json() as { id: string }
  const transaction = await request.post(`${API_BASE_URL}/transactions`, {
    headers,
    data: {
      account_id: account.id,
      category_id: await findReferenceId(request, user, 'categories', 'Groceries'),
      merchant_id: merchantId,
      amount: -4250,
      currency: TEST_CURRENCY,
      dt: todayInTestTimezone(),
    },
  })
  expect(transaction.status(), await transaction.text()).toBe(201)

  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const search = page.getByRole('textbox', { name: 'Search merchants...', exact: true })
  await search.fill(name)
  await search.press('Enter')

  // Refused while transactions use the merchant. That is what opens the modal
  await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
  await page.getByRole('button', { name: `Confirm delete ${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Move transactions first', exact: true })
  await expect(dialog).toBeVisible()

  const field = dialog.getByRole('combobox', { name: 'Replacement merchant', exact: true })
  await field.click()
  await expect(dialog.getByRole('listbox')).toBeVisible()
  // The inner locator of a filter is looked for inside the box, so it starts from the page rather than
  // the dialogue
  const head = page.getByRole('combobox', { name: 'Replacement merchant', exact: true })
  const measured = [
    dialog.getByTestId('dropdown-box').filter({ has: head }),
    dialog.getByTestId('dropdown-slot').filter({ has: head }),
    dialog,
  ]

  // Measured together, once the box has finished widening
  await expect(async () => {
    const [box, slot, modal] = await page.evaluate(
      (elements) => elements.map((element) => element!.getBoundingClientRect().toJSON() as DOMRect),
      await Promise.all(measured.map((locator) => locator.elementHandle())),
    )

    expect(box.left, 'the box\'s left edge against the modal\'s').toBeGreaterThanOrEqual(modal.left)
    expect(box.right, 'the box\'s right edge against the modal\'s').toBeLessThanOrEqual(modal.right)

    // Grown away from the field's own edges, so the head sits exactly where the field does
    expect(Math.min(Math.abs(box.top - slot.top), Math.abs(box.bottom - slot.bottom))).toBeLessThanOrEqual(1)
    expect(Math.min(Math.abs(box.left - slot.left), Math.abs(box.right - slot.right))).toBeLessThanOrEqual(1)
  }).toPass()
})
