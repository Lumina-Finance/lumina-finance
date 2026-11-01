/**
 * Guards the insight section header's option to keep the icon and the label together as one item of the
 * header, apart from the action. The merchant map needs it on a phone, and every other card keeps its
 * icon and label as separate items that wrap on their own
 */
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Store } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { InsightSectionHeader } from '@/pages/insights/components/SectionHeader'

const LABEL = 'A long section title'

type Props = { children?: ReactNode }

// The header has no state, so calling it gives the element tree it draws
function drawHeader(keepLabelBesideIcon: boolean): ReactElement<Props> {
  return InsightSectionHeader({
    icon: Store,
    label: LABEL,
    action: <button type="button">Act</button>,
    keepLabelBesideIcon,
  }) as ReactElement<Props>
}

// The items the header lays out in its row, looking through fragments
function itemsOf(parent: ReactElement<Props>): ReactNode[] {
  return Children.toArray(parent.props.children).flatMap((child) =>
    isValidElement<Props>(child) && child.type === Fragment ? itemsOf(child) : [child],
  )
}

function holds(node: ReactNode, matches: (element: ReactElement<Props>) => boolean): boolean {
  if (!isValidElement<Props>(node)) return false
  return matches(node) || Children.toArray(node.props.children).some((child) => holds(child, matches))
}

const isIcon = (element: ReactElement<Props>) => element.type === Store
const isLabel = (element: ReactElement<Props>) => Children.toArray(element.props.children).includes(LABEL)
const isAction = (element: ReactElement<Props>) => element.type === 'button'

describe('InsightSectionHeader', () => {
  it('draws the icon and the label as one item, apart from the action, when asked to keep them together', () => {
    const items = itemsOf(drawHeader(true))
    const group = items.filter((item) => holds(item, isIcon))

    expect(group).toHaveLength(1)
    expect(holds(group[0], isLabel)).toBe(true)
    expect(holds(group[0], isAction)).toBe(false)
    expect(items.filter((item) => holds(item, isAction))).toHaveLength(1)
  })

  it('draws the icon, the label and the action as three separate items by default', () => {
    const items = itemsOf(drawHeader(false))
    const withIcon = items.filter((item) => holds(item, isIcon))
    const withLabel = items.filter((item) => holds(item, isLabel))
    const withAction = items.filter((item) => holds(item, isAction))

    expect([withIcon.length, withLabel.length, withAction.length]).toEqual([1, 1, 1])
    expect(new Set([...withIcon, ...withLabel, ...withAction]).size).toBe(3)
  })
})
