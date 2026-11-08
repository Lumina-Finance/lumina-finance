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
 * The attribute that makes a footer something a message keeps clear of, given only while the modal
 * fills the screen. A footer using this hook is left unmarked in a centred modal, whose footer box
 * reaches the corner by its padding alone, so a message there is not lifted when it covers none of the
 * buttons. The modal form footer does not use it. It marks itself at every width, as it always has
 *
 * @returns Props to spread onto the footer
 */
export function useFooterKeepClear(): { 'data-toast-keep-clear'?: true } {
  return useSyncExternalStore(subscribe, fillsScreen, () => false) ? { 'data-toast-keep-clear': true } : {}
}
