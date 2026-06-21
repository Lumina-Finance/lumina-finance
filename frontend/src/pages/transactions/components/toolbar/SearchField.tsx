import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { joinClassNames } from '@/utils/classNames'

type TransactionSearchFieldProps = {
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  mobileSearchStuck: boolean
  desktopInlineLayout: boolean
}

/**
 * Renders the transaction search field with the responsive spacing owned by the sticky toolbar
 */
export function TransactionSearchField({
  search,
  onSearchChange,
  onSearchSubmit,
  mobileSearchStuck,
  desktopInlineLayout,
}: TransactionSearchFieldProps) {
  return (
    <GlassSearchField
      value={search}
      onValueChange={onSearchChange}
      onSubmit={onSearchSubmit}
      placeholder="Search transactions..."
      wrapperClassName={joinClassNames(
        'transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        mobileSearchStuck ? 'max-[1049px]:mr-14' : 'max-[1049px]:mr-0',
        desktopInlineLayout && 'min-[750px]:min-w-80 min-[750px]:flex-1',
      )}
    />
  )
}
