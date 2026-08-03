export interface DropdownOption {
  value: string
  label: string
  group?: string
  icon?: string | null

  /** Short qualifier shown as a pill beside the label, for a caveat the label itself should not carry */
  badge?: string

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

