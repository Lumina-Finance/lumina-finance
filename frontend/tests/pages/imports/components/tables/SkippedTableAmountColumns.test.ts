/**
 * Tests each import screen that lists rows or budgets it leaves out, so the columns it names as amounts
 * line up on the right in tabular figures while its other columns stay on the left. Kept together
 * beside the tables they render, since each screen only has to name its amount columns
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActualSkippedRowsTable } from '@/pages/imports/actual/components/ActualSkippedRowsTable'
import { ActualBudgetImportStep } from '@/pages/imports/actual/sections/ActualBudgetImportStep'
import type { ActualBudgetFile } from '@/pages/imports/actual/types'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { FireflyBudgetImportStep } from '@/pages/imports/firefly/sections/FireflyBudgetImportStep'
import { FireflyPreviewStep } from '@/pages/imports/firefly/sections/FireflyPreviewStep'
import { ImportPreviewStep } from '@/pages/imports/sections'
import type { ColumnMap, ImportRowProblem } from '@/pages/imports/types'
import { expectAmountColumns } from './fixtures'

const CSV_HEADERS = ['Date', 'Amount', 'Money Out', 'Money In', 'Notes']

const CSV_SKIPPED: ImportRowProblem = {
  id: 'file-1-0',
  rowNumber: 2,
  cells: { 'Date': 'someday', 'Amount': '-42.50', 'Money Out': '42.50', 'Money In': '7.00', 'Notes': 'Lunch' },
  reason: 'The date is not one we can read.',
}

const CSV_WORTH_A_LOOK: ImportRowProblem = {
  id: 'file-1-1',
  rowNumber: 3,
  cells: { 'Date': '2024-03-16', 'Amount': '1,234.00', 'Money Out': '1,234.00', 'Money In': '9.00', 'Notes': 'Rent' },
  reason: 'This amount is much larger than the others.',
}

/**
 * Renders the CSV import's Preview and Commit step for a file with one row left out and one worth a
 * look, mapped as given
 */
function renderCsvPreview(columnMap: ColumnMap) {
  return renderToStaticMarkup(createElement(ImportPreviewStep, {
    files: [],
    previewGroups: [],
    importStats: { rowCount: 2, transactionEstimate: 1, newAccountCount: 0, newCategoryCount: 0 },
    importBuild: { errors: [], warnings: [], rowProblems: [CSV_SKIPPED], rowWarnings: [CSV_WORTH_A_LOOK], payload: null },
    headers: CSV_HEADERS,
    columnMap,
    importError: null,
    handleCommitImport: async () => undefined,
    canCommitImport: false,
    importResult: null,
    completedImport: null,
  }))
}

describe('the CSV import\'s Preview and Commit step', () => {
  it('right-aligns the column mapped to Amount in both tables', () => {
    const markup = renderCsvPreview({ ...EMPTY_COLUMN_MAP, dt: 'Date', amount: 'Amount', notes: 'Notes' })

    expectAmountColumns(markup, {
      headers: ['Amount'],
      values: ['-42.50', '1,234.00'],
      others: ['Date', 'Money Out', 'Money In', 'someday', 'Notes', 'Lunch'],
    })
  })

  it('right-aligns both the money out and money in columns', () => {
    const markup = renderCsvPreview({ ...EMPTY_COLUMN_MAP, dt: 'Date', amount_out: 'Money Out', amount_in: 'Money In' })

    expectAmountColumns(markup, {
      headers: ['Money Out', 'Money In'],
      values: ['42.50', '7.00', '9.00'],
      others: ['Amount', '-42.50', 'Date', 'Notes'],
    })
  })

  it('right-aligns nothing where no column is mapped to an amount', () => {
    const markup = renderCsvPreview({ ...EMPTY_COLUMN_MAP, dt: 'Date' })

    expect(markup).toContain('>-42.50<')
    expect(markup).not.toContain('text-right')
  })
})

