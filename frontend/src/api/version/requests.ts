import { fetchFromServer } from '@/api/server';
import type { AppVersionInfo, AppVersionResponse } from '@/api/version/types';

/**
 * Fetches app version metadata and maps release URLs to frontend field names
 *
 * @param timeoutMs - How long to wait for an answer, when it differs from the shared request limit
 */
export async function fetchAppVersion(timeoutMs?: number): Promise<AppVersionInfo> {
  const response = await fetchFromServer('/version', { cache: 'no-store', timeoutMs });
  if (!response.ok) {
    throw new Error(`Failed to load app version (${response.status})`);
  }

  const appVersion = (await response.json()) as AppVersionResponse;
  return {
    version: appVersion.version,
    update: appVersion.update
      ? {
          version: appVersion.update.version,
          releaseUrl: appVersion.update.release_url,
        }
      : null,
  };
}
