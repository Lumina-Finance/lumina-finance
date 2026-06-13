import { NavLink } from 'react-router-dom'
import { PRIMARY_NAVIGATION_ITEMS } from '@/components/navigation/constants/data'

/**
 * Renders primary route links and closes mobile navigation after link activation when requested
 */
export function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {PRIMARY_NAVIGATION_ITEMS.map((item) => {
        const Icon = item.icon
        const isSettings = item.to === '/settings'
        return (
          <li key={item.label}>
            {isSettings && (
              <div aria-hidden className="mx-2 my-3 h-px" style={{ background: 'var(--app-border)' }} />
            )}
            <NavLink
              to={item.to}
              end
              onClick={onNavigate}
              className={({ isActive }) =>
                `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}
