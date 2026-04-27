import { useMemo, useState } from 'react'
import { Check, Plus, Search, TriangleAlert, X } from 'lucide-react'
import {
  useCreateBaseBudget,
  useCreateBudgetInstance,
  type RecurrenceFreq,
} from '@/api/budgets'
import { useCategories, type Category } from '@/api/categories'
import { useCurrencies, type Currency } from '@/api/currency'
import { useAuth } from '@/hooks/useAuth'
import Dropdown from '@/components/Dropdown'

interface BudgetFormState {
  name: string
  currency: string
  categoryIds: string[]
  limit: string
  recurrenceFreq: RecurrenceFreq
  instanceLength: string
  periodStart: string
  recurs: boolean
}

interface CalendarDate {
  year: number
  month: number
  day: number
}

const RECURRENCE_OPTIONS: Array<{ value: RecurrenceFreq; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function todayYmd(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((currency) => currency.id === code)?.symbol ?? ''
}

function sanitizeMoneyInput(value: string) {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

function formatMoneyInputLive(value: string) {
  if (!value.trim()) return value
  const [integerPart, decimalPart] = value.split('.', 2)
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0'
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger
}

function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const numberValue = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return Math.round(numberValue * Math.pow(10, currencyExponent(currencies, code)))
}

function recurrenceAnchorsFromStart(freq: RecurrenceFreq, periodStart: string) {
  const { year, month, day } = parseYmd(periodStart)
  const start = new Date(year, month - 1, day)
  const weekday = (start.getDay() + 6) % 7

  if (freq === 'weekly') {
    return { recurrence_weekday: weekday, recurrence_dom: null, recurrence_month: null }
  }

  if (freq === 'monthly') {
    return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: null }
  }

  return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: month }
}

function parseYmd(ymd: string): CalendarDate {
  const [year, month, day] = ymd.split('-').map(Number)
  return { year, month, day }
}

