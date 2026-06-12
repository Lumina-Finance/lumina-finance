import { API_BASE } from './config';

function getBuildValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export const CURRENT_APP_VERSION = getBuildValue(import.meta.env.VITE_APP_VERSION) || '0.0.0';

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
