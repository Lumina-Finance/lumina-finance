export type { AppUpdateNotice, AppUpdateResponse, AppVersionInfo, AppVersionResponse } from '@/api/version/types'

export { CURRENT_APP_VERSION } from '@/api/version/build'
export { fetchAppVersion } from '@/api/version/requests'
export { useAppVersion } from '@/api/version/hooks'
export {
  getServerNotice,
  reportMaintenance,
  reportServerVersion,
  subscribeToMaintenance,
  useServerNotice,
  type ServerNotice,
} from '@/api/version/serverState'
