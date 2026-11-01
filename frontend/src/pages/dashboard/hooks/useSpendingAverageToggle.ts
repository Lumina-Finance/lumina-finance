import { useCallback, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'
import {
  getStateAfterClick,
  getStateAfterLongPress,
  type SpendingAverageToggleState,
} from '@/pages/dashboard/utils/spendingAverageToggle'

const KEPT_KEY_PREFIX = 'lumina:dashboard:spending-average-kept:'
const KEPT_VALUE = 'on'

/**
 * Holds the spending comparison's average toggle. Kept in this browser's storage under the signed-in
 * user's id, since other people use the same browser, it starts the next visit already on
 */
export function useSpendingAverageToggle() {
  const { user } = useAuth()
  const storageKey = `${KEPT_KEY_PREFIX}${user?.id ?? ''}`
  const [state, setState] = useState<SpendingAverageToggleState>(() => {
    const kept = readStoredValue(storageKey) === KEPT_VALUE
    return { on: kept, kept }
  })

  const click = useCallback(() => setState(getStateAfterClick), [])

  const longPress = useCallback(() => {
    const keeping = !state.kept
    let canKeep = true
    if (keeping) canKeep = writeStoredValue(storageKey, KEPT_VALUE)
    else removeStoredValue(storageKey)
    setState((current) => getStateAfterLongPress(current, canKeep))
  }, [state.kept, storageKey])

  return { ...state, click, longPress }
}
