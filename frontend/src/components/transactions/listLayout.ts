// The five content tracks a transaction list lays its rows out on from 750px wide, so every row's
// cells line up down the list: category icon, category and merchant, account, the note with the tags,
// and amount. The category, merchant and account tracks fit their widest entry first, truncating only
// when the row can't hold them, and the note and tags take what they leave, but never less than the
// two icons they fall back to
export const TRANSACTION_LIST_COLUMNS =
  'min-[750px]:grid min-[750px]:gap-x-3 min-[1300px]:gap-x-4 min-[750px]:grid-cols-[2.75rem_minmax(0,max-content)_minmax(0,max-content)_minmax(3.5rem,1fr)_max-content]'

// Puts a wrapper inside a transaction list on the list's own column tracks, so the rows within it line up
// with every other row. From 750px only, which is where the list lays its rows out as a grid
export const TRANSACTION_LIST_SUBGRID = 'min-[750px]:col-span-full min-[750px]:grid min-[750px]:grid-cols-subgrid'
