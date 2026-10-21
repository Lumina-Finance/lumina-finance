import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the footer has to line up with the header at every width

/**
 * Reads how far the footer's actions sit from the header's edges, left from where the title starts and
 * right from where the close button ends. Polled by the callers, since the panel scales in as it opens
 * and edges read mid-animation drift apart by however far it has to go
 */
function readEdgeOffsets(dialog: Locator, title: string, first: Locator, last: Locator) {
  return async () => {
    const [heading, close, firstBox, lastBox] = await Promise.all([
      dialog.getByRole('heading', { name: title, exact: true }).boundingBox(),
      dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox(),
      first.boundingBox(),
      last.boundingBox(),
    ])
    return {
      left: Math.round(firstBox!.x - heading!.x) || 0,
      right: Math.round(lastBox!.x + lastBox!.width - (close!.x + close!.width)) || 0,
    }
  }
}

// The transaction dialog draws its own footer, which lines up with its header at every width, so its
// keep-open checkbox starts where the title starts and its submit action ends where the close button ends
test('lines the Add transaction footer up with its header', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const keepOpen = dialog.getByRole('checkbox')
  const submit = dialog.getByRole('button', { name: 'Add transaction', exact: true })

  await expect.poll(readEdgeOffsets(dialog, 'Add transaction', keepOpen, submit)).toEqual({ left: 0, right: 0 })
})

// The account edit dialog sits on the narrower stacked panel and draws its own footer, which still lines
// up with its header: Delete starts where the title starts and Save changes ends where Close ends
test('lines the Edit account footer up with its header', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const remove = dialog.getByRole('button', { name: 'Delete account', exact: true })
  const save = dialog.getByRole('button', { name: 'Save changes', exact: true })

  await expect.poll(readEdgeOffsets(dialog, 'Edit account', remove, save)).toEqual({ left: 0, right: 0 })
})
