/**
 * Reads, from rendered markup, the inline text colour of every element whose whole text is the given
 * text, so a test of an amount's colour reads what the screen draws. React's separators between
 * adjacent text pieces are removed first, so a label and an amount read as one text
 */
export function getColoursOfText(markup: string, text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...markup.replaceAll('<!-- -->', '').matchAll(new RegExp(`<[^>]*style="([^"]*)"[^>]*>${escaped}</`, 'g'))]
    .map((element) => /(?:^|;)color:([^;]*)/.exec(element[1])?.[1])
}
