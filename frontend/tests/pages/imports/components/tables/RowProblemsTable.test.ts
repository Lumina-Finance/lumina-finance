/**
 * Tests the import's lists of rows left out and rows worth a look, so the columns holding amounts line
 * up on the right in tabular figures as the preview's amounts do, while the rest stay on the left and
 * every value reads exactly as the file wrote it, and rows sharing a reason read under it once
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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

  // Row numbers restart in each file, so with several files a row is told apart by its file
  it('names the file beside each row number only when it is told to', () => {
    const rowProblems: ImportRowProblem[] = [
      { id: 'a', fileName: '2024-03.csv', rowNumber: 7, cells: { Notes: 'first' }, reason: 'Reason.' },
      { id: 'b', fileName: '2024-04.csv', rowNumber: 7, cells: { Notes: 'second' }, reason: 'Reason.' },
    ]
    const render = (areFilesNamed: boolean) => renderToStaticMarkup(createElement(ImportRowProblemsTable, {
      title: '2 rows not imported',
      rowProblems,
      headers: ['Notes'],
      amountHeaders: [],
      toggleLabel: 'skipped rows',
      areFilesNamed,
    }))

    // The number then the name, each in an element of its own, whatever the elements are styled with
    expect(render(true)).toMatch(/>7<\/span><span[^>]*>2024-03\.csv<\/span>/)
    expect(render(true)).toMatch(/>7<\/span><span[^>]*>2024-04\.csv<\/span>/)
    expect(render(false)).not.toContain('.csv')
  })

  // Rows sharing a reason read under it once, so a long reason isn't repeated down the list
  it('says each reason once above the rows sharing it, in the order reasons first appear', () => {
    const rowProblems: ImportRowProblem[] = [
      { id: 'a', rowNumber: 2, cells: { Notes: 'first-b' }, reason: 'Reason B.' },
      { id: 'b', rowNumber: 3, cells: { Notes: 'second-a' }, reason: 'Reason A.' },
      { id: 'c', rowNumber: 4, cells: { Notes: 'third-b' }, reason: 'Reason B.' },
    ]
    const markup = renderToStaticMarkup(createElement(ImportRowProblemsTable, {
      title: '3 rows not imported',
      rowProblems,
      headers: ['Notes'],
      amountHeaders: [],
      toggleLabel: 'skipped rows',
    }))

    expect(markup.split('Reason B.')).toHaveLength(2)
    expect(markup.split('Reason A.')).toHaveLength(2)
    const order = ['Reason B.', 'first-b', 'third-b', 'Reason A.', 'second-a'].map((text) => markup.indexOf(text))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order[0]).toBeGreaterThan(-1)
  })
})
