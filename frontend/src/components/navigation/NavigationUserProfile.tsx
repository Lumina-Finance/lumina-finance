import { LogOut } from 'lucide-react'

interface NavigationUserProfileProps {
  displayName: string
  initials: string
  logout: () => Promise<void>
}

/**
 * Renders the authenticated user row and logout action in the navigation footer
 */
export function NavigationUserProfile({
  displayName,
  initials,
  logout,
}: NavigationUserProfileProps) {
  return (
    <div
      className="app-nav-link"
      style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{
          background: 'linear-gradient(135deg, #C9A96A 0%, #9B6C2C 100%)',
          color: '#1C1510',
        }}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          {displayName}
        </p>
        <p className="truncate text-[0.6875rem]" style={{ color: 'var(--app-text-subtle)' }}>
          Premium Plan
        </p>
      </div>
      <button
        type="button"
        onClick={() => { void logout() }}
        aria-label="Log out"
        className="app-icon-button shrink-0"
      >
        <LogOut size={14} aria-hidden />
      </button>
    </div>
  )
}

