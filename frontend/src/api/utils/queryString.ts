export type QueryStringValue = string | number | boolean | null | undefined | string[];

/**
 * Builds a URL query suffix from optional API parameters, emitting one repeated key per item for
 * array values so multi-value filters reach the backend as a list rather than a joined string
 */
export function buildQueryString(params: Record<string, QueryStringValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== '') search.append(key, item);
      }
      continue;
    }
    search.append(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
