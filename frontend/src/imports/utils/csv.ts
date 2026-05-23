import type { CsvRow, ImportFileDraft } from '../types'

export async function readCsvFile(file: File): Promise<ImportFileDraft> {
  const id = createFileId(file)

  try {
    const text = await file.text()
    const { headers, rows } = parseCsv(text)
    return {
      id,
      name: file.name,
      size: file.size,
      headers,
      rows,
      error: headers.length === 0 ? 'No header row detected' : null,
    }
  } catch {
    return {
      id,
      name: file.name,
      size: file.size,
      headers: [],
      rows: [],
      error: 'Unable to read file',
    }
  }
}

function createFileId(file: File) {
  return `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`
}

function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const delimiter = detectDelimiter(text)
  const records = parseCsvRecords(text, delimiter)
    .map((record) => record.map((cell) => cell.trim()))
    .filter((record) => record.some(Boolean))

  if (records.length === 0) return { headers: [], rows: [] }

  const headers = dedupeHeaders(records[0])
  const rows = records.slice(1).map((record) => {
    const row: CsvRow = {}
    headers.forEach((header, index) => {
      row[header] = record[index] ?? ''
    })
    return row
  })

  return { headers, rows }
}

function parseCsvRecords(text: string, delimiter: string) {
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      row.push(field)
      records.push(row)
      row = []
      field = ''
      if (char === '\r' && nextChar === '\n') index += 1
      continue
    }

    field += char
  }

  if (field || row.length > 0) {
    row.push(field)
    records.push(row)
  }

  return records
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  const candidates = [',', ';', '\t']
  return candidates
    .map((delimiter) => ({ delimiter, count: countDelimiter(firstLine, delimiter) }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ','
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') inQuotes = !inQuotes
    if (char === delimiter && !inQuotes) count += 1
  }

  return count
}

function dedupeHeaders(rawHeaders: string[]) {
  const seen = new Map<string, number>()

  return rawHeaders.map((header, index) => {
    const base = header || `Column ${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} ${count + 1}`
  })
}
