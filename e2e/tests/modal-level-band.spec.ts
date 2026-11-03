import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, with each size set here: the sizes are what the check is for. Below 1050px wide a modal
// fills the screen and shows its level as a slim strip across its top. From there up it shows its full rail down
// the left edge. Either way it has exactly one marker, never a strip with a band beside it

const SIDE_RAIL_FROM_PX = 1050

const STRIP_HEIGHT_PX = 32
const SETTLE_MS = 5_000
const MIN_TEXT_CONTRAST = 4.5

type Theme = 'light' | 'dark'

interface RailReading {
  ariaHidden: string | null
  display: string
  background: string
  textColour: string
  borderBottomWidth: number
  borderBottomColour: string
  borderRightWidth: number
  left: number
  width: number
  height: number
  panelWidth: number
  contentLeft: number
  contentWidth: number
  iconWidth: number
  labelFontSize: number
  labelTransform: string
  labelWritingMode: string
  labelText: string
  iconLeft: number
  iconCentreY: number
  labelCentreY: number
}

/** The rail of a modal, its first child, with the colours and edges it is drawn in */
async function readRail(dialog: Locator): Promise<RailReading> {
  return dialog.evaluate((panel) => {
    const rail = panel.firstElementChild!
    const style = getComputedStyle(rail)
    const box = rail.getBoundingClientRect()
    const panelBox = panel.getBoundingClientRect()
    const content = panel.children[1].getBoundingClientRect()
    const icon = rail.querySelector('svg')?.getBoundingClientRect()
    const label = rail.querySelector('span')
    const labelStyle = label ? getComputedStyle(label) : null
    return {
      ariaHidden: rail.getAttribute('aria-hidden'),
      display: style.display,
      background: style.backgroundColor,
      textColour: style.color,
      borderBottomWidth: parseFloat(style.borderBottomWidth),
      borderBottomColour: style.borderBottomColor,
      borderRightWidth: parseFloat(style.borderRightWidth),
      left: box.left,
      width: box.width,
      height: box.height,
      panelWidth: panelBox.width,
      contentLeft: content.left,
      contentWidth: content.width,
      iconWidth: icon?.width ?? 0,
      labelFontSize: labelStyle ? parseFloat(labelStyle.fontSize) : 0,
      labelTransform: labelStyle?.textTransform ?? '',
      labelWritingMode: labelStyle?.writingMode ?? '',
      labelText: label?.textContent ?? '',
      iconLeft: icon?.left ?? 0,
      iconCentreY: icon ? icon.top + icon.height / 2 - panelBox.top : 0,
      labelCentreY: label ? label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2 - panelBox.top : 0,
    }
  })
}

/** Waits for the panel to finish scaling in, then reads its rail */
async function settledRail(dialog: Locator): Promise<RailReading> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await readRail(dialog))
        const still = now === last
        last = now
        return still
      },
      { timeout: SETTLE_MS, intervals: [100] },
    )
    .toBe(true)
  return readRail(dialog)
}

/** The colour a theme token resolves to, read the way the rail's own style resolves it */
async function colourOf(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  }, token)
}

/** The colour a theme token gives text, read the way the rail's own style resolves it */
async function textColourOf(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)
}

function channels(colour: string): number[] {
  return colour.match(/[\d.]+/g)!.slice(0, 3).map(Number)
}

