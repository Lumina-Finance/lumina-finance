/** Builds the QIF files and transactions the tests read */
import type { OfxFile, OfxStatement, OfxTransaction } from '@/pages/imports/ofx/types'

export function toQifFile(contents: string | Uint8Array, name = 'export.qif') {
  return new File([contents as BlobPart], name)
}

/** A transaction as the reader leaves it, with the text of its date and amount and nothing resolved */
export function buildQifTransaction(overrides: Partial<OfxTransaction> = {}): OfxTransaction {
  return {
    index: 1,
    fileId: 'file-1',
    fileOrder: 1,
    fileName: 'export.qif',
    bankAccountKey: '',
    bankTransactionId: null,
    postedText: '1/2/2024',
    date: null,
    amountText: '10.00',
    amount: null,
    payee: null,
    memo: null,
    otherCurrency: null,
    alternateAmountText: null,
    splitAmountTexts: [],
    ...overrides,
  }
}

export function buildQifFile(transactions: Partial<OfxTransaction>[]): OfxFile {
  const statement: OfxStatement = {
    id: 'qif:Chequing',
    kind: 'bank',
    name: 'Chequing',
    label: 'Chequing',
    proposedType: 'checking',
    currency: null,
    transactions: transactions.map((overrides, position) => buildQifTransaction({ index: position + 1, ...overrides })),
  }
  return { statements: [statement], leftOut: { investment: 0 } }
}
