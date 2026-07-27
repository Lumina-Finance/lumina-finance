import { useEffect, useRef, type ChangeEvent } from 'react'
import { normalizeMoneyInput, readMoneyInputChange } from '@/utils/moneyInput'

/**
 * Wires a text input to a money value, so an editable amount always reads and writes the one
 * convention the form holds: digits with a period for the decimal point and no grouping
 *
 * @param value - The money value the form holds, which is also what the field displays
 * @param exponent - Decimal places of the field's currency, which the field will not exceed
 * @param onChange - Receives the money value, and the raw text for a caller that reads something
 * else out of it such as a typed sign
 * @param onBlur - The caller's own blur handling, typically validation
 * @returns Props to put on the input
 */
export function useMoneyInput({
  value,
  exponent,
  onChange,
  onBlur,
}: {
  value: string
  exponent: number
  onChange: (value: string, typed?: string) => void
  onBlur?: () => void
}) {
  const previousExponentRef = useRef(exponent)

  // Changing the currency under an amount already entered can leave decimals the new one cannot
  // hold, which would otherwise be silently rounded on save while the field kept showing them
  useEffect(() => {
    if (previousExponentRef.current === exponent) return
    previousExponentRef.current = exponent

    const settled = normalizeMoneyInput(value, exponent)
    if (settled !== value) onChange(settled)
  }, [exponent, value, onChange])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value
    onChange(readMoneyInputChange(value, typed, exponent), typed)
  }

  const handleBlur = () => {
    const settled = normalizeMoneyInput(value, exponent)
    if (settled !== value) onChange(settled)
    onBlur?.()
  }

  return {
    value,
    onChange: handleChange,
    onBlur: handleBlur,
    inputMode: 'decimal' as const,
    type: 'text' as const,
  }
}
