import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Transaction } from '@/api/transactions'
import type { Category } from '@/api/categories'
import { CREATE_ACCOUNT_VALUE, EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows, groupPreviewRowsByDate } from '@/pages/imports/utils/preview'
import { buildTransactionImportPayload } from '@/pages/imports/utils/payload'
import { formatPreviewMoney } from '@/pages/imports/utils/formatPreviewMoney'
import { formatCurrency } from '@/utils/formatCurrency'

const captured = vi.hoisted(() => ({ buttons: [] as { onClick: (event: { shiftKey: boolean }) => void; tabIndex?: number }[] }))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children }: { children: ReactNode }) => {
      const button = (children as ReactElement[]).find((child) => child?.type === 'button')
      if (button) captured.buttons.push(button.props as typeof captured.buttons[number])
      return createElement('div', null, children)
    },
    span: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  },
}))
vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ currencies: CURRENCIES, formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES) }),
}))

import { ImportPreviewList } from '@/pages/imports/components/PreviewList'
import TransactionRow from '@/components/transactions/Row'

const CURRENCIES: Currency[] = [
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', minor_unit_exponent: 3 },
]
const CATEGORY: Category = {
  id: 'category', owner_id: null, group_id: null, name: 'Groceries', kind: 'expense',
  icon: null, is_system: true, created_at: '2024-01-01T00:00:00Z',
}

/** Builds the actual generic preview and payload from the same resolved CSV cells */
function build(currency: string, amounts: string[], category: Category = CATEGORY) {
  const file: ImportFileDraft = {
    id: 'file', name: 'Exact.csv', size: 100, hasHeaderRow: true, headers: ['Date', 'Amount', 'Category'], error: null,
    rows: amounts.map((Amount) => ({ Date: '2024-03-15', Amount, Category: category.name })),
  }
  const shared = {
    files: [file], columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', category_id: 'Category' },
    dateFormat: 'yearFirst' as const, currencies: CURRENCIES, directionAnswers: {},
    accountById: new Map(), accountCreateCurrencies: { file: currency }, accountCreateInstitutions: {},
    categoryById: new Map([[category.id, category]]), categoryCreateKinds: {}, categoryTypesBySource: {},
  }
  const rows = buildImportPreviewRows({
    ...shared, missingRequiredColumnLabels: [], institutionById: new Map(),
    resolvedAccountMappings: { file: CREATE_ACCOUNT_VALUE }, resolvedCategoryMappings: { [category.name]: category.id }, rowProblems: [],
  })
  const payload = buildTransactionImportPayload({
    ...shared, accountCreateTypes: { file: 'checking' }, accountMappings: { file: CREATE_ACCOUNT_VALUE },
    accountSources: [{ id: 'file', label: 'Exact.csv', matchText: 'Exact.csv', isCounterpartyOnly: false }],
    categoryMappings: { [category.name]: category.id }, importedCategories: [category.name], columnValidationErrors: {},
  })
  return { rows, payload }
}

/** Reads all three responsive amount nodes from actual shared row markup */
function amountNodes(markup: string) {
  return Array.from(markup.matchAll(/<span[^>]*data-testid="transaction-amount"[^>]*>(.*?)<\/span>/g), (match) => match[1])
}

