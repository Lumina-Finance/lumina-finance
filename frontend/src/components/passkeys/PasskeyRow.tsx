import { Check, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { Passkey } from '@/api/passkeys';
import { FieldLabelRow } from '@/components/forms/FieldLabelRow';
import { FormError } from '@/components/forms/FormError';
import { OverflowMenu } from '@/components/passkeys/OverflowMenu';
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton';
import { useAuth } from '@/hooks/useAuth';
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { DATE_FORMATS, formatDate } from '@/utils/date';

// Crossfade the card between its resting details and the rename fields so neither state snaps in
const FIELD_TRANSITION = { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] as const };

const RENAME_FIELDS = ['name'] as const;

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
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(passkey.name);
  const [error, setError] = useState<string | null>(null);
  const lastUsed = useRelativeTime(passkey.last_used_at);
  const nameId = useId();
  const nameErrorId = `${nameId}-error`;
  const renameRefusal = useRefusedSubmit(
    { name: draftName.trim() ? undefined : 'Name is required' },
    RENAME_FIELDS,
    { name: nameId },
  );

  /**
   * Saves a trimmed, non-empty new label and returns the card to its resting state
   */
  async function saveRename() {
    if (!renameRefusal.guard()) return;
    const trimmed = draftName.trim();

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

  const addedLabel = `Added ${formatDate(new Date(passkey.created_at), DATE_FORMATS.monthDayYear, user?.tz)}`;
  const usageLabel = lastUsed ? `last used ${lastUsed}` : 'not used yet';

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--app-border)' }}>
      <div className="flex items-center gap-3">
        {/* While the message shows above the field, the icon stays level with the field and not with the row */}
        <motion.div
          layout="position"
          transition={shouldReduceMotion ? { duration: 0 } : FIELD_TRANSITION}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            isRenaming && renameRefusal.errors.name ? 'mb-0.5 self-end' : ''
          }`}
          style={{ backgroundColor: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
          aria-hidden
        >
          <KeyRound size={18} />
        </motion.div>

        <div className="grid min-h-10 min-w-0 flex-1 grid-cols-1">
          <AnimatePresence initial={false}>
            {isRenaming ? (
              <motion.div
                key="rename"
                className="min-w-0"
                style={{ gridArea: '1 / 1' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FIELD_TRANSITION}
              >
                {/* The label row only takes room while there is a problem to show, so the resting rename stays one line */}
                <AnimatePresence initial={false}>
                  {renameRefusal.errors.name && (
                    <motion.div
                      key="rename-label"
                      className="overflow-hidden"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={FIELD_TRANSITION}
                    >
                      <FieldLabelRow
                        label="Passkey name"
                        htmlFor={nameId}
                        error={renameRefusal.errors.name}
                        errorId={nameErrorId}
                        compact
                        spacingClassName="mb-1"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-center gap-2">
                  <input
                    id={nameId}
                    className={`app-input min-w-0 flex-1 ${renameRefusal.errors.name ? 'app-input-error' : ''}`}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    autoFocus
                    aria-label="Passkey name"
                    aria-invalid={renameRefusal.errors.name ? true : undefined}
                    aria-describedby={renameRefusal.errors.name ? nameErrorId : undefined}
                  />
                  <DisabledReasonButton
                    type="button"
                    onClick={saveRename}
                    disabled={disabled}
                    disabledReason={disabled ? undefined : renameRefusal.blockedReason}
                    className="app-secondary-button shrink-0"
                    aria-label="Save name"
                  >
                    <Check size={16} aria-hidden />
                  </DisabledReasonButton>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(passkey.name);
                      setError(null);
                      renameRefusal.reset();
                      setIsRenaming(false);
                    }}
                    className="app-secondary-button shrink-0"
                    aria-label="Cancel rename"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
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
                  {/* Wraps between the two parts on a phone rather than hiding the last used words. The dot sits in the gap before the second part, so a wrapped second part pushes it past the left edge, where the line clips it */}
                  <p className="flex flex-wrap gap-x-3 overflow-x-clip break-words text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {/* The trailing space is dropped from the layout but keeps copied text and screen readers from joining the two parts */}
                    <span className="whitespace-nowrap">{addedLabel} </span>
                    <span className="relative whitespace-nowrap before:absolute before:right-full before:w-3 before:text-center before:content-['·']">{usageLabel}</span>
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
                        renameRefusal.reset();
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

      <FormError message={error} className="mt-2 text-xs" />
    </div>
  );
}
