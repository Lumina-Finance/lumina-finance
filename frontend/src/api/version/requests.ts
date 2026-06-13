import { API_BASE } from '@/api/config';
import type { AppVersionInfo, AppVersionResponse } from '@/api/version/types';

/**
 * Fetches app version metadata and maps release URLs to frontend field names
 */
export async function fetchAppVersion(): Promise<AppVersionInfo> {
  const response = await fetch(`${API_BASE}/version`, { cache: 'no-store' });
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
