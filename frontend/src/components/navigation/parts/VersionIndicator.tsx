import { ArrowUpRight } from 'lucide-react'
import { CURRENT_APP_VERSION, useAppVersion } from '@/api/version'
import { formatVersionLabel, getCurrentVersionLabel } from '@/components/navigation/utils/labels'

/**
 * Renders the current app version and available-update link in the navigation footer. The collapsed
 * sidebar keeps only the version number, so the product name and update link are split out to fade
 * and collapse away on their own
 */
export function NavigationVersionIndicator() {
  const { data: appVersion } = useAppVersion()
  const version = appVersion?.version ?? CURRENT_APP_VERSION
  const updateNotice = appVersion?.update ?? null
  const currentVersionLabel = getCurrentVersionLabel(version)
  const versionNumber = formatVersionLabel(version)

  return (
    <div className="app-nav-version mt-2 text-center" aria-label={currentVersionLabel}>
      <p className="m-0 truncate text-center text-xs font-normal" style={{ color: 'var(--app-text-subtle)' }}>
        {/* Non-breaking space needed because the inline-block span trims a collapsible trailing space */}
        <span className="app-nav-version-name">Lumina Finance&nbsp;</span>
        <span className="app-nav-version-number">{versionNumber}</span>
      </p>
      {updateNotice && (
        <a
          href={updateNotice.releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="app-nav-version-update mt-1 flex min-h-5 items-center justify-center text-[0.6875rem] font-medium no-underline transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
          style={{ color: 'var(--app-accent)' }}
        >
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
            <span
              className="absolute inline-flex h-3 w-3 animate-ping rounded-full opacity-40 motion-reduce:animate-none"
              style={{ background: 'var(--app-accent)' }}
            />
            <span
              className="relative inline-flex h-2.5 w-2.5 rounded-full"
              style={{ background: 'var(--app-accent)' }}
            />
          </span>
          <span className="app-nav-version-update-text min-w-0 truncate">New version available</span>
          <ArrowUpRight size={12} strokeWidth={2.25} className="app-nav-version-update-icon shrink-0" aria-hidden />
        </a>
      )}
    </div>
  )
}
