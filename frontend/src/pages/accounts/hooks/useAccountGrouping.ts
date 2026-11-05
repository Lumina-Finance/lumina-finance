import { useCallback, useState } from 'react'
import { ACCOUNT_GROUPINGS, DEFAULT_ACCOUNT_GROUPING, type AccountGrouping } from '@/pages/accounts/utils/accountGroups'
import { readStoredValue, writeStoredValue } from '@/utils/browserStorage'

export const ACCOUNT_GROUPING_KEY = 'lumina:settings:accountGrouping'
export const ACCOUNT_THEN_GROUPING_KEY = 'lumina:settings:accountThenGrouping'
export const ACCOUNT_SHOW_LOGOS_KEY = 'lumina:settings:accountShowBankLogos'
export const ACCOUNT_KEEP_EXPANDED_KEY = 'lumina:settings:accountKeepGroupsExpanded'

export const ACCOUNT_TOGGLED_GROUPS_KEY = 'lumina:settings:accountToggledGroups'

function readStoredToggledKeys(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(readStoredValue(ACCOUNT_TOGGLED_GROUPS_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

function readGrouping(key: string): AccountGrouping | null {
  const stored = readStoredValue(key)
  return ACCOUNT_GROUPINGS.find((grouping) => grouping.id === stored)?.id ?? null
}

/**
 * Reads the saved grouping, falling back to the default split when none is saved or the saved value
 * is not one the page offers
 */
export function readStoredAccountGrouping(): AccountGrouping {
  return readGrouping(ACCOUNT_GROUPING_KEY) ?? DEFAULT_ACCOUNT_GROUPING
}

/**
 * Reads the saved second level. It is none unless a different grouping from the first is saved
 */
export function readStoredThenGrouping(): AccountGrouping | null {
  const then = readGrouping(ACCOUNT_THEN_GROUPING_KEY)
  return then === readStoredAccountGrouping() ? null : then
}

// A switch is saved as the word on or off, and anything else takes the switch's default
export function readStoredFlag(key: string, fallback: boolean): boolean {
  const stored = readStoredValue(key)
  return stored === 'on' ? true : stored === 'off' ? false : fallback
}

/**
 * Owns how the accounts page groups its list, up to two levels deep, whether bank logos show and
 * whether every group stays open, saving each choice to this browser's local storage as the user's
 * default. None of it is synced across devices
 */
export function useAccountGrouping() {
  const [grouping, setGroupingState] = useState<AccountGrouping>(readStoredAccountGrouping)
  const [thenBy, setThenByState] = useState<AccountGrouping | null>(readStoredThenGrouping)
  const [showLogos, setShowLogosState] = useState(() => readStoredFlag(ACCOUNT_SHOW_LOGOS_KEY, true))
  const [keepExpanded, setKeepExpandedState] = useState(() => readStoredFlag(ACCOUNT_KEEP_EXPANDED_KEY, true))
  // The groups flipped away from the default of open (switch on) or folded (switch off). With the
  // switch on every visit starts with the top-level groups open, so nothing is restored. With it off the last
  // visit's open and closed groups come back
  const [toggledGroupKeys, setToggledGroupKeys] = useState<ReadonlySet<string>>(() =>
    readStoredFlag(ACCOUNT_KEEP_EXPANDED_KEY, true) ? new Set() : readStoredToggledKeys(),
  )

  // Groups open and close freely during a visit. Only with the switch off is the result remembered.
  // A sub-group's key carries the path of the groups above it
  const toggleGroup = useCallback(
    (key: string) => {
      const next = new Set(toggledGroupKeys)
      if (!next.delete(key)) next.add(key)
      setToggledGroupKeys(next)
      if (!keepExpanded) writeStoredValue(ACCOUNT_TOGGLED_GROUPS_KEY, JSON.stringify([...next]))
    },
    [keepExpanded, toggledGroupKeys],
  )

  const setThenBy = useCallback((next: AccountGrouping | null) => {
    setThenByState(next)
    writeStoredValue(ACCOUNT_THEN_GROUPING_KEY, next ?? 'none')
  }, [])

  // The second level can't repeat the first, so choosing it as the first clears it
  const setGrouping = useCallback(
    (next: AccountGrouping) => {
      setGroupingState(next)
      writeStoredValue(ACCOUNT_GROUPING_KEY, next)
      if (next === thenBy) setThenBy(null)
    },
    [setThenBy, thenBy],
  )

  const setShowLogos = useCallback((next: boolean) => {
    setShowLogosState(next)
    writeStoredValue(ACCOUNT_SHOW_LOGOS_KEY, next ? 'on' : 'off')
  }, [])

  const setKeepExpanded = useCallback((next: boolean) => {
    setKeepExpandedState(next)
    writeStoredValue(ACCOUNT_KEEP_EXPANDED_KEY, next ? 'on' : 'off')
    // The switch sets what every group starts from, so earlier hand changes are dropped
    setToggledGroupKeys(new Set())
    writeStoredValue(ACCOUNT_TOGGLED_GROUPS_KEY, '[]')
  }, [])

  return {
    grouping,
    setGrouping,
    thenBy,
    setThenBy,
    showLogos,
    setShowLogos,
    keepExpanded,
    setKeepExpanded,
    toggledGroupKeys,
    toggleGroup,
  }
}