describe('the Firefly III import', () => {
  it('right-aligns the amount and foreign amount columns in both of the preview\'s tables', () => {
    const markup = renderToStaticMarkup(createElement(FireflyPreviewStep, {
      importEstimate: { rowCount: 2, transactionEstimate: 1, skippedRows: [], rowWarnings: [] },
      previewGroups: [],
      predictedSkippedRows: [{
        id: 'file-1-0',
        journalId: '7',
        rowNumber: 2,
        cells: { journal_id: '7', date: 'someday', amount: '-42.50', foreign_amount: '-30.10', description: 'Lunch' },
        reason: 'The date is not one we can read.',
      }],
      predictedRowWarnings: [{
        id: 'file-1-1',
        rowNumber: 3,
        cells: { journal_id: '8', date: '2024-03-16', amount: '1,234.00', foreign_amount: '', description: 'Rent' },
        reason: 'This amount is much larger than the others.',
      }],
      completedImport: null,
      fireflyHeaders: ['journal_id', 'date', 'amount', 'foreign_amount', 'description'],
      newAccountCount: 0,
      newCategoryCount: 0,
      budgetsFile: null,
      importBuild: {
        errors: [],
        payload: null,
        writtenSources: { accounts: new Set<string>(), categories: new Set<string>() },
        archiveAccountSources: [],
      },
      importError: null,
      importResult: null,
      canCommitImport: false,
      handleCommitImport: async () => undefined,
    }))

    expectAmountColumns(markup, {
      headers: ['amount', 'foreign_amount'],
      values: ['-42.50', '-30.10', '1,234.00'],
      others: ['date', 'description', 'someday', 'Lunch'],
    })
  })

  it('right-aligns a skipped budget\'s Latest Amount', () => {
    const markup = renderToStaticMarkup(createElement(FireflyBudgetImportStep, {
      importResult: null,
      budgetsFile: { id: 'budgets', name: 'budgets.csv', size: 256, headers: [], hasHeaderRow: true, rows: [], error: null },
      budgetDrafts: [{
        name: 'Groceries',
        amount: '$450.00',
        currencyCode: 'CAD',
        currencyCodes: ['CAD', 'USD'],
        isArchived: false,
        limits: [],
        firstPeriodStart: '2024-01-01',
        lastPeriodEnd: '2024-03-31',
        recurrence: null,
        periodLabel: 'Monthly',
        categoryNames: [],
        disabledReason: 'Its limits are in more than one currency.',
      }],
      selectedBudgetNames: new Set<string>(),
      toggleBudgetSelection: () => undefined,
      setBudgetsSelected: () => undefined,
      importedBudgetNames: new Set<string>(),
      budgetSelectionError: null,
      budgetCountingNotes: [],
      importOverlayOpen: false,
    }))

    expectAmountColumns(markup, { headers: ['Latest Amount'], values: ['$450.00'], others: ['Status', 'Active', 'Cadence', 'Monthly'] })
  })
})

// Only its decimal places shape what these tables show
const ACTUAL_BUDGET: ActualBudgetFile = {
  budgetName: 'Hand written',
  databaseVersion: null,
  budgetType: 'envelope',
  currencyCode: null,
  budgetDecimals: 2,
  accounts: [],
  payees: [],
  categories: [{ id: 'car', name: 'Car', groupName: 'Bills', isIncome: false, hidden: false }],
  transactions: [],
  budgetFigures: [],
}

describe('the Actual Budget import', () => {
  it('right-aligns a skipped transaction\'s Amount', () => {
    const markup = renderToStaticMarkup(createElement(ActualSkippedRowsTable, {
      title: '1 transaction skipped',
      decimals: ACTUAL_BUDGET.budgetDecimals,
      rows: [{
        transactionId: 'tx-1',
        date: '2024-03-15',
        accountName: 'Chequing',
        amount: -4250,
        merchantName: 'Corner Market',
        categoryName: null,
        notes: 'Lunch',
        reason: 'Its account is not imported.',
      }],
    }))

    expectAmountColumns(markup, { headers: ['Amount'], values: ['-42.50'], others: ['Account', 'Chequing', 'Merchant', 'Corner Market'] })
  })

  it('right-aligns a skipped budget\'s Latest Amount', () => {
    const markup = renderToStaticMarkup(createElement(ActualBudgetImportStep, {
      budget: ACTUAL_BUDGET,
      importResult: null,
      budgetDrafts: [{
        categoryId: 'car',
        name: 'Car',
        categorySourceId: 'car',
        months: [{ month: '2024-02', amount: 15000 }, { month: '2024-03', amount: 17550 }],
        recurs: true,
        isArchived: false,
        disabledReason: null,
      }],
      budgetRefusals: new Map([['car', 'Its category is not imported.']]),
      budgetsMissingPayments: [],
      selectedBudgetIds: new Set<string>(),
      toggleBudgetSelection: () => undefined,
      setBudgetsSelected: () => undefined,
      importedBudgetNames: new Set<string>(),
      budgetSelectionError: null,
      importOverlayOpen: false,
    }))

    expectAmountColumns(markup, { headers: ['Latest Amount'], values: ['175.50'], others: ['Months', 'First Month', '2024-02'] })
  })
})
