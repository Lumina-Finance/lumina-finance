/**
 * Tests the staged-file list shared by the import flows: it names files of one name apart the way
 * the rest of the import does, and shows every file rather than scrolling some out of sight
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportStagedFileTable } from '@/pages/imports/components'

function render(names: string[]) {
  return renderToStaticMarkup(createElement(ImportStagedFileTable, {
    files: names.map((name, index) => ({ id: String(index), name })),
    describe: () => ({ detail: '1 transaction' }),
    onRemove: () => undefined,
  }))
}

describe('the staged-file list', () => {
  it('labels files of a shared name by position, in the names and the remove buttons', () => {
    const markup = render(['statement.qfx', 'oct.qfx', 'statement.qfx'])

    expect(markup).toContain('>statement.qfx (file 1)<')
    expect(markup).toContain('>statement.qfx (file 3)<')
    expect(markup).toContain('aria-label="Remove statement.qfx (file 3)"')
    expect(markup).toContain('>oct.qfx<')
  })

  it('does not cap its height, so no file is scrolled out of sight', () => {
    expect(render(['a.qfx', 'b.qfx', 'c.qfx', 'd.qfx', 'e.qfx'])).not.toMatch(/overflow-y-auto|max-h-/)
  })
})
