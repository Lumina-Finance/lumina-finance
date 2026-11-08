/**
 * Guards that a dialogue field's label gives way to a long problem beside it unless the field asks to
 * keep its label whole, so only the field holding a bank item's account changes how the row lays out
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'

describe('create-modal field label row', () => {
  const labelBox = (keepsLabelWhole?: boolean) =>
    renderToStaticMarkup(
      <CreateModalFieldLabelRow
        label="Account"
        htmlFor="account"
        error="A long problem"
        errorId="account-error"
        keepsLabelWhole={keepsLabelWhole}
      />,
    ).match(/<div class="relative flex [^"]*"/)?.[0]

  it('lets the label give way to a long problem by default', () => {
    expect(labelBox()).toContain('min-w-0')
    expect(labelBox()).not.toContain('shrink-0')
  })

  it('keeps the label whole beside a long problem when asked', () => {
    expect(labelBox(true)).toContain('shrink-0')
    expect(labelBox(true)).not.toContain('min-w-0')
  })
})
