import { useQuery } from '@tanstack/react-query';
import { API_BASE } from './config';
import { appVersionKeys } from './queryKeys';

function getBuildValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export const CURRENT_APP_VERSION = getBuildValue(import.meta.env.VITE_APP_VERSION);

interface AppUpdateResponse {
  version: string;
  release_url: string;
}

interface AppVersionResponse {
  version: string;
  update: AppUpdateResponse | null;
}

export interface AppUpdateNotice {
  version: string;
  releaseUrl: string;
}

export interface AppVersionInfo {
  version: string;
  update: AppUpdateNotice | null;
}

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

/**
 * Polls the backend version endpoint for app update notices
 */
export function useAppVersion() {
  return useQuery({
    queryKey: appVersionKeys.version(),
    queryFn: fetchAppVersion,
    staleTime: 15 * 60 * 1000,
    gcTime: Infinity,
  });
}
