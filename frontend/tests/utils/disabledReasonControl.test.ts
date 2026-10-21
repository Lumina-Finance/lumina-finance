/**
 * Guards the props every control with a reason is built from (the shared button, the Save button and the
 * dropdown head). `aria-disabled` leaves the control clickable and focusable, so while the reason holds,
 * a click and a key press must not reach the control's own action, and once it clears they must
 */
import { describe, expect, it, vi } from 'vitest'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'

function setup(isUnavailable: boolean) {
  const handleBlockedClick = vi.fn()
  const controlProps = { onMouseEnter: vi.fn(), onBlur: vi.fn() }
  const own = { onClick: vi.fn(), onKeyDown: vi.fn(), onMouseEnter: vi.fn(), onBlur: vi.fn() }
  const props = getDisabledReasonProps<HTMLButtonElement>(
    { isUnavailable, controlProps: { ...controlProps, 'aria-describedby': 'why' }, handleBlockedClick },
    { ...own, 'aria-describedby': 'hint' },
  )
  return { props, own, controlProps, handleBlockedClick }
}

const click = { detail: 0 } as MouseEvent<HTMLButtonElement>
const enter = { key: 'Enter' } as KeyboardEvent<HTMLButtonElement>

describe('getDisabledReasonProps', () => {
  it('shows the reason and runs no action on a click or an Enter press while the reason holds', () => {
    const { props, own, handleBlockedClick } = setup(true)

    props.onClick(click)
    props.onKeyDown(enter)

    expect(handleBlockedClick).toHaveBeenCalledWith(click)
    expect(own.onClick).not.toHaveBeenCalled()
    expect(own.onKeyDown).not.toHaveBeenCalled()
  })

  it('runs the action on a click and an Enter press once the reason is gone', () => {
    const { props, own, handleBlockedClick } = setup(false)

    props.onClick(click)
    props.onKeyDown(enter)

    expect(own.onClick).toHaveBeenCalledWith(click)
    expect(own.onKeyDown).toHaveBeenCalledWith(enter)
    expect(handleBlockedClick).not.toHaveBeenCalled()
  })

  it('keeps the control own hover and blur handlers beside the ones that show the reason', () => {
    const { props, own, controlProps } = setup(true)
    const hover = {} as MouseEvent<HTMLButtonElement>

    props.onMouseEnter(hover)
    props.onBlur({} as FocusEvent<HTMLButtonElement>)

    expect(own.onMouseEnter).toHaveBeenCalledWith(hover)
    expect(controlProps.onMouseEnter).toHaveBeenCalledWith(hover)
    expect(own.onBlur).toHaveBeenCalledOnce()
    expect(controlProps.onBlur).toHaveBeenCalledOnce()
    expect(props['aria-describedby']).toBe('hint why')
  })
})
