import { requireAppReachable } from './target'

/**
 * Confirm something is serving before the first spec opens a browser.
 */
export default async function globalSetup(): Promise<void> {
  await requireAppReachable()
}
