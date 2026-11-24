/**
 * Guards the sentences that name the day a deletion runs: each reads as the copy says, and keeps the date
 * on one line, so a phone never breaks the month from the day and year
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProfileDeletedMessage } from '@/components/profile-deletion/ProfileDeletedMessage'
import { DeleteWarning } from '@/pages/settings/components/DeleteWarning'

const NO_WRAP_DATE = '<span class="whitespace-nowrap">Dec 23, 2026</span>'

describe('the sign-in notice', () => {
  it('says the profile is gone when the deletion ran at once', () => {
    expect(renderToStaticMarkup(<ProfileDeletedMessage scheduledFor={null} />)).toBe(
      'Your profile and data were deleted.',
    )
  })

  it('names the date on one line and asks the user to sign in and cancel before it', () => {
    expect(renderToStaticMarkup(<ProfileDeletedMessage scheduledFor="Dec 23, 2026" />)).toBe(
      `Your profile will be deleted on ${NO_WRAP_DATE}. Please sign in and cancel before then.`,
    )
  })
})

describe('the Delete profile warning', () => {
  it('warns that the deletion is final when it runs at once', () => {
    expect(renderToStaticMarkup(<DeleteWarning scheduledFor={null} />)).toBe(
      'This will permanently delete all your data and is irrevocable.',
    )
  })

  it('names the date on one line and that the user can cancel until then', () => {
    expect(renderToStaticMarkup(<DeleteWarning scheduledFor="Dec 23, 2026" />)).toBe(
      `Your profile and data will be deleted on ${NO_WRAP_DATE}. Until then, you can sign in and cancel.`,
    )
  })
})
