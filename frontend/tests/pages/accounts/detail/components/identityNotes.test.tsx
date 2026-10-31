import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdentityNotes } from '@/pages/accounts/detail/components/identity/Notes'

/**
 * Guards the account page's notes box: it scrolls when the notes are long, so a keyboard user must be
 * able to focus it, and a screen reader hears it named by its Notes label
 */
describe('IdentityNotes', () => {
  it('takes keyboard focus and is named by its label', () => {
    const markup = renderToStaticMarkup(<IdentityNotes notes={'Account 123-456\nCustomer 42'} />)

    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('role="region"')
    expect(markup).toMatch(/id="(account-notes-label)"[^>]*>Notes<\/p>/)
    expect(markup).toContain('aria-labelledby="account-notes-label"')
  })

  it('keeps the typed line breaks', () => {
    const markup = renderToStaticMarkup(<IdentityNotes notes={'Account 123-456\nCustomer 42'} />)

    expect(markup).toContain('whitespace-pre-wrap')
    expect(markup).toContain('Account 123-456\nCustomer 42')
  })
})
