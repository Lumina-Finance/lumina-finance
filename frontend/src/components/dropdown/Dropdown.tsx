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
import { motion, useReducedMotion } from 'motion/react';
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag';
import { DropdownBox } from './Box';
import {
  DROPDOWN_INSTANT_TRANSITION,
  DROPDOWN_RISE_DISTANCE,
  DROPDOWN_RISE_TRANSITION,
  DROPDOWN_SINK_TRANSITION,
} from './motion';
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
   * Classes for how the control sits among the things around it, and for anything drawn over it,
   * such as the highlight the importer puts on a row it filled in by itself
   *
   * Its own height, border, background, radius and padding come from `size`, so a class setting any
   * of those fights it rather than configuring it
   */
  className?: string;

  /** How tall the control sits, which depends on what surrounds it rather than on what it holds */
  size?: DropdownSize;

  /** Draws the control in the error state, for a field the form has rejected */
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
 * Coordinates dropdown selection, search, keyboard navigation, and whether the box is open
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
  const [collapsing, setCollapsing] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const placed = open || collapsing;

  // Closing runs quicker than opening, so the list is gone before whatever holds it can be
  const collapseTransition = shouldReduceMotion
    ? DROPDOWN_INSTANT_TRANSITION
    : open ? DROPDOWN_RISE_TRANSITION : DROPDOWN_SINK_TRANSITION;
  const { boxPosition, updateBoxPosition } = useDropdownPosition({
    placed,
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
   * Resets transient menu state whenever the list closes
   */
  const close = useCallback(() => {
    setOpen(false);
    setSearchText('');
    setHighlightedIndex(-1);

    // The box holds its open placement until the collapse finishes. Dropping back to its slot on the
    // closing frame would move a box that grew upward to the other side of the head, and snap its
    // width back, while the list is still visibly collapsing. Nothing to wait for when the collapse
    // is instant, and no transition to end either, so the wait is skipped entirely
    if (!shouldReduceMotion) setCollapsing(true);
  }, [setSearchText, shouldReduceMotion]);

  // The slot holds the collapsed height so the box can grow over what is below it rather than pushing
  // it down. Measured from the box rather than the head inside it, since the box's own border is part
  // of what the slot has to hold, and watched rather than measured once: a control that mounts inside
  // a hidden branch, which the settings list does for whichever of its two layouts is not showing,
  // measures nothing until that branch is shown
  useLayoutEffect(() => {
    const box = boxRef.current;

    // Only while the box is back in its slot. Through the collapse it is still floating and still
    // most of the way open, so measuring it then would pin the slot to the open height and push
    // everything below it down, which a modal that animates its own height follows by growing
    if (placed || !box) return;

    const measure = () => {
      const height = box.offsetHeight;
      if (height > 0) setCollapsedHeight(height);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [placed, size]);

  // The dropdown closes on outside mouse interactions so stale menus do not remain open. The box is
  // a descendant of this container even while positioned against the viewport, so a press inside it
  // is not an outside press
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      const container = containerRef.current;
      const target = e.target;
      if (!container || !(target instanceof Element) || container.contains(target)) return;

      // The field's own visible label sits outside this container but points at the head inside it,
      // and a label's job is to repeat the click on what it names. Closing here would be undone a
      // moment later by that repeat, which reaches a list this handler has already closed and opens
      // it again. Left alone, the repeat arrives at the head and closes the list once, exactly as
      // pressing the head does
      if (id && target.closest('label')?.htmlFor === id) return;

      close();
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [close, id, open]);

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

  // The search input receives focus only once the box has opened around it
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
        // page or activate the head under the open list
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
      className={joinClassNames('app-dropdown-slot', className)}
      style={{ height: collapsedHeight }}
    >
      <DropdownBox
        boxRef={boxRef}
        disabled={disabled}
        hasError={hasError}
        open={open}
        placed={placed}
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

        {/* Held out of reach while the box is shut, and gone entirely once it has finished shutting.
            A clipped list is still a list: its options stay in the accessibility tree and its search
            field and create action stay in the page's tab order, so a modal holding four closed
            drop-downs would put eight invisible stops between its first field and its save button */}
        <div
          className="app-dropdown-bodywrap"
          inert={open ? undefined : true}
          onTransitionEnd={(event) => {
            // Only the height, since the contents inside it finish their own rise separately
            if (event.propertyName === 'grid-template-rows') setCollapsing(false);
          }}
        >
          <div className="app-dropdown-body">
            {/* Built only while it is being looked at, and kept through the collapse so the box has
                something to shrink around. An import table renders four of these per row, so holding
                every currency in the page for every row costs a great deal for nothing */}
            {placed && (
              <motion.div
                className="app-dropdown-glass-inner"
                initial={{ opacity: 0, y: DROPDOWN_RISE_DISTANCE }}
                animate={open ? { opacity: 1, y: 0 } : { opacity: 0, y: DROPDOWN_RISE_DISTANCE }}
                transition={collapseTransition}
              >
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
              </motion.div>
            )}
          </div>
        </div>
      </DropdownBox>
    </div>
  );
};

export default Dropdown;
