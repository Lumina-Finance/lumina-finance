import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the Icon box sits beside the name field at every width, a phone included

const LANGUAGES = {
  English: { icon: 'Icon', name: 'Category name', nameError: 'Name is required', iconError: 'Choose an icon' },
  German: { icon: 'Symbol', name: 'Kategoriename', nameError: 'Name ist erforderlich', iconError: 'Symbol wählen' },
} as const

async function readBox(locator: Locator) {
  return (await locator.boundingBox())!
}

// The app has no German yet, so German is the text a browser translating the page puts in place
async function translateToGerman(page: Page) {
  const german = LANGUAGES.German
  await page.evaluate((words) => {
    const swap = (selector: string, from: string, to: string) => {
      const node = [...document.querySelectorAll(selector)].find((candidate) => candidate.textContent === from)
      if (node) node.textContent = to
    }
    swap('label', 'Icon', words.icon)
    swap('label', 'Category name', words.name)
    swap('p', 'Name is required', words.nameError)
    swap('p', 'Choose an icon', words.iconError)
  }, german)
}

for (const [language, words] of Object.entries(LANGUAGES)) {
  // Submitting the empty Create category form marks the Icon box invalid without any visible text beside
  // it, so the box stays level with the Category name field, and the name error sits clear of the labels
  test(`marks the Icon box invalid in place and keeps the name error clear of the labels in ${language}`, AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)

    await logInViaApi(page, user)
    await openPage(page, '/settings#categories')
    await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create category' })
    const iconBox = dialog.getByRole('button', { name: 'Select New category icon' })
    const nameInput = dialog.getByRole('textbox', { name: 'Category name', exact: true })

    // The dialog scales in as it opens, so the starting position is read once it has stopped moving
    await expect.poll(async () => {
      const first = await readBox(iconBox)
      await page.waitForTimeout(250)
      const second = await readBox(iconBox)
      return first.x === second.x && first.y === second.y
    }).toBe(true)
    const start = await readBox(iconBox)
    const startName = await readBox(nameInput)
    expect(startName.x, 'name input starts beside the Icon box').toBeGreaterThanOrEqual(start.x + start.width)
    expect(startName.y, 'name input top level with the Icon box top').toBe(start.y)
    await expect(iconBox).not.toHaveAttribute('aria-invalid')

    await dialog.getByRole('button', { name: 'Create category', exact: true }).click()
    await expect(iconBox).toHaveAttribute('aria-invalid', 'true')
    await expect(iconBox).toHaveAccessibleDescription('Choose an icon')
    await expect(dialog.getByText('Name is required', { exact: true })).toBeVisible()
    // The errors slide in and fade, so read the boxes once the name error has settled in place
    await expect.poll(() => dialog.getByText('Name is required', { exact: true }).evaluate((node) => getComputedStyle(node).opacity)).toBe('1')
    const name = await readBox(nameInput)
    if (language === 'German') await translateToGerman(page)

    // Screen readers get the message, and nothing of it shows: its box is the clipped one-pixel box
    // The faded Create button's tooltip repeats the first problem, so look only at the alert
    const iconMessage = dialog.getByRole('alert').getByText(words.iconError, { exact: true })
    await expect(iconMessage).toHaveCount(1)
    const message = await readBox(iconMessage)
    expect(message.width).toBeLessThanOrEqual(1)
    expect(message.height).toBeLessThanOrEqual(1)

    // The Icon box turns to its error colour where it was, without moving, with its top edge on the
    // name input's and the input beside it
    const invalid = await readBox(iconBox)
    expect(invalid.y).toBe(start.y)
    expect(invalid.x).toBe(start.x)
    expect(name.x).toBeGreaterThanOrEqual(invalid.x + invalid.width)
    expect(invalid.y).toBe(name.y)

    // No error overlaps either label
    const labels = dialog.getByText(new RegExp(`^(${words.icon}|${words.name})$`))
    await expect(labels).toHaveCount(2)
    const nameError = await readBox(dialog.getByText(words.nameError, { exact: true }))
    for (const label of await labels.all()) {
      const box = await readBox(label)
      const across = Math.min(box.x + box.width, nameError.x + nameError.width) - Math.max(box.x, nameError.x)
      const down = Math.min(box.y + box.height, nameError.y + nameError.height) - Math.max(box.y, nameError.y)
      expect(across > 0 && down > 0, `${await label.textContent()} overlapped by the name error`).toBe(false)
    }

    // Choosing an icon clears the error state and moves nothing
    await iconBox.click()
    await page.getByRole('dialog', { name: 'Select New category icon' }).getByRole('button', { name: '😀', exact: true }).click()
    await expect(iconBox).not.toHaveAttribute('aria-invalid')
    await expect(iconBox).not.toHaveAccessibleDescription(/\S/)
    await expect(iconMessage).toHaveCount(0)
    const cleared = await readBox(iconBox)
    expect(cleared.x).toBe(start.x)
    expect(cleared.y).toBe(start.y)
  })
}
