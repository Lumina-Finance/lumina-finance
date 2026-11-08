/**
 * Guards that the account edit modal's label row crossfades one field's error into the next, as every
 * other dialogue does, unless a caller asks for one to leave before the next arrives
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'

const errorProps = vi.hoisted(() => ({ seen: [] as Array<{ sequential?: boolean }> }))

vi.mock('@/components/forms/FieldError', () => ({
  FieldError: (props: { sequential?: boolean }) => {
    errorProps.seen.push(props)
    return null
  },
}))

describe('account edit label row', () => {
  beforeEach(() => {
    errorProps.seen = []
  })

  it('crossfades its error unless asked to show one at a time', () => {
    renderToStaticMarkup(<AccountIdentityFieldLabelRow label="Name" error="Required" errorId="e" />)
    renderToStaticMarkup(<AccountIdentityFieldLabelRow label="Name" error="Required" errorId="e" sequential />)

    expect(errorProps.seen.map((props) => props.sequential)).toEqual([undefined, true])
  })
})
