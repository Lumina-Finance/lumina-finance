import { isMaintenanceFailure, useServerNotice } from '@/api/version'

/**
 * Whether a screen's or a card's failure belongs to a server in maintenance, read again whenever a
 * maintenance starts or ends
 */
export function useMaintenanceFailure(error: unknown) {
  return isMaintenanceFailure(error, useServerNotice())
}
