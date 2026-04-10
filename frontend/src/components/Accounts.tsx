export default function Accounts() {
  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">My Accounts</h1>
      </header>

      <div className="space-y-6">
        {/* Net Worth statement — headline + assets/debts breakdown */}
        <div className="rounded-2xl h-[6.5rem] bg-gray-300" />

        {/* Metrics band — savings rate / credit usage / cash runway */}
        <div className="grid grid-cols-1 gap-4 grid-cols-3">
          <div className="rounded-2xl h-[8.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[8.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[8.5rem] bg-gray-300" />
        </div>

        {/* Filter row — institution / category / type / tax advantaged */}
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
        </div>

        {/* Debts section */}
        <section className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-7 w-24 rounded bg-gray-300" />
            <div className="flex-1 h-px bg-gray-300" />
            <div className="h-7 w-32 rounded bg-gray-300" />
          </div>
          <div className="space-y-2">
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
          </div>
        </section>

        {/* Assets section */}
        <section className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-7 w-24 rounded bg-gray-300" />
            <div className="flex-1 h-px bg-gray-300" />
            <div className="h-7 w-32 rounded bg-gray-300" />
          </div>
          <div className="space-y-2">
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
          </div>
        </section>

        {/* Add New Account button */}
        <div className="rounded-xl h-12 bg-gray-300" />
      </div>
    </div>
  )
}
