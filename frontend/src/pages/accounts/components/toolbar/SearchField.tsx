import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { joinClassNames } from '@/utils/classNames'

type AccountSearchFieldProps = {
  search: string
  onSearchChange: (value: string) => void
  mobileSearchStuck: boolean
  desktopInlineLayout: boolean
}

/**
 * Renders the account search field with the responsive spacing owned by the sticky toolbar. The
 * search filters the list as the user types, so there is no submit action
 */
export function AccountSearchField({
  search,
  onSearchChange,
  mobileSearchStuck,
  desktopInlineLayout,
}: AccountSearchFieldProps) {
  return (
    <GlassSearchField
      value={search}
      onValueChange={onSearchChange}
      placeholder="Search accounts..."
      wrapperClassName={joinClassNames(
        'transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        mobileSearchStuck ? 'max-[1049px]:mr-14' : 'max-[1049px]:mr-0',
        desktopInlineLayout && 'min-[750px]:min-w-80 min-[750px]:flex-1',
      )}
    />
  )
}
