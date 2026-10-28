import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: below 1050px wide the step-up modal fills the screen and takes the form modals'
// layout, and from 1050px up it is the compact railed dialog

const FULLSCREEN_BELOW_PX = 1050

test('lays the step-up password step out like the form modals below 1050px', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()

  const modal = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  const eyebrow = modal.locator('.app-modal-phone-eyebrow')
  const field = modal.getByLabel('Current password')
  const next = modal.getByRole('button', { name: 'Continue' })
  await expect(field).toBeVisible()

  if (page.viewportSize()!.width >= FULLSCREEN_BELOW_PX) {
    await expect(eyebrow).toBeHidden()
    return
  }

  // Polled, since the panel scales in as it opens
  const readLayout = async () => {
    const [panel, eyebrowBox, fieldBox, nextBox] = await Promise.all([
      modal.boundingBox(), eyebrow.boundingBox(), field.boundingBox(), next.boundingBox(),
    ])
    return {
      eyebrowAboveField: eyebrowBox !== null && eyebrowBox.y + eyebrowBox.height < fieldBox!.y,
      // The action sits at the bottom of the screen, so the gap above it is the body, not a reserved room
      nextAtScreenBottom: Math.abs(panel!.y + panel!.height - (nextBox!.y + nextBox!.height)) < 40,
    }
  }
  await expect.poll(readLayout).toEqual({ eyebrowAboveField: true, nextAtScreenBottom: true })
})
