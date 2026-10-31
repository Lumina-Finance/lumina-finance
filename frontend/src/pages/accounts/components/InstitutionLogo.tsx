import type { Institution } from '@/api/institutions'
import { useUsableLogo } from '@/hooks/useUsableLogo'
import { LOGO_PLACEHOLDER_STYLE, resolveInstitutionLogoUrl } from '@/utils/institutionLogo'

type InstitutionLogoProps = {
  institution: Institution | null
  variant?: 'compact' | 'row' | 'detail'
}

const variantClassName = {
  compact: {
    shell: 'h-6 w-6 rounded-md',
    fallback: 'text-xs',
  },
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
export function InstitutionLogo({ institution, variant = 'row' }: InstitutionLogoProps) {
  const logo = useUsableLogo(resolveInstitutionLogoUrl(institution))
  const faviconUrl = logo.src
  const classNames = variantClassName[variant]

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden ${classNames.shell}`}
      style={faviconUrl ? undefined : LOGO_PLACEHOLDER_STYLE}
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
          {...logo.imageProps}
        />
      ) : (
        <span className={`select-none font-semibold ${classNames.fallback}`} style={{ color: 'var(--app-accent)' }}>
          $
        </span>
      )}
    </div>
  )
}
