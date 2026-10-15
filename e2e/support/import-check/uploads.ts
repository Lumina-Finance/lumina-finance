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
