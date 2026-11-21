import { useSyncExternalStore } from 'react'
import { CURRENT_APP_VERSION } from '@/api/version/build'

/** What the page tells the user about the server: it is in maintenance, or it runs another version */
export type ServerNotice = 'maintenance' | 'update'

type ServerState = {
  isMaintenance: boolean

  // The release the server last reported in this page load, never one saved by an earlier load,
  // since a reload would otherwise show the prompt again until the first check answered
  serverVersion: string | null
}

let state: ServerState = { isMaintenance: false, serverVersion: null }
const listeners = new Set<() => void>()
const maintenanceListeners = new Set<(isMaintenance: boolean) => void>()

function setState(next: ServerState) {
  if (next.isMaintenance === state.isMaintenance && next.serverVersion === state.serverVersion) return
  const hasMaintenanceChanged = next.isMaintenance !== state.isMaintenance
  state = next
  listeners.forEach((listener) => listener())
  if (hasMaintenanceChanged) maintenanceListeners.forEach((listener) => listener(next.isMaintenance))
}

/** Records the release the server reports, as the change check answers */
export function reportServerVersion(serverVersion: string) {
  setState({ ...state, serverVersion })
}

/**
 * Records whether the server is in maintenance. A request the server accepted clears the flag. A
 * refusal other than the maintenance one keeps the flag as it was
 */
export function reportMaintenance(isMaintenance: boolean) {
  setState({ ...state, isMaintenance })
}

/** Calls `listener` when an answer starts a maintenance or ends one, and returns a function that stops that */
export function subscribeToMaintenance(listener: (isMaintenance: boolean) => void) {
  maintenanceListeners.add(listener)
  return () => {
    maintenanceListeners.delete(listener)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Reads what to tell the user, maintenance first since a page that can't reach a working server has
 * no use for an update. A page built without a release number, as a development build is, or a server
 * that reports none can't be told to be behind, so only two reported releases that differ count as
 * an update
 */
export function getServerNotice(pageVersion: string = CURRENT_APP_VERSION): ServerNotice | null {
  if (state.isMaintenance) return 'maintenance'
  if (state.serverVersion && pageVersion && state.serverVersion !== pageVersion) return 'update'
  return null
}

/** What this page should tell the user about the server now, or null while there is nothing to say */
export function useServerNotice() {
  return useSyncExternalStore(subscribe, () => getServerNotice())
}
