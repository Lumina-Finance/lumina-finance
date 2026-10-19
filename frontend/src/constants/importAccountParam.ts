// Carries the account an import was started from, as a query parameter rather than router state so
// the scope survives a reload and a shared address. The account detail page writes it and the import
// page reads it, so it lives here rather than in either page
export const IMPORT_ACCOUNT_PARAM = 'account'
