import { useState, useRef, useEffect, useId, useMemo, useCallback, type KeyboardEvent, type UIEvent } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag';
import { DropdownOptionList } from './OptionList';
import { DropdownPanel } from './Panel';
import { DropdownSearchControls } from './SearchControls';
import { DropdownTrigger } from './Trigger';
import { getDropdownKeyAction } from './keyboard';
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

  /** Layout classes only, since the pill carries its own look */
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
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { listPosition, updateListPosition } = useDropdownPosition({ open, searchable, triggerRef });

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

  // The dropdown closes on outside mouse interactions so stale menus do not remain open. The menu is
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

  // The highlighted option scrolls into view after keyboard movement so focus stays visible
  useEffect(() => {
    if (!open || effectiveHighlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector(`[data-option-index="${effectiveHighlightedIndex}"]`) as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
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
      case 'open':
        e.preventDefault();
        updateListPosition();
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
    const canSelectHighlighted = effectiveHighlightedIndex >= 0 && effectiveHighlightedIndex < visibleFiltered.length;
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
      updateListPosition();
      setHighlightedIndex(options.findIndex((o) => o.value === value));
      setOpen(true);
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
    <div ref={containerRef} className="relative">
      <DropdownTrigger
        triggerRef={triggerRef}
        id={id}
        className={className}
        disabled={disabled}
        emptySelectionIsBlank={emptySelectionIsBlank}
        hasError={hasError}
        labelledBy={labelledBy}
        listId={listId}
        open={open}
        placeholder={placeholder}
        selected={selected}
        size={size}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
      />

      <AnimatePresence>
        {open && (
          <DropdownPanel position={listPosition}>
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
              listMaxHeight={listPosition.listMaxHeight}
              listRef={listRef}
              loadingText={loadingText}
              options={visibleFiltered}
              selectedValue={value}
              showLoading={showLoading}
              onHighlight={setHighlightedIndex}
              onScroll={handleListScroll}
              onSelect={handleSelect}
            />
          </DropdownPanel>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dropdown;
