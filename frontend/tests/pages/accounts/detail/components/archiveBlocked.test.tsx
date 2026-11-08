import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Account } from '@/api/accounts'
import { AccountArchiveSection } from '@/pages/accounts/detail/components/edit-identity/sections/ArchiveSection'
import { DeleteAccountPanel } from '@/pages/accounts/detail/components/edit-identity/sections/DeletePanel'
import {
  ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON,
  getArchiveReason,
} from '@/pages/accounts/detail/constants/accountDetail'

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
      archiveReason={getArchiveReason(archiveLinkedReason, isArchiveBlocked)}
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
      isLinkLoading={isLinkLoading}
      archiveReason={getArchiveReason(archiveLinkedReason, isArchiveBlocked)}
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

describe('the one reason archiving is unavailable', () => {
  it("is the link's when linked, the later transactions' when only they block it, and none otherwise", () => {
    expect(getArchiveReason(LINKED_REASON, false)).toBe(LINKED_REASON)
    expect(getArchiveReason(LINKED_REASON, true)).toBe(LINKED_REASON)
    expect(getArchiveReason(null, true)).toBe(ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON)
    expect(getArchiveReason(null, false)).toBeNull()
  })
})

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

  it('points the archive shortcut at the same reason without disabling it', () => {
    const button = getArchiveInsteadButton(renderDeletePanel(false, LINKED_REASON))
    expect(button).toContain('aria-disabled="true"')
    expect(button).toContain('aria-describedby="edit-account-archive-blocked-reason"')
    expect(button).not.toContain('disabled=""')
  })
})

describe('archive held back while the link is read', () => {
  // How the held row looks, faded or not, is checked in the browser, where the styles apply
  it('disables the switch and the archive shortcut alike, without giving either a reason', () => {
    const section = renderArchiveSection(false, null, true)
    expect(section).toMatch(/<input[^>]*role="switch"[^>]*disabled=""/)
    expect(section).not.toContain('aria-describedby')

    const button = getArchiveInsteadButton(renderDeletePanel(false, null, true)).match(/^<button[^>]*>/)?.[0] ?? ''
    expect(button).toContain('disabled=""')
    expect(button).not.toContain('aria-describedby')
  })
})
