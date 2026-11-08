import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Account } from '@/api/accounts'
import { AccountArchiveSection } from '@/pages/accounts/detail/components/edit-identity/sections/ArchiveSection'
import { DeleteAccountPanel } from '@/pages/accounts/detail/components/edit-identity/sections/DeletePanel'
import { ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON } from '@/pages/accounts/detail/constants/accountDetail'

// Static rendering escapes the apostrophe in the reason, so markup is matched against the escaped text
const RENDERED_REASON = ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON.replaceAll("'", '&#x27;')

const LINKED_REASON = 'Unlink it first.'

function renderArchiveSection(
  isArchiveBlocked: boolean,
  archiveLinkedReason: string | null = null,
  isLinkLoading = false,
) {
  return renderToStaticMarkup(
    <AccountArchiveSection
      sectionNumber="02"
      isArchived={false}
      isArchiving={false}
      isArchiveBlocked={isArchiveBlocked}
      isLinkLoading={isLinkLoading}
      archiveLinkedReason={archiveLinkedReason}
      currentBalance={0}
      currency="CAD"
      onToggle={() => {}}
    />,
  )
}

function renderDeletePanel(
  isArchiveBlocked: boolean,
  archiveLinkedReason: string | null = null,
  isLinkLoading = false,
) {
  const account = { name: 'Chequing', is_archived: false } as Account
  return renderToStaticMarkup(
    <DeleteAccountPanel
      account={account}
      deleteStage="confirm"
      deleteNameInput=""
      deleteError={null}
      deleteLoading={false}
      isBusy={false}
      isArchiveBlocked={isArchiveBlocked}
      isLinkLoading={isLinkLoading}
      archiveLinkedReason={archiveLinkedReason}
      onArchiveInstead={() => {}}
      onContinue={() => {}}
      onDelete={() => {}}
      onNameChange={() => {}}
    />,
  )
}

function getArchiveInsteadButton(markup: string) {
  return markup.match(/<button[^>]*>(?:(?!<\/button>).)*Archive instead(?:<\/span>)?<\/button>/s)?.[0] ?? ''
}

describe('archive blocked by later-dated transactions', () => {
  it('locks the archive switch and explains why', () => {
    const markup = renderArchiveSection(true)
    expect(markup).toContain(RENDERED_REASON)
    expect(markup).toMatch(/<input[^>]*role="switch"[^>]*disabled=""/)
    expect(markup).toContain('aria-describedby="edit-account-archive-blocked-reason"')
  })

  it('leaves the archive switch available without later-dated transactions', () => {
    const markup = renderArchiveSection(false)
    expect(markup).not.toContain(RENDERED_REASON)
    expect(markup).not.toMatch(/<input[^>]*role="switch"[^>]*disabled=""/)
  })

  // It stays focusable and hoverable so the reason can be shown, which a native disabled button can't be
  it('holds off the archive shortcut in the delete confirmation and explains why', () => {
    const blocked = getArchiveInsteadButton(renderDeletePanel(true))
    expect(blocked).toContain('aria-disabled="true"')
    expect(blocked).not.toContain('disabled=""')
    // The reason is the line the archive section prints, so the button is described by that line and
    // the panel adds no hidden copy of it for a screen reader to read twice
    expect(blocked).toContain('aria-describedby="edit-account-archive-blocked-reason"')
    expect(renderDeletePanel(true)).not.toContain(RENDERED_REASON)

    const available = getArchiveInsteadButton(renderDeletePanel(false))
    expect(available).not.toContain('aria-disabled="true"')
    expect(available).not.toContain('disabled=""')
  })
})

describe('archive held back by a link', () => {
  it('shows the reason under the switch row and leaves the switch focusable', () => {
    const markup = renderArchiveSection(false, LINKED_REASON)
    expect(markup).toMatch(
      /<\/label><div[^>]*><div[^>]*><p id="edit-account-archive-blocked-reason"[^>]*>Unlink it first\.<\/p>/,
    )
    expect(markup).toMatch(/<input[^>]*role="switch"[^>]*aria-disabled="true"/)
    expect(markup).not.toMatch(/<input[^>]*role="switch"[^>]*disabled=""/)
  })

  // A faded row fades its focus ring with it, and the switch it holds is still focusable
  it("fades the row's text and leaves the row whole, so the focus ring on the switch stays at full strength", () => {
    const markup = renderArchiveSection(false, LINKED_REASON)
    const label = markup.match(/<label[^>]*>/)?.[0] ?? ''
    const text = markup.match(/<span class="[^"]*opacity-60[^"]*">/)?.[0] ?? ''

    expect(label).not.toContain('opacity-60')
    expect(text).not.toBe('')
    expect(markup.indexOf(text)).toBeGreaterThan(markup.indexOf(label))
    expect(markup.indexOf(text)).toBeLessThan(markup.indexOf('role="switch"'))
  })

  it('still fades a row whose switch is disabled outright by later-dated transactions as a whole', () => {
    const label = renderArchiveSection(true).match(/<label[^>]*>/)?.[0] ?? ''
    expect(label).toContain('opacity-60')
  })

  it('points the archive shortcut at the same reason without disabling it', () => {
    const button = getArchiveInsteadButton(renderDeletePanel(false, LINKED_REASON))
    expect(button).toContain('aria-disabled="true"')
    expect(button).toContain('aria-describedby="edit-account-archive-blocked-reason"')
    expect(button).not.toContain('disabled=""')
  })
})

describe('archive held back while the link is read', () => {
  it('disables the switch and the archive shortcut alike, neither faded nor given a reason', () => {
    const section = renderArchiveSection(false, null, true)
    expect(section).toMatch(/<input[^>]*role="switch"[^>]*disabled=""/)
    expect(section).not.toContain('opacity-60')
    expect(section).not.toContain('aria-describedby')

    // Only the button's own classes, since its label fades on its own for a link's reason
    const button = getArchiveInsteadButton(renderDeletePanel(false, null, true)).match(/^<button[^>]*>/)?.[0] ?? ''
    expect(button).toContain('disabled=""')
    expect(button).not.toContain('opacity-60')
    expect(button).not.toContain('aria-describedby')
  })
})