function luminance(colour: string): number {
  const [r, g, b] = channels(colour).map((value) => {
    const unit = value / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

async function openAt(page: Page, url: string, size: { width: number; height: number }, theme: Theme): Promise<void> {
  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: theme })
  await openPage(page, url)
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** Opens Add account, then Add institution over it, and reads both rails */
async function readAddAccountRails(page: Page): Promise<{ primary: RailReading; stacked: RailReading }> {
  await page.getByRole('button', { name: /^Add account/ }).first().click()
  const primary = page.getByRole('dialog', { name: 'Add account', exact: true })
  const primaryRail = await settledRail(primary)

  await primary.getByRole('combobox', { name: 'Institution', exact: true }).click()
  await primary.getByRole('button', { name: 'Create institution', exact: true }).click()
  const stacked = page.getByRole('dialog', { name: 'Add institution' })
  const stackedRail = await settledRail(stacked)

  await page.keyboard.press('Escape')
  await expect(stacked).toBeHidden()
  await primary.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(primary).toBeHidden()
  return { primary: primaryRail, stacked: stackedRail }
}

async function readEditAccountRail(page: Page, accountId: string): Promise<RailReading> {
  await openPage(page, `/accounts/${accountId}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const rail = await settledRail(edit)
  await page.keyboard.press('Escape')
  await expect(edit).toBeHidden()
  return rail
}

/** A step-up check: regenerating recovery codes asks for the password in a modal of its own. The status and
 *  the codes are stood in for, so the account needs no real factor */
async function readStepUpRail(page: Page): Promise<RailReading> {
  await page.route(`${API_BASE_URL}/auth/2fa/status`, (route) => route.fulfill({ json: { totp_enabled: true } }))
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Regenerate recovery codes' })
  await expect(stepUp.getByLabel('Current password')).toBeVisible()
  return settledRail(stepUp)
}

/** What every strip shares: hidden from screen readers, as tall as asked and across the full width, with the
 *  content below it taking the whole width and no band down the left edge */
function expectStrip(rail: RailReading, label: string, fontSize: number): void {
  expect(rail.ariaHidden).toBe('true')
  expect(rail.display).toBe('flex')
  // 32px tall above the hairline, which a stacked strip draws below it
  expect(rail.height).toBe(STRIP_HEIGHT_PX + rail.borderBottomWidth)
  // Icon and label centred in the 32px, so the pale strip's hairline does not push them off the bronze one's line
  expect(rail.iconCentreY).toBeCloseTo(STRIP_HEIGHT_PX / 2, 0)
  expect(rail.labelCentreY).toBeCloseTo(STRIP_HEIGHT_PX / 2, 0)
  expect(rail.left).toBe(0)
  expect(rail.width).toBe(rail.panelWidth)
  // No band: the content starts at the screen's edge and fills the width
  expect(rail.contentLeft).toBe(0)
  expect(rail.contentWidth).toBe(rail.panelWidth)
  expect(rail.borderRightWidth).toBe(0)
  expect(rail.iconWidth).toBe(16)
  expect(rail.labelText).toBe(label)
  expect(rail.labelTransform).toBe('uppercase')
  expect(rail.labelFontSize).toBe(fontSize)
  expect(rail.labelWritingMode).toBe('horizontal-tb')
}

/** What the full rail of a modal is from 1050px wide, the page level's bronze and the stacked level's soft surface */
function expectSideRail(rail: RailReading, kind: 'page' | 'stacked', colours: { bronze: string; soft: string }): void {
  expect(rail.ariaHidden).toBe('true')
  expect(rail.display).toBe('flex')
  expect(rail.labelWritingMode).toBe('vertical-rl')
  expect(rail.borderBottomWidth).toBe(0)
  // The content starts where the rail ends, so there is exactly one marker and no second band
  expect(rail.contentLeft).toBeCloseTo(rail.left + rail.width, 0)
  if (kind === 'page') {
    expect(rail).toMatchObject({ width: 64, background: colours.bronze })
    expect(rail.iconWidth).toBe(20)
  } else {
    expect(rail).toMatchObject({ width: 48, background: colours.soft, borderRightWidth: 1 })
    expect(rail.iconWidth).toBe(18)
  }
}

// Below 1050px wide a modal fills the screen and shows its level as a strip across its top. From 1050px up it
// shows the full rail down its left edge. Either way a modal has exactly one marker. 1049 is the width just
// under the rail
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '390x667', width: 390, height: 667 },
  { name: '768', width: 768, height: 1024 },
  { name: '1049', width: 1049, height: 800 },
  { name: '1280', width: 1280, height: 800 },
]

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`marks each modal's level once at ${size.name} wide in the ${theme} theme`, async ({ page, request }) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)

      await openAt(page, '/accounts', size, theme)
      const { primary, stacked } = await readAddAccountRails(page)
      const edit = await readEditAccountRail(page, account.id)
      await page.setViewportSize(size)
      const stepUp = await readStepUpRail(page)

      const bronze = await colourOf(page, '--app-button-primary-bg')
      const onBronze = await colourOf(page, '--app-button-primary-text')
      const soft = await colourOf(page, '--app-surface-soft')
      const accent = await textColourOf(page, '--app-accent')
      const hairline = await textColourOf(page, '--app-border')

      if (size.width >= SIDE_RAIL_FROM_PX) {
        expectSideRail(primary, 'page', { bronze, soft })
        for (const rail of [stacked, edit, stepUp]) expectSideRail(rail, 'stacked', { bronze, soft })
        expect(edit.labelText).toBe('Edit')
        return
      }

      // The label keeps the size of its desktop rail: 12px for the page level, 11px for the stacked one
      expectStrip(primary, 'Account', 12)
      expectStrip(stacked, 'New', 11)
      expectStrip(edit, 'Edit', 11)
      expectStrip(stepUp, 'Verify', 11)

      // Opened from the page: the bronze of the desktop rail, with the content on it in the button text colour
      expect(primary.background).toBe(bronze)
      expect(primary.textColour).toBe(onBronze)
      expect(primary.borderBottomWidth).toBe(0)

      // Opened over another: the colours of the desktop stacked rail, the soft surface with the icon and label in
      // the accent and a 1px hairline under it
      // (the step-up check opens over the security settings' own modal, so it is of this level)
      for (const strip of [stacked, edit, stepUp]) {
        expect(strip.background).toBe(soft)
        expect(strip.textColour).toBe(accent)
        expect(strip.borderBottomWidth).toBe(1)
        expect(strip.borderBottomColour).toBe(hairline)
        expect(contrast(strip.textColour, strip.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
      }
      expect(contrast(onBronze, bronze)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)

      // The icon starts where the content's own padding does: 1rem for a titled form modal, 1.5rem for a content one
      for (const strip of [primary, stacked, edit]) expect(strip.iconLeft).toBe(16)
      expect(stepUp.iconLeft).toBe(24)
    })
  }
}
