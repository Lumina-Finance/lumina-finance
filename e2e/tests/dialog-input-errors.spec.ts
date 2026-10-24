import { expect, test, type Locator, type Page } from '@playwright/test'

import { budgetPeriodStart, createAccount, createMonthlyBudget, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs at every size, apart from the Edit budget and keep-open tests, whose behaviour does not change with the
// width: the message sits on the field's label row, which stacks
// differently on a phone, and the button is reached by tap there

/** Open the Create tag dialog from Settings, a dialog with one required field */
async function openCreateTag(page: Page): Promise<{ dialog: Locator; field: Locator; create: Locator }> {
  await openPage(page, '/settings#tags')
  await page.locator('#tags').getByRole('button', { name: 'Create tag', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create tag' })
  return {
    dialog,
    field: dialog.getByRole('textbox', { name: 'Tag name', exact: true }),
    create: dialog.getByRole('button', { name: 'Create', exact: true }),
  }
}

/** Count the requests that create a tag, to prove a refused press sent nothing */
function countTagCreations(page: Page): () => number {
  let count = 0
  page.on('request', (request) => {
    if (request.url() === `${API_BASE_URL}/tags` && request.method() === 'POST') count += 1
  })
  return () => count
}

test.describe('dialog input errors', () => {
  test('opens clickable, marks the field when a press finds it empty, and returns once it is filled', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const creations = countTagCreations(page)
    await logInViaApi(page, user)
    const { dialog, field, create } = await openCreateTag(page)

    // Nothing is marked and the button is whole while the dialog is untouched
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    await create.click()
    const message = dialog.getByRole('alert')
    await expect(message).toHaveText('Name is required')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(creations()).toBe(0)

    // The message is on the field's label row, above the field and not down with the actions
    const [messageBox, fieldBox] = [await message.boundingBox(), await field.boundingBox()]
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(fieldBox!.y)

    // Typing fixes the one problem, which clears the message at once and brings the button back
    await field.fill('Holiday')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('keeps the faded button focusable and does nothing when it is pressed or Enter is pressed in the field', async ({ page, request }) => {
    const user = await signUpUser(request)
    const creations = countTagCreations(page)
    await logInViaApi(page, user)
    const { dialog, field, create } = await openCreateTag(page)

    // Enter in the empty field is a refused press too
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveText('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    // A refused press brings the first problem into focus a frame later, so wait for it before moving on
    await expect(field).toBeFocused()

    await create.focus()
    await expect(create).toBeFocused()
    await create.press('Enter')
    await field.press('Enter')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(creations()).toBe(0)
  })

  test('marks the empty name in the Create merchant dialogue and returns the button once it is filled', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/settings#merchants')
    await page.locator('#merchants').getByRole('button', { name: 'Create merchant', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create merchant' })
    const field = dialog.getByRole('textbox', { name: 'Merchant name', exact: true })
    const create = dialog.getByRole('button', { name: 'Create merchant', exact: true })

    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    await create.click()
    await expect(dialog.getByRole('alert')).toHaveText('Name is required')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')

    await field.fill('Costco')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the missing icon and name in the Create category dialogue and says the icon first on the button', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/settings#categories')
    await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create category' })
    // Named after the typed category name, so it is found by the words around it
    const iconBox = dialog.getByRole('button', { name: /^Select .* icon$/ })
    const name = dialog.getByRole('textbox', { name: 'Category name', exact: true })
    const create = dialog.getByRole('button', { name: 'Create category', exact: true })

    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await create.click()
    await expect(iconBox).toHaveAttribute('aria-invalid', 'true')
    await expect(iconBox).toHaveAccessibleDescription('Choose an icon')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await expect(create).toHaveAccessibleDescription('Choose an icon')

    // Fixing the name alone leaves the icon problem, so the button stays faded
    await name.fill('Groceries')
    await expect(name).not.toHaveAttribute('aria-invalid', 'true')
    await expect(create).toHaveAttribute('aria-disabled', 'true')

    await iconBox.click()
    await page.getByRole('dialog', { name: 'Select Groceries icon' }).getByRole('button', { name: '😀', exact: true }).click()
    await expect(iconBox).not.toHaveAttribute('aria-invalid')
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the missing name, country and website in the Add institution dialogue', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/accounts')
    const account = await openModal(page, ['Add account'], 'Add account')
    await account.getByRole('combobox', { name: 'Institution', exact: true }).click()
    await account.getByRole('button', { name: 'Create institution', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add institution' })
    const create = dialog.getByRole('button', { name: 'Create', exact: true })
    const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
    const country = dialog.getByRole('combobox', { name: 'Country', exact: true })
    const website = dialog.getByRole('textbox', { name: 'Website', exact: true })

    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    await create.click()
    await expect(dialog.getByRole('alert')).toHaveCount(3)
    await expect(name).toHaveAccessibleDescription('Name is required')
    await expect(country).toHaveAttribute('aria-invalid', 'true')
    await expect(country).toHaveAccessibleDescription('Select a country')
    await expect(website).toHaveAccessibleDescription('Website is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')

    // Each field clears on its own, and the button waits for the last
    await name.fill('Maple Bank')
    await website.fill('https://example.com')
    await expect(dialog.getByRole('alert')).toHaveCount(1)
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await chooseFromDropdown(dialog, 'Country', 'Canada')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the missing type and name in the Add account dialogue and says the type first on the button', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/accounts')
    const dialog = await openModal(page, ['Add account'], 'Add account')
    const create = dialog.getByRole('button', { name: 'Create account', exact: true })
    const name = dialog.getByRole('textbox', { name: 'Account name', exact: true })
    const type = dialog.getByRole('combobox', { name: 'Account type', exact: true })

    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await create.click()
    await expect(dialog.getByRole('alert')).toHaveCount(2)
    await expect(type).toHaveAttribute('aria-invalid', 'true')
    await expect(type).toHaveAccessibleDescription('Select an account type')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await expect(create).toHaveAccessibleDescription('Select an account type')

    await name.fill('Everyday')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await chooseFromDropdown(dialog, 'Account type', 'Checking')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the emptied name in the Edit account dialogue and keeps Save held off while deleting', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await page.getByRole('button', { name: 'Edit account', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
    const name = dialog.getByRole('textbox', { name: 'Account name', exact: true })
    const save = dialog.getByRole('button', { name: 'Save changes', exact: true })

    await expect(save).not.toHaveAttribute('aria-disabled', 'true')
    await name.fill('')
    await save.click()
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Name is required.')
    await expect(save).toHaveAttribute('aria-disabled', 'true')
    await expect(save).toHaveAccessibleDescription('Name is required.')

    await name.fill('Everyday')
    await expect(name).not.toHaveAttribute('aria-invalid', 'true')
    await expect(save).not.toHaveAttribute('aria-disabled', 'true')

    // An open delete step holds Save off with its own reason, whatever the form holds
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
    await expect(save).toHaveAttribute('aria-disabled', 'true')
    await expect(save).toHaveAccessibleDescription('Finish or cancel deleting the account first')
  })

  test('marks a wrong name in the delete step and returns Delete account once it matches', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await page.getByRole('button', { name: 'Edit account', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
    const typedName = dialog.getByRole('textbox', { name: 'Type "Everyday" to delete.', exact: true })
    const clickable = dialog.getByRole('button', { name: 'Delete account', exact: true, disabled: false })

    await expect(typedName).toBeVisible()
    await expect(clickable).toBeVisible()
    await typedName.fill('Every')
    await clickable.click()
    await expect(typedName).toHaveAccessibleDescription("Type the account's name to confirm")
    await expect(typedName).toHaveAttribute('aria-invalid', 'true')
    await expect(clickable).toHaveCount(0)

    await typedName.fill('Everyday')
    await expect(typedName).not.toHaveAttribute('aria-invalid', 'true')
    await expect(clickable).toBeVisible()
  })

  test('marks the missing name, limit and category in the Add budget dialogue and returns the button once each is fixed', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    await logInViaApi(page, user)
    await openPage(page, '/budgets')
    const dialog = await openModal(page, ['New budget'], 'Add budget')
    const create = dialog.getByTestId('budget-submit')
    const name = dialog.getByLabel('Name', { exact: true })
    const limit = dialog.getByLabel('Limit', { exact: true })
    const search = dialog.getByPlaceholder('Search categories...', { exact: true })

    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    await create.click()
    await expect(dialog.getByRole('alert')).toHaveCount(3)
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Name is required')
    await expect(limit).toHaveAttribute('aria-invalid', 'true')
    await expect(limit).toHaveAccessibleDescription('Limit must be greater than zero')
    await expect(search).toHaveAttribute('aria-invalid', 'true')
    await expect(search).toHaveAccessibleDescription('Select at least one category')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await expect(create).toHaveAccessibleDescription('Name is required')

    // The category message is on the label row above its search field, not down with the actions
    const message = dialog.getByRole('alert').filter({ hasText: 'Select at least one category' })
    const [messageBox, searchBox] = [await message.boundingBox(), await search.boundingBox()]
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(searchBox!.y)

    // Each field clears on its own, and the button waits for the last
    await name.fill('Groceries budget')
    await expect(dialog.getByRole('alert')).toHaveCount(2)
    await expect(create).toHaveAccessibleDescription('Limit must be greater than zero')
    await limit.fill('500')
    await expect(dialog.getByRole('alert')).toHaveCount(1)
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await dialog.getByRole('button', { name: 'Groceries', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(search).not.toHaveAttribute('aria-invalid', 'true')
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('keeps Save changes faded without changes in the Edit budget dialogue and marks an emptied name when it is pressed', async ({ page, request }) => {
    // Runs on desktop only: the details dialog's Edit button is covered when opened at phone width
    const user = await signUpUser(request)
    const id = await createMonthlyBudget(request, user, {
      name: 'Edit errors budget',
      categoryNames: ['Groceries'],
      overallLimit: 50_000,
      periodStart: budgetPeriodStart(),
    })
    await logInViaApi(page, user)
    await openPage(page, '/budgets')
    await page.getByTestId(`budget-card-${id}`).click()
    await page.getByRole('dialog', { name: 'Edit errors budget', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })
    const name = edit.getByLabel('Name', { exact: true })
    const save = edit.getByTestId('budget-submit')

    // Nothing to save is not an input problem, so Save changes is faded from the start with its reason
    await expect(save).toHaveAttribute('aria-disabled', 'true')
    await expect(save).toHaveAccessibleDescription('There are no changes to save')
    await expect(edit.getByRole('alert')).toHaveCount(0)

    await name.fill('')
    await expect(save).not.toHaveAttribute('aria-disabled', 'true')
    await expect(edit.getByRole('alert')).toHaveCount(0)

    await save.click()
    await expect(edit.getByRole('alert')).toHaveText('Name is required')
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveAccessibleDescription('Name is required')
    await expect(save).toHaveAttribute('aria-disabled', 'true')
    await expect(save).toHaveAccessibleDescription('Name is required')

    await name.fill('Renamed budget')
    await expect(edit.getByRole('alert')).toHaveCount(0)
    await expect(save).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the missing merchant, category and amount in the Add transaction dialogue and returns the button once each is fixed', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    let creations = 0
    page.on('request', (sent) => {
      if (sent.url() === `${API_BASE_URL}/transactions` && sent.method() === 'POST') creations += 1
    })
    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
    const add = dialog.getByTestId('transaction-submit')
    const merchant = dialog.getByRole('combobox', { name: 'Merchant', exact: true })
    const category = dialog.getByRole('combobox', { name: 'Category', exact: true })
    const amount = dialog.getByLabel('Amount')

    await expect(add).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    // The account is chosen first so the merchant is the first problem the button names
    await chooseFromDropdown(dialog, 'Account', account.name)
    await add.click()
    await expect(merchant).toHaveAttribute('aria-invalid', 'true')
    await expect(merchant).toHaveAccessibleDescription('Select or create a merchant')
    await expect(category).toHaveAttribute('aria-invalid', 'true')
    await expect(category).toHaveAccessibleDescription('Select a category')
    await expect(amount).toHaveAttribute('aria-invalid', 'true')
    await expect(amount).toHaveAccessibleDescription('Enter an amount')
    await expect(add).toHaveAttribute('aria-disabled', 'true')
    await expect(add).toHaveAccessibleDescription('Select or create a merchant')
    expect(creations).toBe(0)

    // Each field clears on its own, and the button waits for the last
    await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
    await chooseFromDropdown(dialog, 'Category', 'Groceries')
    await expect(add).toHaveAttribute('aria-disabled', 'true')
    await amount.fill('12.50')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await expect(add).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('leaves the cleared amount unmarked after an add that keeps the Add transaction dialogue open', async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
    const add = dialog.getByTestId('transaction-submit')
    const amount = dialog.getByLabel('Amount')

    await dialog.getByRole('checkbox', { name: /Keep modal open after adding/ }).check()
    await chooseFromDropdown(dialog, 'Account', account.name)
    await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
    await chooseFromDropdown(dialog, 'Category', 'Groceries')
    await amount.fill('12.50')
    await add.click()

    // The next row starts clean: the empty amount is not yet a mistake, and the button is whole
    await expect(amount).toHaveValue('')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(amount).not.toHaveAttribute('aria-invalid', 'true')
    await expect(add).not.toHaveAttribute('aria-disabled', 'true')
  })
})
