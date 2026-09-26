const DELIMITER = ','
const ENCLOSURE = '"'
const NEWLINE = '\n'

// Firefly III writes through league/csv with a backslash as PHP's escape character
const ESCAPE = '\\'

// PHP quotes a value holding any of these, so an unquoted value holding one was not written by it
const CHARACTERS_PHP_ALWAYS_QUOTES = /[",\\ \t\n\r]/

// How many times over the reader may go through the text while it tries the readings of ambiguous
// quotes. A reading PHP could not have written fails within a few characters of the quote it
// tried, so a file Firefly wrote is read in little more than one pass however many such quotes it
// holds, and only text written some other way runs out, which the general parser then reads
const MAX_PASSES_OVER_TEXT = 8

// Firefly's exports name 53 columns at most. A header wider than this, or narrower than two, is not a
// Firefly export as written, and bounding the width keeps reading one row cheap
const MIN_COLUMNS = 2
const MAX_COLUMNS = 256

/** Where the row just read ends, with the next row starting one character later */
interface RecordReading {
  next: number
}

/** How rows are read: the widths a row may take and how many characters are left to read */
interface ReadingRules {
  widths: number[] | null
  remainingCharacters: number
}

/**
 * Reads a Firefly III export into rows of raw values, following the quoting PHP writes rather than
 * the doubled quotes a standard reader expects, or returns null for text PHP did not write
 *
 * PHP never doubles a quote that follows a backslash, so `Joe said \"hi\"` is written as
 * `"Joe said \"hi\""`, which a standard reader takes as an escaped quote and runs the value on into
 * the columns after it. Read the way PHP wrote it, a quote after a backslash is part of the value and
 * both characters are kept, since PHP keeps them when it reads the file back.
 *
 * One shape stays ambiguous: a value ending in a backslash is written with its closing quote straight
 * after the backslash, which looks the same as a quote inside the value followed by a comma or a
 * line end. Each such quote is tried closed and then kept, and a reading survives only if the rest of
 * the row keeps to how PHP writes: a value holding a space, quote, backslash, comma or line break is
 * quoted, an empty value is not, a quote inside a quoted value is doubled unless a backslash precedes
 * it, and nothing follows a closing quote but a comma or a line end. A data row must also carry as
 * many values as the header names, or one fewer, which is what the transactions export writes
 *
 * @param text - The file with every line ending already written as a newline
 * @returns Every row, header first, or null when some row cannot be read as PHP writes, which is what
 *   a Firefly export saved again by a spreadsheet looks like
 */
export function readFireflyCsvRecords(text: string): string[][] | null {
  const records: string[][] = []
  const rules: ReadingRules = { widths: null, remainingCharacters: text.length * MAX_PASSES_OVER_TEXT }
  let position = 0

  while (position < text.length) {
    if (text[position] === NEWLINE) {
      position += 1
      continue
    }

    const fields: string[] = []
    const reading = readValues(text, position, fields, rules)
    if (!reading || fields.length < MIN_COLUMNS) return null

    records.push(fields)
    rules.widths ??= [fields.length, fields.length - 1]
    position = reading.next
  }

  return records
}

/**
 * Reads the rest of a row from the start of a value into its fields, trying each reading of an
 * ambiguous quote as it is met and backing out of one the rest of the row refuses
 *
 * The fields hold the row's values once it is read. A reading that fails leaves them as it found them
 */
function readValues(
  text: string,
  start: number,
  fields: string[],
  rules: ReadingRules,
): RecordReading | null {
  const widest = rules.widths ? Math.max(...rules.widths) : MAX_COLUMNS
  if (fields.length >= widest) return null
  if (text[start] === ENCLOSURE) return readQuotedValue(text, start + 1, fields, rules)

  let end = start
  while (end < text.length && text[end] !== DELIMITER && text[end] !== NEWLINE) end += 1

  rules.remainingCharacters -= end - start + 1
  if (rules.remainingCharacters < 0) return null

  const value = text.slice(start, end)
  if (CHARACTERS_PHP_ALWAYS_QUOTES.test(value)) return null
  return readAfterValue(text, end, value, fields, rules)
}

/**
 * Reads a quoted value from just past its opening quote, then the rest of the row
 */
function readQuotedValue(
  text: string,
  start: number,
  fields: string[],
  rules: ReadingRules,
): RecordReading | null {
  // The value is cut from the text a run at a time rather than built a character at a time, which
  // holds a long note in a fraction of the memory
  let value = ''
  let runStart = start
  let isEscaped = false
  let position = start

  while (position < text.length) {
    rules.remainingCharacters -= 1
    if (rules.remainingCharacters < 0) return null

    const character = text[position]
    if (character !== ENCLOSURE) {
      isEscaped = character === ESCAPE
      position += 1
      continue
    }

    value += text.slice(runStart, position)
    const following = text[position + 1]
    const canClose = following === undefined || following === DELIMITER || following === NEWLINE

    if (isEscaped) {
      // Closed here, the value ended in a backslash. Kept, the quote belongs to the value and starts
      // the next run
      if (canClose) {
        const closed = readAfterValue(text, position + 1, value, fields, rules)
        if (closed) return closed
      }
      isEscaped = false
      runStart = position
      position += 1
      continue
    }

    if (following === ENCLOSURE) {
      value += ENCLOSURE
      position += 2
      runStart = position
      continue
    }

    // PHP leaves an empty value unquoted
    if (!canClose || value === '') return null
    return readAfterValue(text, position + 1, value, fields, rules)
  }

  return null
}

/**
 * Adds a value to the row and carries on: another value after a comma, or the end of the row
 */
function readAfterValue(
  text: string,
  position: number,
  value: string,
  fields: string[],
  rules: ReadingRules,
): RecordReading | null {
  fields.push(value)

  let reading: RecordReading | null
  if (text[position] === DELIMITER) {
    reading = readValues(text, position + 1, fields, rules)
  } else {
    reading = rules.widths && !rules.widths.includes(fields.length) ? null : { next: position + 1 }
  }

  if (!reading) fields.pop()
  return reading
}
