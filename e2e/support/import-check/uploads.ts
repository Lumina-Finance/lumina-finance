/**
 * Records the requests of an import run the import screen sends, with what the server answered each
 */
import type { Page } from '@playwright/test'
import { API_BASE_URL } from '../target'

/** One request of the import run and what the server answered */
export interface CapturedUpload {
  method: string
  path: string
  body: unknown
  response: unknown
}

/**
 * Starts recording every POST and PUT the page sends to the import run, returning the list it fills
 * as the run goes
 */
export function captureUploads(page: Page): CapturedUpload[] {
  const uploads: CapturedUpload[] = []
  page.on('response', async (response) => {
    const path = response.url().slice(API_BASE_URL.length)
    const method = response.request().method()
    if (!['POST', 'PUT'].includes(method) || !path.startsWith('/transactions/import/runs')) return
    uploads.push({ method, path, body: response.request().postDataJSON(), response: await response.json().catch(() => null) })
  })
  return uploads
}

/**
 * Joins the parts the import screen sent a run's budgets in into the one list they make, or null
 * when the import carries no budgets. The parts must follow one another, as the server takes them
 */
export function readBudgetsUpload<Category extends { source: string }, Budget>(uploads: CapturedUpload[]) {
  const parts = uploads
    .filter((upload) => upload.method === 'PUT' && upload.path.endsWith('/budgets'))
    .map((upload) => upload.body as { categories: Category[]; budgets: Budget[]; start_index: number })
    .sort((a, b) => a.start_index - b.start_index)
  if (parts.length === 0) return null

  const budgets: Budget[] = []
  const categories = new Map<string, Category>()
  for (const part of parts) {
    if (part.start_index !== budgets.length) {
      throw new Error(`The screen sent budgets starting at ${part.start_index} after ${budgets.length}`)
    }
    budgets.push(...part.budgets)
    for (const category of part.categories) categories.set(category.source, category)
  }
  return { categories: [...categories.values()], budgets }
}
