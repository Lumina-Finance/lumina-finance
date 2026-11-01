// The one letter whose lowercase on its own differs between the browser and PostgreSQL. The browser
// writes it as "i" with a combining dot above, and the database as a plain "i"
const DOTTED_CAPITAL_I = 'İ'

/**
 * What a merchant or tag name is matched under, which is the name trimmed with its capitals folded
 *
 * The same rule the commit applies, so the page and the server agree on which names are one record.
 * A file carrying both "Amazon" and "AMAZON" asks about them once and files both under one merchant
 *
 * Folded a letter at a time, as PostgreSQL's lower() is, rather than across the whole name, which
 * would turn a closing capital sigma into the final form the database keeps apart
 */
export function getNameKey(name: string) {
  return Array.from(name.trim(), (letter) => (letter === DOTTED_CAPITAL_I ? 'i' : letter.toLowerCase())).join('')
}