describe('exact generic import presentation', () => {
  it.each([
    ['JPY', '9007199254740993', 9007199254740993n, '+¥9,007,199,254,740,993'],
    ['CAD', '90071992547409.93', 9007199254740993n, '+CA$90,071,992,547,409.93'],
    ['IQD', '9007199254740.993', 9007199254740993n, '+IQD\u00a09,007,199,254,740.993'],
    ['JPY', '-9007199254740993', -9007199254740993n, '-¥9,007,199,254,740,993'],
    ['CAD', '-90071992547409.93', -9007199254740993n, '-CA$90,071,992,547,409.93'],
    ['IQD', '-9007199254740.993', -9007199254740993n, '-IQD\u00a09,007,199,254,740.993'],
    ['JPY', '9223372036854775807', 9223372036854775807n, '+¥9,223,372,036,854,775,807'],
    ['CAD', '92233720368547758.07', 9223372036854775807n, '+CA$92,233,720,368,547,758.07'],
    ['IQD', '9223372036854775.807', 9223372036854775807n, '+IQD\u00a09,223,372,036,854,775.807'],
    ['JPY', '-9223372036854775808', -9223372036854775808n, '-¥9,223,372,036,854,775,808'],
    ['CAD', '-92233720368547758.08', -9223372036854775808n, '-CA$92,233,720,368,547,758.08'],
    ['IQD', '-9223372036854775.808', -9223372036854775808n, '-IQD\u00a09,223,372,036,854,775.808'],
  ] as const)('preserves every digit through builder and all responsive nodes: %s %s', (currency, raw, exact, text) => {
    const { rows, payload } = build(currency, [raw])
    expect(rows).toHaveLength(1)
    expect(payload.payload?.rows[0].amount).toBe(raw)
    expect(rows[0].transaction).toMatchObject({ amount: exact, account_amount: exact, base_currency_amount: exact })
    const groups = groupPreviewRowsByDate(rows)
    expect(groups).toHaveLength(1)
    const markup = renderToStaticMarkup(createElement(ImportPreviewList, { groups }))
    expect(amountNodes(markup)).toEqual([text, text, text])
  })

  it.each([
    ['JPY', '9223372036854775808'], ['JPY', '-9223372036854775809'],
    ['CAD', '92233720368547758.08'], ['CAD', '-92233720368547758.09'],
    ['IQD', '9223372036854775.808'], ['IQD', '-9223372036854775.809'],
  ])('still excludes and refuses out-of-range amounts: %s %s', (currency, raw) => {
    const result = build(currency, [raw])
    expect(result.rows).toEqual([])
    expect(result.payload.payload).toBeNull()
  })

  it.each([
    [0n, 'CAD', '+CA$0.00', 0], [-1n, 'CAD', '-CA$0.01', -1],
    [10n, 'IQD', '+IQD\u00a00.010', 1], [1000n, 'IQD', '+IQD\u00a01.000', 1],
  ] as const)('preserves small fractions, padded zeros and sign: %s %s', (amount, currency, text, sign) => {
    expect(formatPreviewMoney(amount, currency, CURRENCIES)).toEqual({ text, sign })
  })

  it('keeps the decimal payload unchanged while preview amounts stay bigint', () => {
    const raw = '90071992547409.93'
    const { rows, payload } = build('CAD', [raw, `-${raw}`])
    expect(rows.map((row) => row.transaction.amount)).toEqual([9007199254740993n, -9007199254740993n])
    expect(payload.payload?.rows.map((row) => row.amount)).toEqual([raw, `-${raw}`])
  })

  it.each([
    ['expense', '1.00', 'var(--app-positive)'], ['income', '-1.00', 'var(--app-negative)'],
    ['expense', '0.00', 'var(--app-text)'],
  ] as const)('uses exact sign for reversal color: %s %s', (kind, raw, color) => {
    const { rows } = build('CAD', [raw], { ...CATEGORY, kind })
    const markup = renderToStaticMarkup(createElement(ImportPreviewList, { groups: groupPreviewRowsByDate(rows) }))
    const spans = Array.from(markup.matchAll(/<span[^>]*data-testid="transaction-amount"[^>]*>/g), (match) => match[0])
    expect(spans).toHaveLength(3)
    expect(spans.every((span) => span.includes(`color:${color}`))).toBe(true)
  })

  it.each([['1.00', 'From outside this app'], ['-1.00', 'To outside this app']])('uses exact sign for transfer direction: %s', (raw, direction) => {
    const { rows } = build('CAD', [raw], { ...CATEGORY, kind: 'transfer' })
    rows[0].transaction.counterparty_account_scope = 'outside'
    const markup = renderToStaticMarkup(createElement(ImportPreviewList, { groups: groupPreviewRowsByDate(rows) }))
    expect(markup).toContain(direction)
  })

  it('retains the numeric Firefly presentation branch', () => {
    const { rows } = build('CAD', ['-12.34'])
    const numeric: Transaction = { ...rows[0].transaction, amount: -1234, account_amount: -1234, base_currency_amount: -1234 }
    const markup = renderToStaticMarkup(createElement(ImportPreviewList, { groups: [{ dateLabel: rows[0].dateLabel, rows: [{ ...rows[0], transaction: numeric }] }] }))
    expect(amountNodes(markup)).toEqual(['-CA$12.34', '-CA$12.34', '-CA$12.34'])
  })

  it('preserves the ordinary ledger callback and selection routing', () => {
    const { rows } = build('CAD', ['-12.34'])
    const transaction: Transaction = { ...rows[0].transaction, amount: -1234, account_amount: -1234, base_currency_amount: -1234 }
    const onOpen = vi.fn()
    captured.buttons = []
    renderToStaticMarkup(createElement(TransactionRow, { transaction, currency: 'CAD', category: CATEGORY, onOpen }))
    captured.buttons.at(-1)!.onClick({ shiftKey: false })
    expect(onOpen).toHaveBeenCalledWith(transaction)
    expect(onOpen.mock.calls[0][0]).toBe(transaction)
    const onToggle = vi.fn()
    renderToStaticMarkup(createElement(TransactionRow, {
      transaction, currency: 'CAD', category: CATEGORY, onOpen,
      selection: { mark: 'selected', isSelectable: true, onToggle, onPointerEnter: () => {} },
    }))
    const selected = captured.buttons.at(-1)!
    expect(selected.tabIndex).toBe(-1)
    selected.onClick({ shiftKey: true })
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
