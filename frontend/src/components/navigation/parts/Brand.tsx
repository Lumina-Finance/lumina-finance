/**
 * Renders the Lumina Finance brand lockup used by desktop and mobile navigation
 */
export function NavigationBrand() {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="app-nav-lead">
        <img
          src="/logo.png"
          alt=""
          aria-hidden="true"
          className="app-nav-brand-logo shrink-0 object-contain"
        />
      </span>
      <div className="app-nav-brand-text min-w-0">
        <h1 className="font-serif text-[1.85rem] font-medium leading-none tracking-normal">
          Lumina
        </h1>
        <p
          className="ml-0.5 mt-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.24em]"
          style={{ color: 'var(--app-accent)' }}
        >
          Finance
        </p>
      </div>
    </div>
  )
}

