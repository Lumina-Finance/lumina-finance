export interface DropdownOption {
  value: string
  label: string
  group?: string
  icon?: string | null

  /** Short qualifier shown as a pill beside the label, for a caveat the label itself should not carry */
  badge?: string
}

export interface DropdownOptionGroup {
  label: string
  items: { option: DropdownOption; flatIndex: number }[]
}

export type DropdownCreateLabel = string | ((query: string) => string)

