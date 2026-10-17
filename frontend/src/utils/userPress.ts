import type { MouseEvent } from 'react'

/**
 * Wraps a click action so a password manager cannot drive a second-factor prompt. 1Password and
 * similar submit by calling element.click(), which dispatches an untrusted event, and can pick a
 * button whose label merely mentions logging in, so only a press the browser marks as trusted, from
 * a pointer, the keyboard or a screen reader, runs the action
 */
export const onUserPress = (action: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  if (event.isTrusted) action()
}
