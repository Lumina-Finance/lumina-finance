import {
  useState,
  useRef,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useCallback,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { joinClassNames } from '@/utils/classNames';
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag';
import { DropdownBox } from './Box';
import { DropdownOptionList } from './OptionList';
import { DropdownSearchControls } from './SearchControls';
import { DropdownHead } from './Trigger';
import { canCommitOption, getDropdownKeyAction, getOpeningHighlight } from './keyboard';
import {
  getCreateNewLabel,
  getEffectiveHighlightedIndex,
  getGroupedDropdownOptions,
  getSelectedDropdownOption,
  getVisibleDropdownOptions,
} from './options';
import type { DropdownCreateLabel, DropdownOption, DropdownSize } from './types';
import { useDropdownPosition } from './hooks/usePosition';

export type { DropdownOption } from './types';

interface DropdownProps {
  id?: string;
  options: DropdownOption[];
  selectedOption?: DropdownOption;
  value: string;
  onChange: (value: string) => void;

  /**
   * Classes for how the pill sits among the things around it, and for anything drawn over it, such
   * as the highlight the importer puts on a row it filled in by itself
   *
   * The pill's own height, border, background, radius and padding come from `size`, so a class
   * setting any of those fights it rather than configuring it
   */
  className?: string;

  /** How tall the pill sits, which depends on what surrounds it rather than on what it holds */
  size?: DropdownSize;

  /** Draws the pill in the error state, for a field the form has rejected */
  hasError?: boolean;

  /** Id of the visible label naming this field, since a label element cannot name a button on its own */
  labelledBy?: string;

  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filterOptions?: boolean;
  isLoading?: boolean;
  loadingText?: string;
  loadingMinMs?: number;
  hideOptionsWhileLoading?: boolean;
  autoHighlightFirstOption?: boolean;
  selectHighlightedOnSearchEnter?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onSearchCommit?: (value: string) => void;
  disabled?: boolean;
  blankWhenEmpty?: boolean;
  /** Called when the user clicks the dropdown create action with the current search text */
  onCreateNew?: (query: string) => void;
  createNewLabel?: DropdownCreateLabel;
}

const LOADING_TEXT_MIN_MS = 300;

/**
 * Coordinates dropdown selection, search, keyboard navigation, and floating menu state
 */
const Dropdown = ({
  id,
  options,
  selectedOption,
  value,
  onChange,
  className,
  size = 'field',
  hasError = false,
  labelledBy,
  placeholder = 'Select...',
  searchable = false,
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
  filterOptions = true,
  isLoading = false,
  loadingText = 'Loading...',
  loadingMinMs = LOADING_TEXT_MIN_MS,
  hideOptionsWhileLoading = false,
  autoHighlightFirstOption = false,
  selectHighlightedOnSearchEnter = false,
  hasMore = false,
  onLoadMore,
  onSearchCommit,
  disabled = false,
  blankWhenEmpty = false,
  onCreateNew,
  createNewLabel,
}: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [search, setSearch] = useState('');
  const [collapsedHeight, setCollapsedHeight] = useState<number>();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { boxPosition, updateBoxPosition } = useDropdownPosition({
    open,
    searchable,
    wrapperRef: containerRef,
  });

  const selected = useMemo(
    () => getSelectedDropdownOption(options, selectedOption, value),
    [options, selectedOption, value],
  );
  const emptySelectionIsBlank = blankWhenEmpty && value === '';
  const searchText = searchValue ?? search;
  const heldLoading = useMinimumVisibleFlag(isLoading, loadingMinMs);
  const showLoading = loadingMinMs <= 0 ? isLoading : heldLoading;
  const visibleFiltered = useMemo(
    () => getVisibleDropdownOptions({
      filterOptions,
      hideOptionsWhileLoading,
      options,
      searchable,
      searchText,
      showLoading,
    }),
    [filterOptions, hideOptionsWhileLoading, options, searchable, searchText, showLoading],
  );
  const effectiveHighlightedIndex = getEffectiveHighlightedIndex(
    autoHighlightFirstOption,
    highlightedIndex,
    visibleFiltered.length,
  );
  const groupedFiltered = useMemo(
    () => getGroupedDropdownOptions(visibleFiltered),
    [visibleFiltered],
  );
  const optionDisabled = useMemo(
    () => visibleFiltered.map((option) => Boolean(option.disabled)),
    [visibleFiltered],
  );

  /**
   * Updates controlled or local search text and resets keyboard focus to the first option
   */
  const setSearchText = useCallback((nextSearch: string) => {
    if (searchValue === undefined) setSearch(nextSearch);
    onSearchChange?.(nextSearch);
    setHighlightedIndex(0);
  }, [onSearchChange, searchValue]);

  /**
   * Resets transient menu state whenever the floating list closes
   */
  const close = useCallback(() => {
    setOpen(false);
    setSearchText('');
    setHighlightedIndex(-1);
  }, [setSearchText]);

  // The wrapper holds the collapsed height so the box can grow over what is below it rather than
  // pushing it down. Remeasured when the shown label changes, since that can reflow the head
  useLayoutEffect(() => {
    const head = triggerRef.current;
    if (open || !head) return;
    setCollapsedHeight(head.offsetHeight);
  }, [open, selected?.label, size]);

  // The dropdown closes on outside mouse interactions so stale menus do not remain open. The box is
  // a descendant of this container even while positioned against the viewport, so a press inside it
  // is not an outside press
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  // The highlighted option scrolls into view after keyboard movement so focus stays visible. The list
  // is scrolled by hand rather than through scrollIntoView, which walks up and scrolls every ancestor
  // it can, including the box's own clipped body. That would carry the search field up out of sight
  // and leave it to be found by scrolling back
  useEffect(() => {
    const list = listRef.current;
    if (!open || effectiveHighlightedIndex < 0 || !list) return;

    const item = list.querySelector(`[data-option-index="${effectiveHighlightedIndex}"]`);
    if (!item) return;

    const listBounds = list.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();

    if (itemBounds.top < listBounds.top) {
      list.scrollTop += itemBounds.top - listBounds.top;
    } else if (itemBounds.bottom > listBounds.bottom) {
      list.scrollTop += itemBounds.bottom - listBounds.bottom;
    }
  }, [effectiveHighlightedIndex, open]);

  // The search input receives focus only after the floating menu mounts
  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    close();

    // Closing unmounts the focused option or search input, so return focus to the trigger
    // to keep the user on this field rather than dropping focus back to the modal top
    triggerRef.current?.focus({ preventScroll: true });
  };

  const createQuery = searchText.trim();
  const resolvedCreateNewLabel = getCreateNewLabel(createNewLabel, createQuery);

  const handleCreateNew = () => {
    if (!onCreateNew) return;
    onCreateNew(createQuery);
    close();
  };

  /**
   * Applies the shared keyboard policy to an event from the trigger or the search field
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const action = getDropdownKeyAction({
      fromTrigger: e.currentTarget === triggerRef.current,
      highlightedIndex: effectiveHighlightedIndex,
      key: e.key,
      open,
      optionDisabled,
      selectedIndex: visibleFiltered.findIndex((option) => option.value === value),
    });

    switch (action.kind) {
      case 'none':
        // A key the drop-down ignores still has to be held when letting it through would scroll the
        // page or activate the pill under the open menu
        if (action.swallow) e.preventDefault();
        break;
      case 'open':
        e.preventDefault();
        updateBoxPosition();
        setOpen(true);
        setHighlightedIndex(action.highlightedIndex);
        break;
      case 'move':
        e.preventDefault();
        setHighlightedIndex(action.highlightedIndex);
        break;
      case 'select':
        e.preventDefault();
        handleSelect(visibleFiltered[action.index].value);
        break;
      case 'close':
        // Held here rather than allowed to bubble, so closing a menu inside a modal does not also
        // close the modal behind it, which listens for the same key on the window
        e.stopPropagation();
        close();
        triggerRef.current?.focus({ preventScroll: true });
        break;
    }
  };

  /**
   * Gives search-specific Enter behaviour priority before falling back to menu navigation
   */
  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const canSelectHighlighted = canCommitOption(optionDisabled, effectiveHighlightedIndex);
    if (e.key === 'Enter' && selectHighlightedOnSearchEnter && canSelectHighlighted) {
      e.preventDefault();
      handleSelect(visibleFiltered[effectiveHighlightedIndex].value);
      return;
    }
    if (e.key === 'Enter' && onSearchCommit) {
      e.preventDefault();
      onSearchCommit(searchText);
      setHighlightedIndex(0);
      return;
    }
    handleKeyDown(e);
  };

  /**
   * Opens the menu from the trigger and seeds keyboard focus from the current selected value
   */
  const handleTriggerClick = () => {
    if (disabled) return;
    if (!open) {
      updateBoxPosition();
      // Opened by mouse, the highlight is seeded exactly as the keyboard seeds it, so a menu opened
      // either way starts on the same option
      setHighlightedIndex(getOpeningHighlight(
        optionDisabled,
        visibleFiltered.findIndex((option) => option.value === value),
      ));
      setOpen(true);

      // Some browsers do not focus a button when it is clicked, which would leave Escape landing on
      // the page instead of on this field, where the modal behind would answer it and close
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }
    close();
  };

  /**
   * Requests the next page when the user scrolls close to the end of an incremental dropdown list
   */
  const handleListScroll = (e: UIEvent<HTMLUListElement>) => {
    if (!hasMore || isLoading || !onLoadMore) return;
    const target = e.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom) onLoadMore();
  };

  return (
    <div
      ref={containerRef}
      className={joinClassNames('relative', className)}
      style={{ height: collapsedHeight }}
    >
      <DropdownBox
        boxRef={boxRef}
        disabled={disabled}
        hasError={hasError}
        open={open}
        position={boxPosition}
      >
        <DropdownHead
          headRef={triggerRef}
          id={id}
          disabled={disabled}
          emptySelectionIsBlank={emptySelectionIsBlank}
          labelledBy={labelledBy}
          listId={listId}
          open={open}
          placeholder={placeholder}
          selected={selected}
          size={size}
          onClick={handleTriggerClick}
          onKeyDown={handleKeyDown}
        />

        <div className="app-dropdown-bodywrap">
          <div className="app-dropdown-body">
            <div className="app-dropdown-glass-inner">
              {searchable && (
                <DropdownSearchControls
                  createNewLabel={resolvedCreateNewLabel}
                  searchPlaceholder={searchPlaceholder}
                  searchRef={searchRef}
                  searchText={searchText}
                  showCreateAction={Boolean(onCreateNew)}
                  onCreateNew={handleCreateNew}
                  onKeyDown={handleSearchKeyDown}
                  onSearchChange={setSearchText}
                />
              )}
              <DropdownOptionList
                effectiveHighlightedIndex={effectiveHighlightedIndex}
                groupedOptions={groupedFiltered}
                listId={listId}
                listMaxHeight={boxPosition.listMaxHeight}
                listRef={listRef}
                loadingText={loadingText}
                options={visibleFiltered}
                selectedValue={value}
                showLoading={showLoading}
                onHighlight={setHighlightedIndex}
                onScroll={handleListScroll}
                onSelect={handleSelect}
              />
            </div>
          </div>
        </div>
      </DropdownBox>
    </div>
  );
};

export default Dropdown;
