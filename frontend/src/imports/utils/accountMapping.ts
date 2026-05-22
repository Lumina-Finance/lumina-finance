export function getResolvedAccountChoice(explicitValue: string | undefined) {
  return explicitValue || ''
}

export function getResolvedAccountCreateType(
  rowId: string,
  accountCreateTypes: Record<string, string>,
) {
  return accountCreateTypes[rowId] || ''
}

export function getResolvedAccountCreateCurrency(
  rowId: string,
  accountCreateCurrencies: Record<string, string>,
) {
  return accountCreateCurrencies[rowId] || ''
}

