/**
 * Guards the FX badge's tooltip in an account list. It opens upward over the row above. A row or the
 * list around it clipped its contents, so the tooltip was cut off at the row's own top edge and looked
 * as though it sat behind the row above. Only a group body that is opening or closing may clip
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatCurrency: (amount: number) => `${amount}` }),
}))

// The motion props of each group body. Markup can't show them: what the body does once it has settled
const { groupBodies } = vi.hoisted(() => ({
  groupBodies: [] as { style: Record<string, unknown>; animate: { transitionEnd?: Record<string, unknown> } }[],
}))

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>()
  const Div = (props: Record<string, unknown>) => {
    if (typeof props.id === 'string' && props.id.startsWith('account-group-')) {
      groupBodies.push({ style: props.style as never, animate: props.animate as never })
    }
    return <actual.motion.div {...props} />
  }
  return {
    ...actual,
    motion: new Proxy(actual.motion, { get: (target, key) => (key === 'div' ? Div : Reflect.get(target, key)) }),
  }
})

import AccountListSection from '@/pages/accounts/components/ListSection'
import { getAccountGroups } from '@/pages/accounts/utils/accountGroups'
import { createForeignAccount } from './fixtures'

const VOID_TAG = /^<(area|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/

/** The opening tags still open where `marker` first appears, outermost first */
function openTagsAt(markup: string, marker: string): string[] {
  const open: string[] = []
  for (const [tag] of markup.slice(0, markup.indexOf(marker)).matchAll(/<\/?[a-z][^>]*>/g)) {
    if (tag.startsWith('</')) open.pop()
    else if (!tag.endsWith('/>') && !VOID_TAG.test(tag)) open.push(tag)
  }
  return open
}

describe('account list section', () => {
  it('leaves nothing around a settled row’s FX badge that would clip its tooltip', () => {
    const accounts = [createForeignAccount(), createForeignAccount({ id: 'account-2', name: 'Savings' })]
    const [group] = getAccountGroups({ rows: accounts, filteredRows: accounts, grouping: 'type' })
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AccountListSection
          group={group}
          grouping="type"
          thenBy={null}
          toggledKeys={new Set()}
          keepExpanded
          onToggle={() => {}}
          showLogos={false}
          displayCurrency="CAD"
          taxAdvantagedCategoryById={new Map()}
        />
      </MemoryRouter>,
    )
    const ancestors = openTagsAt(markup, 'aria-label="Account balance FX status"')

    // The group's body clips while it opens or closes and lets go once it has settled. Markup
    // cannot show that, so what sits between the body and the badge is what is checked
    const bodyIndex = ancestors.findIndex((tag) => tag.includes('id="account-group-'))
    expect(bodyIndex).toBeGreaterThanOrEqual(0)
    expect(ancestors.length).toBeGreaterThan(bodyIndex + 1)
    expect(ancestors.slice(bodyIndex + 1).filter((tag) => /overflow-hidden|overflow:\s*hidden/.test(tag))).toEqual([])
  })

  it('clips a group body while it opens and lets go of the clip once it has settled', () => {
    const accounts = [createForeignAccount(), createForeignAccount({ id: 'account-2', name: 'Savings' })]
    const [group] = getAccountGroups({ rows: accounts, filteredRows: accounts, grouping: 'type' })
    groupBodies.length = 0
    renderToStaticMarkup(
      <MemoryRouter>
        <AccountListSection
          group={group}
          grouping="type"
          thenBy={null}
          toggledKeys={new Set()}
          keepExpanded
          onToggle={() => {}}
          showLogos={false}
          displayCurrency="CAD"
          taxAdvantagedCategoryById={new Map()}
        />
      </MemoryRouter>,
    )

    expect(groupBodies).toHaveLength(1)
    expect(groupBodies[0].style.overflow).toBe('hidden')
    expect(groupBodies[0].animate.transitionEnd?.overflow).toBe('visible')
  })
})
