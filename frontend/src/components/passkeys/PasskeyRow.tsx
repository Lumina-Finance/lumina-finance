import { Check, Pencil, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { Passkey } from '@/api/passkeys';

const CREATED_DATE_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

// Cross-fade with a small slide so toggling the remove confirmation eases between states
const ACTION_TRANSITION = { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] as const };
const ACTION_MOTION = {
  initial: { opacity: 0, x: 6 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 6 },
  transition: ACTION_TRANSITION,
};

type RowMode = 'view' | 'rename' | 'confirm-remove';

interface PasskeyRowProps {
  passkey: Passkey;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
  /** True while any passkey mutation is in flight, so a row cannot start a second one */
  disabled: boolean;
}

/**
 * One registered passkey with inline rename and a two-step remove confirmation
 *
 * Rename and removal are kept inline rather than stacking another modal on the manage dialog, so the
 * list stays the single surface for managing passkeys
 */
export function PasskeyRow({ passkey, onRename, onRemove, disabled }: PasskeyRowProps) {
  const [mode, setMode] = useState<RowMode>('view');
  const [draftName, setDraftName] = useState(passkey.name);
  const [error, setError] = useState<string | null>(null);

  /**
   * Saves a trimmed, non-empty new label and returns the row to its resting state
   */
  async function saveRename() {
    const trimmed = draftName.trim();
    if (!trimmed) return;

    setError(null);
    try {
      await onRename(trimmed);
      setMode('view');
    } catch {
      setError('Could not rename this passkey.');
    }
  }

  /**
   * Removes the passkey, leaving the confirmation visible if the request fails
   */
  async function confirmRemove() {
    setError(null);
    try {
      await onRemove();
    } catch {
      setError('Could not remove this passkey.');
    }
  }

  if (mode === 'rename') {
    return (
      <div className="flex items-center gap-2 py-2">
        <input
          className="app-input flex-1"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          autoFocus
          aria-label="Passkey name"
        />
        <button type="button" onClick={saveRename} disabled={disabled} className="app-secondary-button" aria-label="Save name">
          <Check size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraftName(passkey.name);
            setMode('view');
          }}
          className="app-secondary-button"
          aria-label="Cancel rename"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{passkey.name}</p>
        <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Added {new Date(passkey.created_at).toLocaleDateString(undefined, CREATED_DATE_OPTIONS)}
        </p>
        {error && (
          <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
            {error}
          </p>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'confirm-remove' ? (
          <motion.div key="confirm" className="flex shrink-0 items-center gap-2" {...ACTION_MOTION}>
            <button type="button" onClick={confirmRemove} disabled={disabled} className="app-danger-button">
              Remove
            </button>
            <button type="button" onClick={() => setMode('view')} className="app-secondary-button">
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.div key="actions" className="flex shrink-0 items-center gap-1" {...ACTION_MOTION}>
            <button
              type="button"
              onClick={() => {
                setDraftName(passkey.name);
                setError(null);
                setMode('rename');
              }}
              disabled={disabled}
              className="rounded-md p-2"
              style={{ color: 'var(--app-text-muted)' }}
              aria-label={`Rename ${passkey.name}`}
            >
              <Pencil size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('confirm-remove');
              }}
              disabled={disabled}
              className="rounded-md p-2"
              style={{ color: 'var(--app-negative)' }}
              aria-label={`Remove ${passkey.name}`}
            >
              <Trash2 size={16} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
