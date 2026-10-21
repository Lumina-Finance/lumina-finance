/**
 * Turns an account type as the backend stores it, words joined by underscores, into spaced words
 * in sentence case for display
 */
export function humanizeAccountType(type: string): string {
  const words = type.split('_').join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

