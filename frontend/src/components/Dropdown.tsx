import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus } from 'lucide-react';
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag';
import {
  getCreateNewLabel,
  getEffectiveHighlightedIndex,
  getGroupedDropdownOptions,
  getSelectedDropdownOption,
  getVisibleDropdownOptions,
} from './dropdown/dropdownOptions';
import type { DropdownCreateLabel, DropdownOption } from './dropdown/types';
import { useDropdownPosition } from './dropdown/useDropdownPosition';

export type { DropdownOption } from './dropdown/types';

interface DropdownProps {
  id?: string;
  options: DropdownOption[];
  selectedOption?: DropdownOption;
  value: string;
  onChange: (value: string) => void;
  className?: string;
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

const Dropdown = ({
  id,
  options,
  selectedOption,
  value,
  onChange,
  className = 'app-input',
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

  const setSearchText = useCallback((nextSearch: string) => {
    if (searchValue === undefined) setSearch(nextSearch);
    onSearchChange?.(nextSearch);
    setHighlightedIndex(0);
  }, [onSearchChange, searchValue]);

  const close = useCallback(() => {
    setOpen(false);
    setSearchText('');
    setHighlightedIndex(-1);
  }, [setSearchText]);

  // Close on outside click
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

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || effectiveHighlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector(`[data-option-index="${effectiveHighlightedIndex}"]`) as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [effectiveHighlightedIndex, open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    close();
  };

  const createQuery = searchText.trim();
  const resolvedCreateNewLabel = getCreateNewLabel(createNewLabel, createQuery);

  const handleCreateNew = () => {
    if (!onCreateNew) return;
    onCreateNew(createQuery);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          updateListPosition();
          setOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((i) => Math.min(i + 1, visibleFiltered.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (open && effectiveHighlightedIndex >= 0 && effectiveHighlightedIndex < visibleFiltered.length) {
          handleSelect(visibleFiltered[effectiveHighlightedIndex].value);
        } else if (!open) {
          updateListPosition();
          setOpen(true);
          setHighlightedIndex(visibleFiltered.findIndex((o) => o.value === value));
        }
        break;
      case 'Escape':
        close();
        break;
    }
  };

  const handleListScroll = (e: React.UIEvent<HTMLUListElement>) => {
    if (!hasMore || isLoading || !onLoadMore) return;
    const target = e.currentTarget;
    const nearBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 24;
    if (nearBottom) onLoadMore();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        className={`${className} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={() => {
          if (disabled) return;
          if (!open) {
            updateListPosition();
            setHighlightedIndex(options.findIndex((o) => o.value === value));
          } else {
            close();
            return;
          }
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      >
        <span
          className="flex min-w-0 flex-1 items-center gap-2"
          style={{ color: selected && !emptySelectionIsBlank ? 'var(--app-text)' : 'var(--app-text-subtle)' }}
        >
          {selected?.icon && !emptySelectionIsBlank && (
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {selected.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{emptySelectionIsBlank ? '' : selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform duration-200"
          style={{
            color: 'var(--app-text-subtle)',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
          }}
          aria-hidden
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed z-50 rounded-xl"
            style={{
              top: listPosition.top,
              left: listPosition.left,
              width: listPosition.width,
              maxHeight: listPosition.menuMaxHeight,
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-border-strong)',
              boxShadow: 'var(--app-shadow-soft)',
              backdropFilter: 'blur(16px)',
            }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {searchable && (
              <div className="flex gap-2 px-2 pb-2 pt-2">
                <input
                  ref={searchRef}
                  type="text"
                  className="app-input min-w-0 flex-1"
                  style={{ fontSize: '0.8125rem' }}
                  placeholder={searchPlaceholder}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => {
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
                  }}
                />
                {onCreateNew && (
                  <button
                    type="button"
                    className="app-icon-button h-10 w-10 shrink-0"
                    style={{ color: 'var(--app-accent)' }}
                    aria-label={resolvedCreateNewLabel}
                    title={resolvedCreateNewLabel}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCreateNew}
                  >
                    <Plus size={18} aria-hidden />
                  </button>
                )}
              </div>
            )}
            <ul
              ref={listRef}
              role="listbox"
              className="overflow-auto"
              style={{ maxHeight: listPosition.listMaxHeight }}
              onScroll={handleListScroll}
            >
              {visibleFiltered.length === 0 && !showLoading ? (
                <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  No results
                </li>
              ) : groupedFiltered ? (
                groupedFiltered.map((group, groupIndex) => (
                  <li key={`${group.label}-${groupIndex}`}>
                    <div
                      className="sticky top-0 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide z-10"
                      style={{
                        color: 'var(--app-text-subtle)',
                        background: 'var(--app-input-bg)',
                        borderBottom: '1px solid var(--app-border)',
                      }}
                    >
                      {group.label}
                    </div>
                    {group.items.map(({ option, flatIndex }) => {
                      const isSelected = option.value === value;
                      const isHighlighted = flatIndex === effectiveHighlightedIndex;
                      return (
                        <div
                          key={option.value}
                          role="option"
                          aria-selected={isSelected}
                          data-option-index={flatIndex}
                          className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm transition-colors duration-100"
                          style={{
                            background: isHighlighted ? 'var(--app-accent-soft)' : 'transparent',
                            color: isSelected ? 'var(--app-accent)' : 'var(--app-text)',
                          }}
                          onMouseEnter={() => setHighlightedIndex(flatIndex)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelect(option.value)}
                        >
                          {option.icon && (
                            <span className="shrink-0 text-base leading-none" aria-hidden>
                              {option.icon}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        </div>
                      );
                    })}
                  </li>
                ))
              ) : (
                visibleFiltered.map((option, i) => {
                  const isSelected = option.value === value;
                  const isHighlighted = i === effectiveHighlightedIndex;
                  return (
                    <li
                      key={option.value}
                      role="option"
                      aria-selected={isSelected}
                      data-option-index={i}
                      className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm transition-colors duration-100"
                      style={{
                        background: isHighlighted ? 'var(--app-accent-soft)' : 'transparent',
                        color: isSelected ? 'var(--app-accent)' : 'var(--app-text)',
                      }}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelect(option.value)}
                    >
                      {option.icon && (
                        <span className="shrink-0 text-base leading-none" aria-hidden>
                          {option.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </li>
                  );
                })
              )}
              {showLoading && (
                <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  {loadingText}
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dropdown;
