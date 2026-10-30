type LoadingQuery = {
  data: unknown
  isFetching: boolean
  isError: boolean
  isPlaceholderData?: boolean
}

/**
 * Whether a query's loading animation should show, which is only while it is fetching with nothing
 * of its own to put on screen
 *
 * A fetch that only refreshes data already held updates it in place, since hiding what the reader
 * can already see makes the page look as if it loaded twice. Data held from another query's key and
 * a failure being retried are not on screen as this query's answer, so they still count as nothing
 */
export function isLoadingFirstAnswer({ data, isFetching, isError, isPlaceholderData = false }: LoadingQuery) {
  return isFetching && (data === undefined || isError || isPlaceholderData)
}
