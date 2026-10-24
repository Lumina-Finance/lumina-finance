/**
 * Guards which problems a dialog draws and which one its button names, so a form never marks fields the
 * person hasn't reached and a refused press always marks every one
 */
import { describe, expect, it } from 'vitest'
import { getFirstProblem, getShownProblems } from '@/utils/refusedSubmit'

type Field = 'name' | 'amount' | 'category'
const ORDER: Field[] = ['name', 'amount', 'category']

describe('getFirstProblem', () => {
  it('follows the order the dialog draws its fields, not the order the problems were found', () => {
    const problems = { category: 'Choose a category', amount: 'Enter an amount' }
    expect(getFirstProblem(problems, ORDER)).toEqual({ field: 'amount', message: 'Enter an amount' })
  })

  it('finds nothing in a form without problems', () => {
    expect(getFirstProblem({}, ORDER)).toBeNull()
  })
})

describe('getShownProblems', () => {
  const problems = { name: 'Name is required', amount: 'Enter an amount' }

  it('draws only the fields the person has left until a press is refused', () => {
    expect(getShownProblems(problems, false, new Set<Field>(['name']))).toEqual({ name: 'Name is required' })
    expect(getShownProblems(problems, false, new Set<Field>())).toEqual({})
  })

  it('draws a left field only while it still has a problem', () => {
    expect(getShownProblems({}, false, new Set<Field>(['name']))).toEqual({})
  })

  it('draws every problem once a press is refused', () => {
    expect(getShownProblems(problems, true, new Set<Field>())).toEqual(problems)
  })
})
