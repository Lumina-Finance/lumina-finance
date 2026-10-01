/**
 * Reads an import summary with ordinary spaces, for tests about its wording rather than where its
 * lines may break
 */
export function withPlainSpaces(summary: string) {
  return summary.replaceAll(' ', ' ')
}
