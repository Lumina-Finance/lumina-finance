/**
 * Copies text via a temporary off-screen selection, the only path available outside a secure context
 */
function copyViaSelection(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

/**
 * Copies text to the clipboard and reports whether it succeeded
 *
 * The async Clipboard API is unavailable over plain http on a LAN address, so a secure context falls
 * back to a temporary selection that still works there
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // A denied or unavailable Clipboard API still falls back to the selection path below
    }
  }

  return copyViaSelection(text)
}
