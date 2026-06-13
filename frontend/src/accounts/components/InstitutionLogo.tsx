import type { Institution } from '@/api/institutions'

type InstitutionLogoProps = {
  institution: Institution | null
  variant?: 'row' | 'detail'
}

const variantClassName = {
  row: {
    shell: 'h-9 w-9 rounded-lg',
    fallback: 'text-sm',
  },
  detail: {
    shell: 'h-14 w-14 rounded-xl',
    fallback: 'text-xl',
  },
} as const

/**
 * Renders a consistent institution logo slot for account list and detail surfaces
 */
export function InstitutionLogo({
  institution,
  variant = 'row',
}: InstitutionLogoProps) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null
  const classNames = variantClassName[variant]

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden ${classNames.shell}`}
      style={
        faviconUrl
          ? undefined
          : {
              background: 'var(--app-accent-soft)',
              border: '1px solid var(--app-border)',
            }
      }
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <span
          className={`select-none font-semibold ${classNames.fallback}`}
          style={{ color: 'var(--app-accent)' }}
        >
          $
        </span>
      )}
    </div>
  )
}
