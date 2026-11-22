/**
 * Names the downloaded archive after the day it was made, in the user's profile timezone
 *
 * @param today - The day as "YYYY-MM-DD"
 */
export function getDataExportFilename(today: string): string {
  return `lumina-finance-export-${today}.zip`
}
