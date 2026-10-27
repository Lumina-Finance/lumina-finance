import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: a link's hover look doesn't change with the screen's width

/**
 * Guards every underlined text link taking the same hover look: no underline at rest, and under the pointer
 * a 1px underline that grows from the middle of the text out to both edges. Anchors, router links and the
 * buttons that read as links used to react differently, some with no hover look at all
 */

type Extent = { left: number; right: number } | null

/** Screenshots the link with room around it, so the drawn underline is in the frame */
async function shoot(page: Page, link: Locator): Promise<Buffer> {
  const box = (await link.boundingBox())!
  return page.screenshot({ clip: { x: box.x - 8, y: box.y - 4, width: box.width + 16, height: box.height + 10 } })
}

/**
 * The first and last pixel that differ from the reference frame in the underline's row, which is where the
 * underline has been drawn. The underline's row is the one with the most changed pixels once the line is
 * whole
 */
async function drawnExtent(page: Page, rest: Buffer, frame: Buffer, row?: number): Promise<{ extent: Extent; row: number }> {
  return page.evaluate(async ({ before, after, wanted }) => {
    const decode = async (base64: string) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height)
    }
    const [a, b] = await Promise.all([decode(before), decode(after)])
    const changedAt = (x: number, y: number) => {
      const i = (y * a.width + x) * 4
      return Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 30
    }
    const counts = Array.from({ length: a.height }, (_, y) => Array.from({ length: a.width }, (_, x) => changedAt(x, y)).filter(Boolean).length)
    const y = wanted ?? counts.indexOf(Math.max(...counts))
    // The first and last changed pixel, since a descender of the same colour crosses the row and hides a few
    const columns = Array.from({ length: a.width }, (_, x) => x).filter((x) => changedAt(x, y))
    const best = columns.length >= 2 ? { left: columns[0], right: columns[columns.length - 1] } : null
    return { extent: best, row: y }
  }, { before: rest.toString('base64'), after: frame.toString('base64'), wanted: row ?? null })
}

/** Holds the link's underline transition at a time, so the frame is the same on every run */
async function holdAt(link: Locator, time: number): Promise<void> {
  await link.evaluate((node, at) => {
    const transition = node.getAnimations().find((animation) => (
      animation instanceof CSSTransition && animation.transitionProperty === 'background-size'
    ))
    if (!transition) throw new Error('the underline is not transitioning')
    transition.pause()
    transition.currentTime = at
  }, time)
}

/** Expects the underline to be absent at rest, to grow from the middle of the text, and to be whole at the end */
async function expectGrowsFromTheMiddle(page: Page, link: Locator): Promise<void> {
  await page.waitForTimeout(600)
  const resting = await shoot(page, link)
  const idle = () => expect.poll(() => link.evaluate((node) => node.getAnimations().length)).toBe(0)

  // The hover colour of the text with no line under it, so a frame differs from it by the line alone. Only
  // the underline transitions from here on, and the text takes its hover colour at once
  await link.evaluate((node) => {
    node.style.setProperty('transition', 'none')
    node.style.setProperty('background-size', '0px 1px', 'important')
  })
  await link.hover()
  await page.waitForTimeout(300)
  const rest = await shoot(page, link)
  await page.mouse.move(0, 0)
  await link.evaluate((node) => {
    node.style.removeProperty('background-size')
    node.style.setProperty('transition', 'background-size 250ms cubic-bezier(0.65, 0, 0.35, 1)')
  })

  // Settled, the underline spans the label, which gives its row and the middle it grows from
  await link.hover()
  await idle()
  const whole = await drawnExtent(page, rest, await shoot(page, link))
  expect(whole.extent, 'a whole underline under the hovered link').not.toBeNull()
  const middle = (whole.extent!.left + whole.extent!.right) / 2
  const full = whole.extent!.right - whole.extent!.left

  const widths: number[] = []
  for (const time of [70, 110, 160]) {
    await page.mouse.move(0, 0)
    await idle()
    await link.hover()
    await holdAt(link, time)
    const { extent } = await drawnExtent(page, rest, await shoot(page, link), whole.row)
    expect(extent, `an underline is drawn ${time}ms in`).not.toBeNull()
    // Centred on the label at every frame, so it grows outward and does not wipe in from one side
    expect(Math.abs((extent!.left + extent!.right) / 2 - middle), `${time}ms ${extent!.left}-${extent!.right}, whole ${whole.extent!.left}-${whole.extent!.right}`).toBeLessThan(3)
    widths.push(extent!.right - extent!.left)
  }
  expect(widths[0]).toBeLessThan(widths[1])
  expect(widths[1]).toBeLessThan(widths[2])
  expect(widths[2]).toBeLessThan(full)
  expect(widths[0], 'it starts well short of the edges').toBeLessThan(full * 0.5)

  // Once the pointer leaves and the line has shrunk back to the middle it is gone
  await page.mouse.move(0, 0)
  await page.waitForTimeout(500)
  expect((await drawnExtent(page, resting, await shoot(page, link), whole.row)).extent, 'it is gone after leaving').toBeNull()
}

async function expectAppearsAtOnce(page: Page, link: Locator): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const durations = await link.evaluate((node) => getComputedStyle(node).transitionDuration.split(/,\s*/))
  expect(durations.every((duration) => duration === '0s')).toBe(true)
  const rest = await shoot(page, link)
  await link.hover()
  const { extent } = await drawnExtent(page, rest, await shoot(page, link))
  expect(extent, 'the whole underline is there on the first frame').not.toBeNull()
  expect(extent!.right - extent!.left).toBeGreaterThan((await link.boundingBox())!.width * 0.8)
}

test.describe('text links', () => {
  test('grow their underline from the middle on the login page\'s forgot password button', async ({ page }) => {
    await page.goto('/login')
    const link = page.getByRole('button', { name: 'Forgot password?', exact: true })
    await expect(link).toBeVisible()
    await expectGrowsFromTheMiddle(page, link)
  })

  test('grow their underline from the middle on the account page\'s back link', async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Link account' })
    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)

    const link = page.getByRole('link', { name: 'Back to accounts', exact: true })
    await expect(link).toBeVisible()
    await expectGrowsFromTheMiddle(page, link)
  })

  test('show the whole underline at once under reduced motion', async ({ page }) => {
    await page.goto('/login')
    const link = page.getByRole('button', { name: 'Forgot password?', exact: true })
    await expect(link).toBeVisible()
    await expectAppearsAtOnce(page, link)
  })
})
