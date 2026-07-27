/**
 * Joins class name strings into one, dropping any false or undefined entries so a caller can pass
 * conditional classes inline
 */
export function joinClassNames(...classNames: Array<string | false | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}
