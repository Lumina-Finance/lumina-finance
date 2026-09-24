import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Account } from '@/api/accounts'
import { AccountArchiveSection } from '@/pages/accounts/detail/components/edit-identity/sections/ArchiveSection'
import { DeleteAccountPanel } from '@/pages/accounts/detail/components/edit-identity/sections/DeletePanel'
import { ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON } from '@/pages/accounts/detail/constants/accountDetail'

// Static rendering escapes the apostrophe in the reason, so markup is matched against the escaped text
const RENDERED_REASON = ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON.replaceAll("'", '&#x27;')

function renderArchiveSection(isArchiveBlocked: boolean) {
  return renderToStaticMarkup(
    <AccountArchiveSection
      sectionNumber="02"
      isArchived={false}
      isArchiving={false}
      isArchiveBlocked={isArchiveBlocked}
      currentBalance={0}
      currency="CAD"
      onToggle={() => {}}
    />,
  )
}

function renderDeletePanel(isArchiveBlocked: boolean) {
  const account = { name: 'Chequing', is_archived: false } as Account
  return renderToStaticMarkup(
    <DeleteAccountPanel
      account={account}
      deleteStage="confirm"
      deleteNameInput=""
      deleteError={null}
      deleteLoading={false}
      isBusy={false}
      canDelete={false}
      isArchiveBlocked={isArchiveBlocked}
      onArchiveInstead={() => {}}
      onContinue={() => {}}
      onDelete={() => {}}
      onNameChange={() => {}}
    />,
  )
}

function getArchiveInsteadButton(markup: string) {
  return markup.match(/<button[^>]*>(?:(?!<\/button>).)*Archive instead<\/button>/s)?.[0] ?? ''
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

  it('disables the archive shortcut in the delete confirmation', () => {
    expect(getArchiveInsteadButton(renderDeletePanel(true))).toContain('disabled=""')
    expect(getArchiveInsteadButton(renderDeletePanel(false))).not.toContain('disabled=""')
  })
})
