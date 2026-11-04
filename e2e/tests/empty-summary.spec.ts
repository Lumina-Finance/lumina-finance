import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { openPage, logInViaApi, waitForPageReady } from '../support/app'

// Runs on desktop only: the summary's inert state and tab order are the same at every size

/**
 * Tab from the sidebar's log out button until focus passes the content, asserting no stop lands inside it
 *
 * @param page - Page showing the transactions summary
 * @param content - The summary content that must be skipped
 */
async function expectTabSkips(page: Page, content: Locator): Promise<void> {
  await page.getByRole('button', { name: 'Log out', exact: true }).focus()
  expect(await content.evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_PRECEDING)))
    .toBe(true)
  const maxStops = await page.locator('a[href], button, input, select, textarea, [tabindex]').count()
  let reachedAfterSummary = false
  for (let stop = 0; stop < maxStops; stop += 1) {
    await page.keyboard.press('Tab')
    const focus = await content.evaluate((element) => ({
      inside: element.contains(document.activeElement),
      after: Boolean(element.compareDocumentPosition(document.activeElement!) & Node.DOCUMENT_POSITION_FOLLOWING),
    }))
    expect(focus.inside).toBe(false)
    if (focus.after) {
      reachedAfterSummary = true
      break
    }
  }
  expect(reachedAfterSummary).toBe(true)
}

test('hides summary samples from assistive technology and the tab order while the summary loads', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/transactions/overview**', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/transactions')
  const loading = page.getByRole('status').filter({ hasText: 'Loading transaction summary' })
  await expect(loading).toBeVisible()
  const band = loading.locator('xpath=ancestor::section[1]')
  const content = band.locator(':scope > div').last()
  await expect(content).toHaveAttribute('inert', '')
  await expect(content).toHaveAttribute('aria-hidden', 'true')
  await expect(band.getByRole('button', { name: /^Edit transaction:/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Annual Insurance|Quarterly Tax|Emergency Vet/ })).toHaveCount(0)
  await expectTabSkips(page, content)

  release()
  await expect(page.getByText(/^No transaction data for /)).toBeVisible()
  await expect(band.getByRole('button', { name: /^Edit transaction:/ })).toHaveCount(0)
})

test('skips empty summary samples and restores genuine transaction edit actions', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Summary accessibility account' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const empty = page.getByText(/^No transaction data for /)
  await expect(empty).toBeVisible()
  const band = empty.locator('xpath=ancestor::section[1]')
  const content = band.locator(':scope > div').last()
  await expect(content).toHaveAttribute('inert', '')
  await expect(content).toHaveAttribute('aria-hidden', 'true')
  await expect(band.getByRole('button', { name: /^Edit transaction:/ })).toHaveCount(0)
  await expect(band.getByRole('paragraph').filter({ hasText: /^No transaction data for / })).toBeVisible()

  await expectTabSkips(page, content)

  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -4250,
  })
  await page.reload()
  await waitForPageReady(page)
  await expect(empty).toBeHidden()
  const edit = page.getByRole('button', { name: /^Edit transaction:/ })
  await expect(edit).toHaveCount(1)
  await expect(edit).toBeVisible()
  const realBand = edit.locator('xpath=ancestor::section[1]')
  const realContent = realBand.locator(':scope > div').last()
  await expect(realContent).not.toHaveAttribute('inert', '')
  await expect(realContent).not.toHaveAttribute('aria-hidden', 'true')
  await edit.focus()
  await expect(edit).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).toBeVisible()
})
