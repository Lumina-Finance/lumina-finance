export interface DropdownOption {
  value: string
  label: string
  group?: string
  icon?: string | null
}

export interface DropdownOptionGroup {
  label: string
  items: { option: DropdownOption; flatIndex: number }[]
}

export type DropdownCreateLabel = string | ((query: string) => string)

