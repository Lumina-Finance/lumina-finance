/**
 * Reads, from rendered markup, the inline text colour of every element whose whole text is the given
 * text, so a test of an amount's colour reads what the screen draws rather than the helper behind it
 */
export function getColoursOfText(markup: string, text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const elements = markup.matchAll(new RegExp(`<[^>]*style="([^"]*)"[^>]*>${escaped}</`, 'g'))
  return [...elements].map((element) => /(?:^|;)color:([^;]*)/.exec(element[1])?.[1])
}
