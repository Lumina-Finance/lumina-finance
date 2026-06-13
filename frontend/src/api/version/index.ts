export type {
  AppUpdateNotice,
  AppUpdateResponse,
  AppVersionInfo,
  AppVersionResponse,
} from '@/api/version/types';

function getBuildValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export const CURRENT_APP_VERSION = getBuildValue(import.meta.env.VITE_APP_VERSION);

export { fetchAppVersion } from '@/api/version/requests';
export { useAppVersion } from '@/api/version/hooks';