function formatCalendarDate(date: CalendarDate) {
  return new Date(date.year, date.month - 1, date.day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const result = new Date(date.year, date.month - 1, date.day + days)
  return {
    year: result.getFullYear(),
    month: result.getMonth() + 1,
    day: result.getDate(),
  }
}

function anchorDay(year: number, month: number, day: number) {
  return Math.min(day, new Date(year, month, 0).getDate())
}

function addMonths(date: CalendarDate, months: number): CalendarDate {
  const totalMonths = date.year * 12 + (date.month - 1) + months
  const year = Math.floor(totalMonths / 12)
  const month = totalMonths % 12 + 1
  return { year, month, day: anchorDay(year, month, date.day) }
}

function oneOffPeriodEnd(form: BudgetFormState): CalendarDate {
  const start = parseYmd(form.periodStart)

  if (form.recurrenceFreq === 'weekly') {
    return addDays(start, 6)
  }

  if (form.recurrenceFreq === 'monthly') {
    return addDays(addMonths(start, 1), -1)
  }

  return addDays({ year: start.year + 1, month: start.month, day: anchorDay(start.year + 1, start.month, start.day) }, -1)
}

function cadenceSummary(form: BudgetFormState) {
  const length = Number(form.instanceLength)
  const safeLength = Number.isFinite(length) && length > 0 ? length : 1
  const name = form.name.trim() || 'Untitled'

  if (!form.recurs) {
    if (!form.periodStart) return `"${name}" is a one-off budget`
    return `"${name}" is a one-off budget starting ${formatCalendarDate(parseYmd(form.periodStart))} and ending ${formatCalendarDate(oneOffPeriodEnd(form))}`
  }

  let cadence: string
  if (form.recurrenceFreq === 'weekly') {
    cadence = safeLength === 1 ? 'weekly' : `every ${safeLength} weeks`
  } else if (form.recurrenceFreq === 'monthly') {
    cadence = safeLength === 1 ? 'monthly' : `every ${safeLength} months`
  } else {
    cadence = safeLength === 1 ? 'yearly' : `every ${safeLength} years`
  }

  return `"${name}" will repeat ${cadence} starting ${form.periodStart ? formatCalendarDate(parseYmd(form.periodStart)) : 'the selected start date'}`
}

function BudgetCreateModal({
  categories,
  currencies,
  defaultCurrency,
  timeZone,
  onClose,
  onCreated,
}: {
  categories: Category[]
  currencies: Currency[]
  defaultCurrency: string
  timeZone: string
  onClose: () => void
  onCreated: () => void
}) {
  const createBaseBudget = useCreateBaseBudget()
  const createBudget = useCreateBudgetInstance()
  const expenseCategories = useMemo(
    () => categories.filter((category) => category.kind === 'expense' && category.group_id === null),
    [categories],
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [categorySearch, setCategorySearch] = useState('')
  const [form, setForm] = useState<BudgetFormState>({
    name: '',
    currency: defaultCurrency,
    categoryIds: [],
    limit: '',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: todayYmd(timeZone),
    recurs: true,
  })

  const isPending = createBaseBudget.isPending || createBudget.isPending
  const selectedCurrency = currencies.find((currency) => currency.id === form.currency)
  const selectedCurrencySymbol = currencySymbol(currencies, form.currency)
  const filteredExpenseCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    if (!query) return expenseCategories
    return expenseCategories.filter((category) => category.name.toLowerCase().includes(query))
  }, [categorySearch, expenseCategories])
  const currencyOptions = useMemo(
    () => currencies.map((currency) => ({
      value: currency.id,
      label: `${currency.id} · ${currency.name}`,
    })),
    [currencies],
  )

  const setField = <K extends keyof BudgetFormState>(key: K, value: BudgetFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const limitMinorUnits = toMinorUnits(form.limit, currencies, form.currency)
  const instanceLength = form.recurs ? Number(form.instanceLength) : 1
  const hasSelectedExpenseCategory = form.categoryIds.some((categoryId) =>
    expenseCategories.some((category) => category.id === categoryId),
  )
  const canCreate =
    !isPending
    && form.name.trim().length > 0
    && !!selectedCurrency
    && limitMinorUnits !== null
    && !!form.periodStart
    && hasSelectedExpenseCategory
    && (!form.recurs || (Number.isInteger(instanceLength) && instanceLength >= 1))

  const toggleCategory = (categoryId: string) => {
    setForm((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    if (!form.name.trim()) {
      setFormError('Name is required.')
      return
    }
    if (!selectedCurrency) {
      setFormError('Select a currency.')
      return
    }
    if (limitMinorUnits === null) {
      setFormError('Limit must be greater than zero.')
      return
    }
    if (!form.periodStart) {
      setFormError('Choose a period start.')
      return
    }
    if (form.recurs && (!Number.isInteger(instanceLength) || instanceLength < 1)) {
      setFormError('Interval must be at least 1.')
      return
    }
    if (!hasSelectedExpenseCategory) {
      setFormError('Select at least one category.')
      return
    }

    try {
      const baseBudget = await createBaseBudget.mutateAsync({
        name: form.name.trim(),
        currency: form.currency,
        recurrence_freq: form.recurrenceFreq,
        instance_length: instanceLength,
        ...recurrenceAnchorsFromStart(form.recurrenceFreq, form.periodStart),
        recurs: form.recurs,
        category_ids: form.categoryIds,
      })
      await createBudget.mutateAsync({
        baseBudgetId: baseBudget.id,
        period_start: form.periodStart,
        overall_limit: limitMinorUnits,
      })
      onCreated()
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create budget.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 14, 12, 0.56)' }}
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-create-title"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-8"
        style={{
          background: 'var(--app-bg)',
          border: '1px solid var(--app-border-strong)',
          boxShadow: 'var(--app-shadow-soft)',
        }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="mb-8 flex items-center justify-between">
          <h2
            id="budget-create-title"
            className="font-serif text-3xl font-light tracking-tight"
          >
            Create Budget
          </h2>
          <button type="button" className="app-icon-button" aria-label="Close budget form" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="budget-name" className="app-label mb-1.5 block">Name</label>
              <input
                id="budget-name"
                className="app-input"
                placeholder="e.g. Groceries"
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                required
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <label className="app-label block">Currency</label>
                <div className="group relative inline-flex">
                  <TriangleAlert
                    size={17}
                    strokeWidth={2.75}
                    aria-label="Budget currency limitation"
                    className="cursor-help"
                    style={{ color: 'var(--app-negative)' }}
                  />
                  <div
                    className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-52 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
                    style={{
                      background: 'var(--app-bg)',
                      border: '1px solid var(--app-border-strong)',
                      color: 'var(--app-text)',
                    }}
                  >
                    Budgets currently track only accounts in the same currency.
                  </div>
                </div>
              </div>
              <Dropdown
                options={currencyOptions}
                value={form.currency}
                onChange={(value) => setField('currency', value)}
                placeholder={currencies.length === 0 ? 'Loading currencies...' : 'Select currency...'}
                searchable
                searchPlaceholder="Search currencies..."
              />
            </div>

            <div>
              <label htmlFor="budget-limit" className="app-label mb-1.5 block">Limit</label>
              <div className="relative">
                {selectedCurrencySymbol && (
                  <span
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {selectedCurrencySymbol}
                  </span>
                )}
                <input
                  id="budget-limit"
                  className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.limit}
                  onChange={(event) => setField('limit', formatMoneyInputLive(sanitizeMoneyInput(event.target.value)))}
                  required
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)] md:items-end">
                <div>
                  <span className="app-label mb-1.5 block">Type</span>
                  <div className="app-segmented-control w-full">
                    <button
                      type="button"
                      className={`app-segmented-option flex-1 text-sm ${form.recurs ? 'app-segmented-option-active' : ''}`}
                      onClick={() => setField('recurs', true)}
                    >
                      Recurring
                    </button>
                    <button
                      type="button"
                      className={`app-segmented-option flex-1 text-sm ${!form.recurs ? 'app-segmented-option-active' : ''}`}
                      onClick={() => setForm((current) => ({ ...current, recurs: false, instanceLength: '1' }))}
                    >
                      Once
                    </button>
                  </div>
                </div>

                <div>
                  <label className="app-label mb-1.5 block">Frequency</label>
                  <div className="app-segmented-control w-full">
                    {RECURRENCE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`app-segmented-option flex-1 text-sm ${form.recurrenceFreq === option.value ? 'app-segmented-option-active' : ''}`}
                        onClick={() => setField('recurrenceFreq', option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="budget-interval" className="app-label mb-1.5 block">Period length</label>
              <input
                id="budget-interval"
                className="app-input disabled:cursor-not-allowed disabled:opacity-50"
                inputMode="numeric"
                value={form.recurs ? form.instanceLength : '1'}
                onChange={(event) => setField('instanceLength', event.target.value.replace(/\D/g, ''))}
                disabled={!form.recurs}
                required={form.recurs}
              />
            </div>

            <div>
              <label htmlFor="budget-period-start" className="app-label mb-1.5 block">Period start</label>
              <input
                id="budget-period-start"
                className="app-input"
                type="date"
                value={form.periodStart}
                onChange={(event) => setField('periodStart', event.target.value)}
                required
              />
            </div>

            <p className="text-center text-[0.9375rem] italic md:col-span-2" style={{ color: 'var(--app-text-muted)' }}>
              {cadenceSummary(form)}
            </p>
          </div>

          <section>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="app-label">Categories</h3>
                <p className="mt-1 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Pick the spending categories this budget should track.
                </p>
              </div>
              <span className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                {form.categoryIds.length} selected
              </span>
            </div>
            <div className="relative mt-3">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                placeholder="Search categories..."
              />
            </div>
            <div
              className="mt-3 max-h-60 space-y-1 overflow-y-auto rounded-xl p-1"
              style={{ border: '1px solid var(--app-input-border)', background: 'var(--app-input-bg)' }}
            >
              {filteredExpenseCategories.map((category) => {
                const selected = form.categoryIds.includes(category.id)
                return (
                  <button
                    key={category.id}
                    type="button"
                    className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150"
                    style={{
                      background: selected ? 'var(--app-accent-soft)' : 'transparent',
                      border: `1px solid ${selected ? 'var(--app-accent)' : 'transparent'}`,
                      color: selected ? 'var(--app-text)' : 'var(--app-text-muted)',
                      fontWeight: selected ? 600 : 400,
                    }}
                    onClick={() => toggleCategory(category.id)}
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full"
                      style={{
                        background: selected ? 'var(--app-accent)' : 'var(--app-bg)',
                        border: `1px solid ${selected ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
                        color: selected ? 'var(--app-bg)' : 'transparent',
                      }}
                    >
                      <Check size={13} strokeWidth={3} aria-hidden />
                    </span>
                    <span className="truncate">{category.name}</span>
                  </button>
                )
              })}
              {expenseCategories.length > 0 && filteredExpenseCategories.length === 0 && (
                <p className="px-3 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  No matching categories.
                </p>
              )}
            </div>
            {expenseCategories.length === 0 && (
              <p className="mt-3 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                Create an expense category before adding a budget.
              </p>
            )}
          </section>

          {formError && (
            <p className="text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
              {formError}
            </p>
          )}

          <div
            className="flex items-center justify-end gap-3 pt-4"
            style={{ borderTop: '1px solid var(--app-border)' }}
          >
            <button type="button" className="app-secondary-button" onClick={onClose} disabled={isPending}>
              Cancel
            </button>
            <button
              type="submit"
              className={`app-primary-button ${isPending ? 'app-primary-button-loading' : ''}`}
              disabled={!canCreate}
            >
              {isPending ? <div className="app-spinner" /> : 'Create Budget'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function Budgets() {
  const { user } = useAuth()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const { data: currencies, isLoading: currenciesLoading } = useCurrencies()
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState(false)
  const defaultCurrency = user?.base_currency ?? currencies?.[0]?.id ?? 'USD'

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">Budgets</h1>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <p className="app-page-description">
            Plan ahead and keep your spending in check.
          </p>
          <button type="button" className="app-primary-button" onClick={() => setCreateOpen(true)}>
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
              {created
                ? 'Budget created. Create another one or continue with the next setup step.'
                : 'Create a budget to start tracking limits, spending, and category progress.'}
            </p>
            {(categoriesLoading || currenciesLoading) && (
              <p className="mt-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                Loading form options...
              </p>
            )}
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

      {createOpen && (
        <BudgetCreateModal
          categories={categories ?? []}
          currencies={currencies ?? []}
          defaultCurrency={defaultCurrency}
          timeZone={user?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreated(true)}
        />
      )}
    </div>
  )
}
