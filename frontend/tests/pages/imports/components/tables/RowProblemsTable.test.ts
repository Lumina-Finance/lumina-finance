/**
 * Tests the import's lists of rows left out and rows worth a look, so the columns holding amounts line
 * up on the right in tabular figures as the preview's amounts do, while the rest stay on the left and
 * every value reads exactly as the file wrote it
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { ImportRowProblemsTable, ImportRowWarningsTable } from '@/pages/imports/components'
import type { ImportRowProblem } from '@/pages/imports/types'
import { expectAmountColumns } from './fixtures'

const PROBLEMS: ImportRowProblem[] = [
  { id: 'file-1-0', rowNumber: 2, cells: { 'Date': 'someday', 'Amount': '-42.50', 'Money In': '', 'Notes': 'Lunch' }, reason: 'The date is not one we can read.' },
  { id: 'file-1-1', rowNumber: 3, cells: { 'Date': 'never', 'Amount': '1,234.00', 'Money In': '7.00', 'Notes': 'Rent' }, reason: 'The date is not one we can read.' },
]

describe('the import\'s row problem tables', () => {
  it('right-aligns the amount column with its header and leaves the others on the left', () => {
    const markup = renderToStaticMarkup(createElement(ImportRowProblemsTable, {
      title: '2 rows not imported',
      rowProblems: PROBLEMS,
      headers: ['Date', 'Amount', 'Notes'],
      amountHeaders: ['Amount'],
      toggleLabel: 'skipped rows',
    }))

    expectAmountColumns(markup, { headers: ['Amount'], values: ['-42.50', '1,234.00'], others: ['Date', 'someday', 'Notes', 'Lunch'] })
  })

  it('right-aligns both columns of a file keeping money out and money in apart, in the rows worth a look', () => {
    const markup = renderToStaticMarkup(createElement(ImportRowWarningsTable, {
      rowWarnings: PROBLEMS,
      headers: ['Date', 'Amount', 'Money In', 'Notes'],
      amountHeaders: ['Amount', 'Money In'],
    }))

    expectAmountColumns(markup, { headers: ['Amount', 'Money In'], values: ['-42.50', '7.00'], others: ['Date', 'Notes'] })
  })
})
