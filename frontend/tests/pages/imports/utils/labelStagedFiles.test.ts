/**
 * Tests the name a staged file shows under, which tells files of one name apart by their position
 * so every place that names a file says the same thing
 */
import { describe, expect, it } from 'vitest'
import { labelStagedFiles } from '@/pages/imports/utils'

describe('labelStagedFiles', () => {
  it('leaves names no other file shares as they are', () => {
    expect(labelStagedFiles([{ name: 'a.qfx' }, { name: 'b.qfx' }])).toEqual(['a.qfx', 'b.qfx'])
  })

  it('adds the position, counted from 1, to every file of a shared name', () => {
    const files = ['statement.qfx', 'other.qfx', 'statement.qfx', 'statement.qfx'].map((name) => ({ name }))

    expect(labelStagedFiles(files)).toEqual([
      'statement.qfx (file 1)',
      'other.qfx',
      'statement.qfx (file 3)',
      'statement.qfx (file 4)',
    ])
  })
})
