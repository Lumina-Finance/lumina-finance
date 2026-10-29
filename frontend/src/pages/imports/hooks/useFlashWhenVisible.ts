import { useEffect, useState } from 'react'
import { IMPORT_FLASH_PAUSE_MS, IMPORT_SETUP_MOTION_MS } from '@/pages/imports/constants'
import { startWhenVisible } from '@/pages/imports/utils/flashWhenVisible'

/**
 * Tells a card when to flash for an arrival: once the setup panel has finished opening and a short
 * pause has passed, counted only while the tab is in view
 *
 * @param flashKey - The arrival to flash for, which flashes again each time it changes, or null for none
 * @returns Whether the flash for the current arrival is playing
 */
export function useFlashWhenVisible(flashKey: number | null): boolean {
  const [playedKey, setPlayedKey] = useState<number | null>(null)

  useEffect(() => {
    if (flashKey === null) return
    return startWhenVisible(document, IMPORT_SETUP_MOTION_MS + IMPORT_FLASH_PAUSE_MS, () => setPlayedKey(flashKey))
  }, [flashKey])

  return flashKey !== null && playedKey === flashKey
}
