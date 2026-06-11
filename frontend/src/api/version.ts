function getBuildValue(value: string | undefined) {
  return value?.trim() ?? '';
}

export const CURRENT_APP_VERSION = getBuildValue(import.meta.env.VITE_APP_VERSION) || '0.0.0';

export const APP_UPDATE_NOTICE = {
  isAvailable: true,
  releaseUrl: 'https://github.com/Lumina-Finance/lumina-finance/releases/latest',
};
