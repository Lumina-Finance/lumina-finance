import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus } from 'lucide-react';
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag';

export interface DropdownOption {
  value: string;
  label: string;
  group?: string;
  icon?: string | null;
}

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
  hasMore?: boolean;
  onLoadMore?: () => void;
  onSearchCommit?: (value: string) => void;
  disabled?: boolean;
  blankWhenEmpty?: boolean;
  /** Called when the user clicks the dropdown create action. Receives the current search text. */
  onCreateNew?: (query: string) => void;
  createNewLabel?: string | ((query: string) => string);
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
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? (
    selectedOption?.value === value ? selectedOption : undefined
  );
  const emptySelectionIsBlank = blankWhenEmpty && value === '';
  const searchText = searchValue ?? search;
  const heldLoading = useMinimumVisibleFlag(isLoading, loadingMinMs);
  const showLoading = loadingMinMs <= 0 ? isLoading : heldLoading;

  const filtered = useMemo(() => {
    if (!filterOptions || !searchable || !searchText) return options;
    const q = searchText.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, searchText, searchable, filterOptions]);
  const visibleFiltered = useMemo(
    () => (showLoading && hideOptionsWhileLoading ? [] : filtered),
    [filtered, hideOptionsWhileLoading, showLoading],
  );

  // Group filtered options by their `group` field for sectioned rendering.
  // Each group wraps its options so sticky headers stay pinned for the full section.
  const groupedFiltered = useMemo(() => {
    if (!visibleFiltered.some((o) => o.group)) return null;

    const groups: { label: string; items: { option: DropdownOption; flatIndex: number }[] }[] = [];
    let current: string | undefined;

    visibleFiltered.forEach((option, i) => {
      if (groups.length === 0 || option.group !== current) {
        current = option.group;
        groups.push({ label: option.group ?? '', items: [] });
      }
      groups[groups.length - 1].items.push({ option, flatIndex: i });
    });

    return groups;
  }, [visibleFiltered]);

  const updateListPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setListPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  };

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
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelector(`[data-option-index="${highlightedIndex}"]`) as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

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
  const resolvedCreateNewLabel = typeof createNewLabel === 'function'
    ? createNewLabel(createQuery)
    : createNewLabel ?? (createQuery ? `Create "${createQuery}"` : 'Create new');

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
        if (open && highlightedIndex >= 0 && highlightedIndex < visibleFiltered.length) {
          handleSelect(visibleFiltered[highlightedIndex].value);
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
              top: listPos.top,
              left: listPos.left,
              width: listPos.width,
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
              className="max-h-52 overflow-auto"
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
                      const isHighlighted = flatIndex === highlightedIndex;
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
                  const isHighlighted = i === highlightedIndex;
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
