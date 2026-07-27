/**
 * Turns an account type as the backend stores it, words joined by underscores, into spaced words
 * with each one capitalized for display
 */
export function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

