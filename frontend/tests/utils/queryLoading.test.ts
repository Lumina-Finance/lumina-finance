/**
 * Guards the loading animation against hiding data already on screen while a newer copy is fetched,
 * while it still shows for a wait with nothing to put there
 */
import { describe, expect, it } from 'vitest'
import { isLoadingFirstAnswer } from '@/utils/queryLoading'

describe('isLoadingFirstAnswer', () => {
  it('stays off while refreshing data already held', () => {
    expect(isLoadingFirstAnswer({ data: [], isFetching: true, isError: false })).toBe(false)
  })

  it('shows for a first fetch with nothing held', () => {
    expect(isLoadingFirstAnswer({ data: undefined, isFetching: true, isError: false })).toBe(true)
  })

  it('shows while a failed query is retried, even over data held from before', () => {
    expect(isLoadingFirstAnswer({ data: [], isFetching: true, isError: true })).toBe(true)
  })

  it('shows while a new key fetches behind data held over from the last one', () => {
    expect(isLoadingFirstAnswer({ data: [], isFetching: true, isError: false, isPlaceholderData: true })).toBe(true)
  })

  it('stays off once nothing is fetching', () => {
    expect(isLoadingFirstAnswer({ data: undefined, isFetching: false, isError: true })).toBe(false)
  })
})
