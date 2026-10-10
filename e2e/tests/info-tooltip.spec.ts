import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: a touch screen opens the tooltip by tap rather than by click

/**
 * Guards a press on a control inside an open info tooltip. The open panel used to take pointer input
 * only while hovered, so on a touch screen, which has no hover, a tap on its link landed behind it, and
 * on a wide page it opened under the list toolbar, which covered its link
 */

// The tablet and phone projects are touch screens with no hover. The desktop one presses with a mouse
// that hovers on its way to the link, where the panel opens across the sticky toolbar below it
test('follows a link inside an open info tooltip', AT_EVERY_SIZE, async ({ page, request, hasTouch }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const help = page.getByRole('button', { name: 'How runway is calculated', exact: true })
  const settings = page.getByRole('link', { name: 'Runway settings', exact: true })
  if (hasTouch) {
    await help.tap()
    await settings.tap()
  } else {
    await help.click()
    await settings.click()
  }
  await expect(page).toHaveURL(/\/settings#runway$/)
})
