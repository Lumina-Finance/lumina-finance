"""Paging bounds shared by the list endpoints that page"""

# Rows a paged list returns when the caller sends no limit, and the most it returns when one is sent.
# A request that leaves the limit out would otherwise read and send every row, and that count grows
# with whatever anyone has stored
LIST_PAGE_SIZE = 50

# The furthest into a list a request may start. The database reads and discards every row before the
# start, so a start past this is refused instead of walked. A list longer than this is searched, not scrolled
MAX_LIST_OFFSET = 100_000

# Characters of search text a paged list accepts, enough for any name the app stores
LIST_SEARCH_MAX_LENGTH = 200
