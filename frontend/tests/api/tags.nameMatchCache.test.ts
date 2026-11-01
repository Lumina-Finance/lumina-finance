/**
 * Covers what happens to the import step's tag answers when a tag is created elsewhere
 *
 * The answer says which of a file's tag names have no tag yet, so a tag made while it is cached
 * would otherwise leave the step offering to create one that now exists
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { tagKeys } from '@/api/cache/queryKeys'
import { updateTagCreateCaches } from '@/api/cache/updates/tags'
import type { Tag } from '@/api/tags'

const TRAVEL: Tag = {
  id: 'travel',
  owner_id: 'user-1',
  group_id: null,
  name: 'Travel',
  created_at: '2026-01-01T00:00:00Z',
}

describe('creating a tag while an import holds its tag answers', () => {
  it('marks the answers for every set of values as stale', () => {
    const queryClient = new QueryClient()
    const askedAbout = tagKeys.nameMatches(['TRAVEL', 'trvl'])
    const askedAboutOthers = tagKeys.nameMatches(['Food'])
    queryClient.setQueryData(askedAbout, [])
    queryClient.setQueryData(askedAboutOthers, [])
    expect(queryClient.getQueryState(askedAbout)?.isInvalidated).toBe(false)

    updateTagCreateCaches(queryClient, TRAVEL)

    expect(queryClient.getQueryState(askedAbout)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(askedAboutOthers)?.isInvalidated).toBe(true)
  })

  it('leaves the merchant answers alone', () => {
    const queryClient = new QueryClient()
    const merchantAnswers = ['merchants', 'name-matches', ['Travel']] as const
    queryClient.setQueryData(merchantAnswers, [])

    updateTagCreateCaches(queryClient, TRAVEL)

    expect(queryClient.getQueryState(merchantAnswers)?.isInvalidated).toBe(false)
  })
})
