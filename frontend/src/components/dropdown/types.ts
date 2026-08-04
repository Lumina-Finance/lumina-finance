import type { ReactNode } from 'react'

/** How tall the pill sits, which is the one thing that changes between the places it is used */
export type DropdownSize =
  /** 36px, for a dense table row or an inline editor */
  | 'compact'

  /** 40px, matching the height of a text input beside it in a form */
  | 'field'

  /** 44px, for a toolbar or a filter bar, where it is a primary tap target */
  | 'toolbar'

export interface DropdownOption {
  value: string
  label: string
  group?: string

  /**
   * Shown before the label, as an emoji string or a rendered icon
   *
   * Rendered as decoration, so it is hidden from assistive software and the label carries the meaning
   */
  icon?: ReactNode

  /** Short qualifier shown as a pill beside the label, for a caveat the label itself should not carry */
  badge?: string

  /** Number shown at the end of the row, for a list whose options each cover a count of something */
  count?: number

  /**
   * Whether the option is shown but cannot be chosen
   *
   * Keyboard movement steps over it and a press on it does nothing, so a list can show a choice that
   * exists without offering it
   */
  disabled?: boolean

  /**
   * A sentence under the label explaining what choosing this option does
   *
   * Wraps rather than truncating, so a list that uses it is taller per option. Searching still
   * matches the label alone
   */
  description?: string
}

export interface DropdownOptionGroup {
  label: string
  items: { option: DropdownOption; flatIndex: number }[]
}

export type DropdownCreateLabel = string | ((query: string) => string)
