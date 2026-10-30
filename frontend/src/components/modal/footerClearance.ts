import { useSyncExternalStore } from 'react'

// Below 1050px a modal fills the screen with its footer along the bottom edge. From there up it sits in
// the middle with the corner left clear
const FULL_SCREEN_QUERY = '(max-width: 1049.98px)'

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(FULL_SCREEN_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function fillsScreen(): boolean {
  return window.matchMedia(FULL_SCREEN_QUERY).matches
}

/**
 * The attribute that makes a modal's footer something a message keeps clear of, given only while the
 * modal fills the screen. A centred modal's footer box reaches the corner by its padding alone, which
 * would lift a message that covers none of its buttons
 *
 * @returns Props to spread onto the footer
 */
export function useFooterKeepClear(): { 'data-toast-keep-clear'?: true } {
  return useSyncExternalStore(subscribe, fillsScreen, () => false) ?{ 'data-toast-keep-clear': true } : {}
}
