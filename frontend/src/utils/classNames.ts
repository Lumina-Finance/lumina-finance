export function joinClassNames(...classNames: Array<string | false | undefined>): string {
  return classNames.filter(Boolean).join(' ')
}
