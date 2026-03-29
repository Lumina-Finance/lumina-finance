import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navigation from '@/components/Navigation'
import Dashboard from '@/components/Dashboard'

function App() {
  return (
    <BrowserRouter>
      <div
        className="flex min-h-screen"
        style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-text)' }}
      >
        <Navigation />

        <main className="flex-1 px-5 pb-8 pt-6 lg:px-8 lg:pb-12 lg:pt-12">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<PageTitle title="Accounts" />} />
            <Route path="/transactions" element={<PageTitle title="Transactions" />} />
            <Route path="/budgets" element={<PageTitle title="Budgets" />} />
            <Route path="/insights" element={<PageTitle title="Insights" />} />
            <Route path="/settings" element={<PageTitle title="Settings" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

function PageTitle({ title }: { title: string }) {
  return (
    <h1 className="font-serif text-4xl font-light tracking-tight">
      {title}
    </h1>
  )
}

export default App
