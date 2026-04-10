import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  id?: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}

const Dropdown = ({
  id,
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchable = false,
  searchPlaceholder = 'Search...',
}: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [search, setSearch] = useState('');
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, searchable]);

  const updateListPosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setListPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  };

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
  }, [open]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const item = listRef.current.children[highlightedIndex] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, open]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchable) {
      // Small delay so the element is rendered before focusing
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  const close = () => {
    setOpen(false);
    setSearch('');
    setHighlightedIndex(-1);
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
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
          setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
          handleSelect(filtered[highlightedIndex].value);
        } else if (!open) {
          updateListPosition();
          setOpen(true);
          setHighlightedIndex(filtered.findIndex((o) => o.value === value));
        }
        break;
      case 'Escape':
        close();
        break;
    }
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
        className="app-input flex items-center justify-between gap-2 text-left"
        onClick={() => {
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
        <span style={{ color: selected ? 'var(--app-text)' : 'var(--app-text-subtle)' }}>
          {selected?.label ?? placeholder}
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
              <div className="px-2 pt-2">
                <input
                  ref={searchRef}
                  type="text"
                  className="app-input"
                  style={{ fontSize: '0.8125rem' }}
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setHighlightedIndex(0); }}
                  onKeyDown={handleKeyDown}
                />
              </div>
            )}
            <ul
              ref={listRef}
              role="listbox"
              className={`max-h-52 overflow-auto pb-1 ${searchable ? 'pt-1' : ''}`}
            >
              {filtered.length === 0 ? (
                <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  No results
                </li>
              ) : (
                filtered.map((option, i) => {
                  const isSelected = option.value === value;
                  const isHighlighted = i === highlightedIndex;
                  return (
                    <li
                      key={option.value}
                      role="option"
                      aria-selected={isSelected}
                      className="cursor-pointer px-4 py-2 text-sm transition-colors duration-100"
                      style={{
                        background: isHighlighted ? 'var(--app-accent-soft)' : 'transparent',
                        color: isSelected ? 'var(--app-accent)' : 'var(--app-text)',
                      }}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelect(option.value)}
                    >
                      {option.label}
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dropdown;
