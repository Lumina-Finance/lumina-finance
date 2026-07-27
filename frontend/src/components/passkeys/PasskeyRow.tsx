import { Check, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Passkey } from '@/api/passkeys';
import { OverflowMenu } from '@/components/passkeys/OverflowMenu';
import { formatRelativeTime } from '@/utils/relativeTime';
import { DATE_FORMATS, formatDate } from '@/utils/date';

// Crossfade the card between its resting details and the rename fields so neither state snaps in
const FIELD_TRANSITION = { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] as const };

interface PasskeyRowProps {
  passkey: Passkey;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
  /** True while any passkey mutation is in flight, so a row cannot start a second one */
  disabled: boolean;
}

/**
 * One registered passkey as a card: a key badge, its name, when it was added and last used, and an
 * overflow menu for rename and remove. Rename edits inline, while remove opens a step-up prompt, since
 * the backend re-checks a current second factor before deleting a passkey
 */
export function PasskeyRow({ passkey, onRename, onRemove, disabled }: PasskeyRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(passkey.name);
  const [error, setError] = useState<string | null>(null);

  /**
   * Saves a trimmed, non-empty new label and returns the card to its resting state
   */
  async function saveRename() {
    const trimmed = draftName.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await onRename(trimmed);
      setIsRenaming(false);
    } catch {
      setError('Could not rename this passkey.');
    }
  }

  /**
   * Starts removal, which opens a step-up prompt before the backend deletes the passkey
   */
  async function handleRemove() {
    setError(null);
    try {
      await onRemove();
    } catch {
      setError('Could not remove this passkey.');
    }
  }

  const addedLabel = `Added ${formatDate(new Date(passkey.created_at), DATE_FORMATS.monthDayYear)}`;
  const usageLabel = passkey.last_used_at ? `last used ${formatRelativeTime(passkey.last_used_at)}` : 'not used yet';

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--app-border)' }}>
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
          aria-hidden
        >
          <KeyRound size={18} />
        </div>

        <div className="grid min-h-10 min-w-0 flex-1 grid-cols-1">
          <AnimatePresence initial={false}>
            {isRenaming ? (
              <motion.div
                key="rename"
                className="flex items-center gap-2"
                style={{ gridArea: '1 / 1' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FIELD_TRANSITION}
              >
                <input
                  className="app-input min-w-0 flex-1"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  autoFocus
                  aria-label="Passkey name"
                />
                <button type="button" onClick={saveRename} disabled={disabled} className="app-secondary-button shrink-0" aria-label="Save name">
                  <Check size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(passkey.name);
                    setError(null);
                    setIsRenaming(false);
                  }}
                  className="app-secondary-button shrink-0"
                  aria-label="Cancel rename"
                >
                  <X size={16} aria-hidden />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="view"
                className="flex min-w-0 items-center gap-3"
                style={{ gridArea: '1 / 1' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FIELD_TRANSITION}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{passkey.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {addedLabel} · {usageLabel}
                  </p>
                </div>
                <OverflowMenu
                  label={`Options for ${passkey.name}`}
                  disabled={disabled}
                  items={[
                    {
                      label: 'Rename',
                      icon: <Pencil size={15} aria-hidden />,
                      onSelect: () => {
                        setDraftName(passkey.name);
                        setError(null);
                        setIsRenaming(true);
                      },
                    },
                    { label: 'Remove', icon: <Trash2 size={15} aria-hidden />, onSelect: handleRemove, danger: true },
                  ]}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
