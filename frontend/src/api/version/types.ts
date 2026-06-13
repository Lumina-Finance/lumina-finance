export interface AppUpdateResponse {
  version: string;
  release_url: string;
}

export interface AppVersionResponse {
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
