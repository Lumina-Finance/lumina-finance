import { expect } from 'vitest'

// The classes the preview's amounts carry, which an amount in a table of skipped rows takes as well,
// while its header only lines up on the right with it
export const AMOUNT_VALUE_CLASSES = ['text-right', 'font-financial', 'tabular-nums']

/**
 * Finds the class list of each table cell, header or body, holding exactly one of the texts given
 */
export function findCellClasses(markup: string, texts: string[]) {
  return texts.map((text) => {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const cell = new RegExp(`<t[hd] class="([^"]*)"[^>]*>(?:<span[^>]*>)?${escaped}<`).exec(markup)
    expect(cell, `a cell holding ${text}`).not.toBeNull()
    return cell?.[1].split(' ') ?? []
  })
}

/**
 * Checks that the columns holding amounts line up on the right, their values in tabular figures,
 * and that the other columns stay on the left
 */
export function expectAmountColumns(markup: string, { headers, values, others }: { headers: string[]; values: string[]; others: string[] }) {
  for (const classes of findCellClasses(markup, headers)) expect(classes).toContain('text-right')
  for (const classes of findCellClasses(markup, values)) expect(classes).toEqual(expect.arrayContaining(AMOUNT_VALUE_CLASSES))
  for (const classes of findCellClasses(markup, others)) expect(classes).not.toContain('text-right')
}
