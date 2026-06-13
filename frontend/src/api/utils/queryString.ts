export type QueryStringValue = string | number | boolean | null | undefined;

/**
 * Builds a URL query suffix from optional API parameters
 */
export function buildQueryString(params: Record<string, QueryStringValue>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number | boolean] => {
      const value = entry[1];
      return value !== undefined && value !== null && value !== '';
    },
  );

  if (entries.length === 0) return '';

  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}
