/**
 * Running code in a page that is not the app
 *
 * The app's Content Security Policy refuses an image drawn from a `data:` address, so a test that
 * decodes a screenshot to read its pixels does it in a blank page of the same browser
 */

import type { Page } from '@playwright/test'

/**
 * Opens a blank page in the same browser context, runs a step with it and closes it afterwards
 *
 * @param page - Any page of the context to borrow
 * @param use - The step to run with the blank page
 * @returns What the step returned
 */
export async function withBlankPage<Result>(page: Page, use: (blank: Page) => Promise<Result>): Promise<Result> {
  const blank = await page.context().newPage()
  try {
    return await use(blank)
  } finally {
    await blank.close()
  }
}
