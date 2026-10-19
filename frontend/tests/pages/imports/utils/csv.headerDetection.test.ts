/**
 * Tests whether a file's first row is read as headings or as data, which decides whether that row
 * is staged as a transaction and whether the columns carry the file's own names
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import {
  buildParsedCsv,
  getImportAmountFormatValues,
  inferColumnMap,
  scanImportAmountFormatChoices,
} from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD', 'EUR', 'JPY'])

/**
 * Splits CSV text into the records the parser hands over, which for these fixtures is a split on
 * lines and commas with each cell trimmed
 */
function toRecords(csv: string) {
  return csv
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((cell) => cell.trim()))
}

/**
 * Reads CSV text the way a staged file is built from it
 */
function stage(csv: string) {
  return buildParsedCsv(toRecords(csv), SUPPORTED_CURRENCY_CODES)
}

describe('detecting a header row', () => {
  it('reads a row of terse bank headings as headings, not as a transaction', () => {
    // Every one of these is three letters, and asking the browser whether a code was a currency
    // answered yes to all four, so the row scored as four data cells and was staged as a row
    const parsed = stage(
      'Day,Ref,Amt,Cur\n2026-04-11,INV-1,-12.34,CAD\n2026-04-12,INV-2,-8.00,CAD',
    )

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Day', 'Ref', 'Amt', 'Cur'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ Day: '2026-04-11', Amt: '-12.34', Cur: 'CAD' })
  })

  it('reads a heading row mixing a known alias with terse words as headings', () => {
    // Amt and Ref both counted as currencies under the browser check, so two data-like cells
    // outweighed the one recognized alias and the row was staged as a transaction
    const parsed = stage('Date,Amt,Ref\n2026-04-11,-12.34,INV-1\n2026-04-12,-8.00,INV-2')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Date', 'Amt', 'Ref'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('reads a currency code the app does not support as an ordinary word', () => {
    // A single data-like cell in the first row was enough to rule the whole row out as headings,
    // and all three of these counted as one because the browser accepts any three letters
    const parsed = stage('Day,Ref,ZZZ\n2026-04-11,-12.34,x\n2026-04-12,-8.00,y')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Day', 'Ref', 'ZZZ'])
  })

  it('still reads a first row of real values as data, with columns numbered by position', () => {
    const parsed = stage('2026-04-11,-12.34,CAD\n2026-04-12,-8.00,CAD')

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.headers).toEqual(['Column 1', 'Column 2', 'Column 3'])
    expect(parsed.rows).toHaveLength(2)
  })

  it('still reads a supported code in a row of values as the currency it is', () => {
    const parsed = stage('Chequing,CAD,x\nSavings,CAD,y')

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.headers).toEqual(['Column 1', 'Column 2', 'Column 3'])
  })

  it('keeps a period date and localized amount in the first headerless row', () => {
    const parsed = buildParsedCsv([
      ['31.08.2026', 'CHF100,99'],
      ['01.09.2026', 'CHF200,00'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.rows[0]).toEqual({ 'Column 1': '31.08.2026', 'Column 2': 'CHF100,99' })
  })

  it('keeps names containing numbers as data rather than amount headings', () => {
    const parsed = buildParsedCsv([
      ['Savings 2.0', 'CAD'],
      ['Chequing 3.0', 'CAD'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.rows[0]['Column 1']).toBe('Savings 2.0')
  })

  it('still reads aliases with numerical suffixes as headings', () => {
    const parsed = stage('Date,Reference1,Amount2\n2026-04-11,INV-1,-12.34')

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Date', 'Reference1', 'Amount2'])
  })
})

describe('detecting the header row of a French export', () => {
  const HEADING = ['Date d\'opération', 'Libellé', 'Débit', 'Crédit', 'Solde']
  const PURCHASE = ['05/04/2026', 'CARTE SUPERMARCHE', '12,50', '', '1 234,50']
  const SALARY = ['06/04/2026', 'VIREMENT SALAIRE', '', '2 500,00', '3 734,50']

  it('reads the heading line over decimal-comma rows as the header row', () => {
    const parsed = buildParsedCsv([HEADING, PURCHASE, SALARY], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(HEADING)
    expect(parsed.rows).toHaveLength(2)
  })

  it('still reads the heading line as the header row over a single transaction', () => {
    const parsed = buildParsedCsv([HEADING, PURCHASE], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(HEADING)
    expect(parsed.rows).toHaveLength(1)
  })

  it('keeps a first row that is a transaction as data when no heading line is above it', () => {
    const parsed = buildParsedCsv([PURCHASE, SALARY], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
    expect(parsed.rows).toHaveLength(2)
  })
})

describe('detecting the header row of a German or accented export', () => {
  it('reads a Datum and Verwendungszweck heading line as the header row', () => {
    const parsed = buildParsedCsv([
      ['Datum', 'Verwendungszweck'],
      ['05.04.2026', 'Miete April'],
    ], SUPPORTED_CURRENCY_CODES)

    // The French pair is accented, so it is only the headings when the accent is read as its letter
    const french = buildParsedCsv([
      ['Date d\'opération', 'Libellé'],
      ['05/04/2026', 'CARTE SUPERMARCHE'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Datum', 'Verwendungszweck'])
    expect(french.hasHeaderRow).toBe(true)
  })
})

// Their letters used to count as no text at all, so the heading line was staged as a transaction
describe('detecting the header row of a Japanese, Korean or Chinese export', () => {
  it.each([
    ['SMBC', ['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容', '残高'], ['2026/4/5', '1,200', '', 'カード(1234)', '98,800']],
    ['KB Kookmin Bank', ['거래일시', '적요', '보낸분/받는분', '출금액', '입금액', '잔액'], ['2026.03.01 09:00:00', '체크카드', '스타벅스', '5,000', '', '145,000']],
    ['Yuanta Bank', ['帳號', '帳務日期', '交易日期', '交易時間', '交易說明', '支出金額', '存入金額', '帳面餘額', '票據號碼', '備註'], ['0012345678901234', '20260821', '20260821', '09:10:11', '跨行提款', '1,000', '', '9,000', '', '']],
  ])('reads %s\'s heading line as the header row', (_bank, heading, record) => {
    const parsed = buildParsedCsv([heading, record, record], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(heading)
    expect(parsed.rows).toHaveLength(2)
  })
})

// A line of account details above the table, and rows that each end with a separator, so the heading
// is one cell narrower than its rows and the line is the heading only by its own words. Each heading holds two
// words from the date and description headings of its language, or one beside Datum
describe('finding the heading line of an export in another language under a line above it', () => {
  it.each([
    ['ING Netherlands', ['Datum', 'Naam / Omschrijving', 'Bedrag (EUR)']],
    ['UniCredit', ['Data', 'Descrizione', 'Euro']],
    ['ING Spain', ['F. VALOR', 'DESCRIPCIÓN', 'IMPORTE (€)']],
    ['Nubank', ['Data', 'Valor', 'Descrição']],
    ['SEB', ['Bokföringsdag', 'Text/mottagare', 'Belopp']],
    ['Spar Nord', ['Dato', 'Tekst', 'Beløb']],
    ['DNB', ['Dato', 'Forklaring', 'Ut fra konto']],
    ['OP', ['Kirjauspäivä', 'Saaja/Maksaja', 'Määrä EUROA']],
    ['PKO BP', ['Data operacji', 'Opis transakcji', 'Kwota']],
    ['SMBC', ['年月日', 'お取り扱い内容', '残高']],
    ['KB Kookmin Bank', ['보낸분/받는분', '송금메모', '출금액']],
    ['Yuanta Bank', ['交易說明', '備註', '帳號']],
    ['KB Kookmin Bank, by its date', ['거래일시', '송금메모', '출금액']],
    ['Yuanta Bank, by its date', ['帳務日期', '交易說明', '支出金額']],
    ['Yuanta Bank, by its transaction date', ['交易日期', '交易說明', '支出金額']],
    ['Caixa Geral de Depósitos, by its dates', ['Data mov.', 'Data valor', 'Saldo contab.']],
    ['Caixa Geral de Depósitos, by its money columns', ['Débito', 'Crédito', 'Saldo contab.']],
    ['a file with full-width letters', ['Ｄａｔｕｍ', 'Ｖｅｒｗｅｎｄｕｎｇｓｚｗｅｃｋ', 'Ｂｅｔｒａｇ']],
  ])('finds %s\'s heading line', (_bank, heading) => {
    const record = [...heading.map((_cell, index) => `Value ${index}`), '']

    const parsed = buildParsedCsv(
      [['Account details'], heading, record, record],
      SUPPORTED_CURRENCY_CODES,
      true,
      {},
    )

    // The rows are refused for the separator the heading lacks, as a narrower header always is, but
    // the reading names the heading line as the header row instead of the first transaction
    expect(parsed.reading?.headerRow).toBe(2)
    expect(parsed.error).toContain('values against')
  })
})

describe('a first row of text over one column of amounts', () => {
  it('is the header row, with the amounts guessed as Amount in their own format', () => {
    const parsed = buildParsedCsv([
      ['Vorgang', 'Summe', 'Kennung'],
      ['Kauf', '-12,50', 'REF 2026'],
      ['Erstattung', '1.234,56', '12 EUR'],
    ], SUPPORTED_CURRENCY_CODES)
    const files = [{
      id: 'file-1',
      name: 'Umsaetze.csv',
      size: 1024,
      headers: parsed.headers,
      hasHeaderRow: parsed.hasHeaderRow,
      rows: parsed.rows,
      error: null,
    }]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)
    const { automatic } = scanImportAmountFormatChoices(getImportAmountFormatValues(map, files))

    expect(parsed.hasHeaderRow).toBe(true)
    expect(parsed.headers).toEqual(['Vorgang', 'Summe', 'Kennung'])
    expect(map.amount).toBe('Summe')
    expect(map.tag_ids).not.toBe('Kennung')
    expect(Object.values(map)).not.toContain('Kennung')
    expect(automatic).toEqual({ decimalSeparator: ',', groupingSeparator: '.' })
  })

  it('keeps a first row of text with no heading line as data when it sits over no amount column', () => {
    const parsed = buildParsedCsv([
      ['Kauf', 'Supermarkt'],
      ['Erstattung', 'Bäckerei'],
    ], SUPPORTED_CURRENCY_CODES)

    expect(parsed.hasHeaderRow).toBe(false)
  })
})
