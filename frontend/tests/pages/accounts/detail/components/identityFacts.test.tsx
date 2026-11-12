/**
 * Guards that account facts are cut off with an ellipsis where a value is too long, as the identity card
 * has always set them, and wrap only where the caller asks
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IdentityFacts } from '@/pages/accounts/detail/components/identity/Facts'

const FACTS = [{ label: 'Type', value: 'A very long account type name' }]

describe('identity facts', () => {
  it('truncates a long value by default', () => {
    const markup = renderToStaticMarkup(<IdentityFacts facts={FACTS} />)

    expect(markup).toMatch(/<dd class="[^"]*\btruncate\b/)
    expect(markup).not.toContain('break-words')
  })

  it('wraps a long value when asked to', () => {
    const markup = renderToStaticMarkup(<IdentityFacts facts={FACTS} wrapsValues />)

    expect(markup).toMatch(/<dd class="[^"]*\bbreak-words\b/)
    expect(markup).not.toContain('truncate')
  })
})
