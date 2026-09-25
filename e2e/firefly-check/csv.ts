/**
 * Reads Firefly III's accounts export, which the manifest leaves alone so the check reads the
 * file a person moving over would upload
 */
import type { FireflyAccountFileEntry } from './compare.ts'

// The account types Lumina imports, as the export writes them
const IMPORTED_TYPES = new Set(['asset account', 'loan', 'debt', 'mortgage'])

export function readAccountsFile(text: string): FireflyAccountFileEntry[] {
  const [header, ...records] = parseCsv(text)
  const column = (name: string) => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`The accounts export has no ${name} column`)
    return index
  }
  const [type, name, role, currency, active] = ['type', 'name', 'role', 'currency_code', 'active'].map(column)
  return records
    .filter((record) => IMPORTED_TYPES.has(record[type].toLowerCase()))
    .map((record) => ({
      name: unescapeFormula(record[name]),
      type: record[type],
      role: record[role],
      currency: record[currency],
      active: record[active] === '1',
    }))
}

/**
 * Firefly III's CSV writer puts an apostrophe before a value starting with a character a
 * spreadsheet would read as a formula, and leaves every other value as it was
 */
function unescapeFormula(value: string) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value
}

/** RFC 4180 records, with quoted fields that may hold commas, quotes and line breaks */
function parseCsv(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }
  if (field || record.length) records.push([...record, field])
  return records
}
