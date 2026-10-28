/**
 * Tests the helpers behind a group of acknowledgement tick boxes, so a refused press names what is
 * missing and sends focus to the first box still unticked
 */
import { describe, expect, it } from 'vitest'
import {
  getAcknowledgementProblem,
  getFirstUntickedKey,
} from '@/components/forms/acknowledgement'

describe('getAcknowledgementProblem', () => {
  it('reports nothing once every box is ticked', () => {
    expect(getAcknowledgementProblem([true, true])).toBeUndefined()
  })

  it('asks for both boxes when a pair has one unticked', () => {
    expect(getAcknowledgementProblem([true, false])).toBe('Tick both boxes')
    expect(getAcknowledgementProblem([false, false])).toBe('Tick both boxes')
  })

  it('asks for the box when a lone box is unticked', () => {
    expect(getAcknowledgementProblem([false])).toBe('Tick the box')
  })
})

describe('getFirstUntickedKey', () => {
  it('picks the first unticked box', () => {
    expect(getFirstUntickedKey(['saved', 'lockout'], [true, false])).toBe('lockout')
    expect(getFirstUntickedKey(['saved', 'lockout'], [false, false])).toBe('saved')
  })

  it('falls back to the first box when all are ticked', () => {
    expect(getFirstUntickedKey(['saved', 'lockout'], [true, true])).toBe('saved')
  })
})
