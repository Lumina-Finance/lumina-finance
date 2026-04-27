import { Plus } from 'lucide-react'

export default function Budgets() {
  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">Budgets</h1>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <p className="app-page-description">
            Plan ahead and keep your spending in check.
          </p>
          <button type="button" className="app-primary-button" disabled>
            <Plus size={18} aria-hidden />
            New Budget
          </button>
        </div>
      </header>

      <section
        className="rounded-2xl p-6"
        style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
              No budgets to display
            </p>
            <p className="mt-1 max-w-xl text-sm leading-6" style={{ color: 'var(--app-text-subtle)' }}>
              Create a budget to start tracking limits, spending, and category progress.
            </p>
          </div>

          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: 'var(--app-input-bg)', border: '1px solid var(--app-input-border)' }}
            aria-hidden
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="h-3 w-28 rounded-full" style={{ background: 'var(--app-border)' }} />
                <div className="mt-3 h-4 w-24 rounded-full" style={{ background: 'var(--app-border)' }} />
              </div>
              <div className="h-7 w-20 rounded-full" style={{ background: 'var(--app-accent-soft)' }} />
            </div>
            <div className="mt-6">
              <div className="h-8 w-36 rounded-md" style={{ background: 'var(--app-border)' }} />
              <div className="mt-3 h-2 rounded-full" style={{ background: 'var(--app-border)' }}>
                <div className="h-full w-2/5 rounded-full" style={{ background: 'var(--app-accent)' }} />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center justify-between gap-4">
                  <div className="h-3 w-24 rounded-full" style={{ background: 'var(--app-border)' }} />
                  <div className="h-3 w-16 rounded-full" style={{ background: 'var(--app-border)' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
