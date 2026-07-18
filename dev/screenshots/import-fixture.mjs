// CSV fixture staged by the import page capture
//
// Every account, category, and merchant value below matches a record the
// demo seed (dev/dev-db/seed_demo_data.py) already creates, so the app's
// auto column mapping and auto matching resolve the whole file without any
// manual dropdown interaction. Corner Espresso is the one deliberately new
// merchant, so the capture also shows the merchant-creation step. Row dates
// are offset back from the pinned day the capture clock is set to, so the
// same seed always produces the same file

const HEADER = 'Account,Date,Category,Amount,Currency,Merchant,Notes,Tags'

const ROWS = [
  { daysAgo: 1, account: 'Everyday Chequing', category: 'Groceries', amount: '-86.42', merchant: 'Golden Pantry', notes: '', tags: '' },
  { daysAgo: 2, account: 'Platinum Rewards Card', category: 'Dining', amount: '-32.80', merchant: 'Noodle Junction', notes: '', tags: '' },
  { daysAgo: 3, account: 'Everyday Chequing', category: 'Public Transit', amount: '-3.35', merchant: 'City Transit', notes: '', tags: '' },
  { daysAgo: 4, account: 'Platinum Rewards Card', category: 'Entertainment', amount: '-16.99', merchant: 'Streamora', notes: 'Monthly plan', tags: 'recurring' },
  { daysAgo: 6, account: 'Everyday Chequing', category: 'Electricity', amount: '-112.38', merchant: 'City Hydro', notes: 'Hydro bill', tags: 'recurring' },
  { daysAgo: 7, account: 'Platinum Rewards Card', category: 'Groceries', amount: '-54.17', merchant: 'Fern Street Market', notes: '', tags: '' },
  { daysAgo: 8, account: 'Everyday Chequing', category: 'Salary', amount: '2450.00', merchant: 'Brightline Studios', notes: 'Semi-monthly pay', tags: '' },
  { daysAgo: 9, account: 'Platinum Rewards Card', category: 'Shopping', amount: '-68.90', merchant: 'Shopporium', notes: '', tags: '' },
  { daysAgo: 10, account: 'Everyday Chequing', category: 'Dining', amount: '-21.65', merchant: 'Corner Espresso', notes: '', tags: '' },
  { daysAgo: 12, account: 'Platinum Rewards Card', category: 'Takeout', amount: '-28.75', merchant: 'Delivery Dash', notes: '', tags: '' },
]

/** Format a date as YYYY-MM-DD from its local calendar fields, the date shape the import column mapping expects */
function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Build the staged-import CSV fixture, with each row's date offset back from the pinned day by its fixed number of days */
export function buildImportCsv(pinnedDay) {
  const lines = ROWS.map((row) => {
    const rowDate = new Date(pinnedDay)
    rowDate.setDate(rowDate.getDate() - row.daysAgo)
    return [row.account, formatDate(rowDate), row.category, row.amount, 'CAD', row.merchant, row.notes, row.tags].join(',')
  })
  return [HEADER, ...lines].join('\n')
}
