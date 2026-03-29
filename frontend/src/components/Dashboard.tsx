export default function Dashboard() {
  const hour = new Date().getHours()
  const greeting =
    hour >= 1 && hour < 4 ? 'Still Up?' :
    hour < 12 ? 'Good Morning' :
    hour < 17 ? 'Good Afternoon' :
    'Good Evening'
  const subtitle =
    hour >= 1 && hour < 4
      ? 'Your finances can wait, your sleep can\u2019t.'
      : 'Here is your financial overview.'

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title font-medium lg:font-normal">
          {greeting}
        </h1>
        <p className="app-page-description">{subtitle}</p>
      </header>

      <div className="space-y-6">
        {/* Row 1 — Hero metric strip */}
        <div className="grid grid-cols-1 gap-4 grid-cols-4">
          <div className="rounded-2xl h-[12.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[12.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[12.5rem] bg-gray-300" />
          <div className="rounded-2xl h-[12.5rem] bg-gray-300" />
        </div>

        {/* Row 2 — Charts */}
        <div className="grid grid-cols-1 gap-6 grid-cols-2">
          <div className="rounded-2xl h-[420px] bg-gray-300" />
          <div className="rounded-2xl h-[420px] bg-gray-300" />
        </div>

        {/* Row 3 — Quick insight cards */}
        <div className="grid grid-cols-1 gap-4 grid-cols-4">
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
          <div className="rounded-2xl h-[320px] bg-gray-300" />
        </div>
      </div>
    </div>
  )
}
