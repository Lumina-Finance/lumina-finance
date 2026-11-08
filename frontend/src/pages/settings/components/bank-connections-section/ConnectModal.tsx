import { useEffect, useState, type FormEvent } from 'react'
import { Landmark } from 'lucide-react'
import { isAnsweredByApp, type ApiError } from '@/api/auth'
import {
  CONNECTION_NICKNAME_MAX_LENGTH,
  UNANSWERED_CLAIM_POLL_MS,
  UNANSWERED_CLAIM_WATCH_MS,
  useClaimCredential,
  useReconnectBankConnection,
  type BankConnection,
  type BankProvider,
  type BankProviderId,
  type CredentialField,
} from '@/api/bank-sync'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'
import { useAuth } from '@/hooks/useAuth'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { useToast } from '@/hooks/useToast'
import {
  describeConnected,
  describeCredentialLength,
  describeReconnected,
  isClaimSettled,
} from '@/pages/settings/components/bank-connections-section/utils'
import { connectionName, credentialNoun } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

const FIELD_IDS = {
  provider: 'bank-connection-provider',
  nickname: 'bank-connection-nickname',
} as const

// Every credential field the refusal is about points to the one message as its description
const CREDENTIAL_ERROR_ID = 'bank-connection-credential-error'

/** The id of the input for one of the provider's credential fields */
const credentialFieldId = (key: string) => `bank-connection-credential-${key}`

// A reconnect sent again with the same credential is safe, since the server refuses it for a connection
// already working again
const UNANSWERED_RECONNECT_MESSAGE = 'Something went wrong. Please try again.'

// The server carries on with a claim whose own answer never reached the browser, lost on the way or
// replaced by a proxy's page, so it may have saved the connection and spent the credential. The
// credential may work only once. The dialogue waits for that connection to show in the list, and says
// this only when none has by the time the claim must have finished. Sent again, the credential may be
// refused as used, and a new one would add the same connection twice
function describeUnansweredClaim(noun: string): string {
  return `Oops, something went wrong. The connection may have been added, so please check before you create a new ${noun}.`
}

// The one field shown while the provider being reconnected is turned off on the server, so its own
// fields aren't listed. The server refuses the reconnect with its reason
const FALLBACK_FIELDS: CredentialField[] = [
  { key: 'credential', label: 'Credential', placeholder: '', max_length: Number.MAX_SAFE_INTEGER },
]

/** A claim whose answer was lost, waited on until its connection shows or the claim must have finished */
type UnansweredClaim = {
  /** The connections listed when it was sent, so a connection not among them is the one it saved */
  knownIds: Set<string>

  /**
   * When the wait ends, in epoch milliseconds: once the claim must have finished, and never before the
   * next poll after the failure is due. A claim the browser itself timed out comes near it
   */
  endsAt: number
}

interface ConnectModalProps {
  open: boolean

  /** Providers the server offers for new connections from settings, in the order it lists them */
  providers: BankProvider[]

  /** A connection whose credential was rejected, given a new one in place, or null to add a connection */
  reconnecting: BankConnection | null

  /**
   * The provider of the connection being reconnected, as the server lists it. The provider says how to get a
   * new credential. Undefined while the providers load, or while the server has the provider turned off
   */
  reconnectingProvider?: BankProvider

  /** The user's connections as last read, or undefined until they load */
  connections: BankConnection[] | undefined

  /** Stacked when opened from a connection's own modal */
  level?: ModalLevel
  onClose: () => void

  /** Told when a claim ends without the app's answer, while the server may still be saving its connection */
  onClaimUnanswered: () => void
}

/**
 * Adds one bank connection: the user picks one of the offered providers and exchanges its credential
 * for stored access, all in one form. Reconnecting a rejected connection has no provider to pick and
 * replaces its credential in place. Each provider says what its credential is called and how to get it
 *
 * A connection reaches every bank account the user holds with the provider, so connecting links
 * nothing by itself. Each account then chooses one of them. A refused credential is about the
 * credential, so its reason sits on that field, and anything else, such as the provider being out of
 * reach, sits beside the actions. Callers remount it with a key for each opening, so nothing typed
 * carries over
 */
export function ConnectModal({
  open,
  providers,
  reconnecting,
  reconnectingProvider,
  connections,
  level = 'page',
  onClose,
  onClaimUnanswered,
}: ConnectModalProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const claim = useClaimCredential()
  const reconnect = useReconnectBankConnection()
  const [providerId, setProviderId] = useState<BankProviderId | null>(providers[0]?.id ?? null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [nickname, setNickname] = useState('')

  // A refused credential, on the fields it is about: the one too long, or every field for the server's
  // own refusal, since that speaks of the credentials as a whole. The message is drawn once, on the last
  const [fieldError, setFieldError] = useState<{ keys: string[]; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<UnansweredClaim | null>(null)

  // The wait reads as the claim still in flight, since from the user's side it is: it lasts no longer
  // than a claim answered in time may take. Unlike a claim in flight, it can be closed, since the
  // section lists the connection if one comes
  const sending = claim.isPending || reconnect.isPending
  const busy = sending || unanswered !== null
  const saved = unanswered ? connections?.find((connection) => !unanswered.knownIds.has(connection.id)) : undefined
  const settled = saved !== undefined && isClaimSettled(saved)
  const provider = reconnecting ? reconnectingProvider : providers.find((entry) => entry.id === providerId)
  const providerName = reconnecting?.provider_name ?? provider?.name ?? ''
  const site = reconnecting?.provider_site ?? provider?.site ?? ''
  const fields = provider?.credential_fields ?? FALLBACK_FIELDS

  // The messages that speak of the credential as one thing name the provider's first field
  const noun = credentialNoun(fields[0].label)
  const trimmed = Object.fromEntries(fields.map((field) => [field.key, (values[field.key] ?? '').trim()]))

  // Without a provider there is nothing to fill in, so Connect says so before any press, the way any
  // held-back button does. An empty field is only marked once a press finds it
  const heldBackReason = !reconnecting && !providerId ? 'Choose a provider first' : null
  const refusal = useRefusedSubmit(
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        trimmed[field.key] ? undefined : fields.length === 1 ? `Paste the ${noun}` : 'Fill this in',
      ]),
    ),
    fields.map((field) => field.key),
    Object.fromEntries(fields.map((field) => [field.key, credentialFieldId(field.key)])),
  )

  const reportAnswered = (cause: ApiError) => {
    if (cause.status === 422) {
      setFieldError({ keys: fields.map((field) => field.key), message: cause.message })
      return
    }
    setError(cause.message)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !refusal.guard()) return
    for (const field of fields) {
      const lengthProblem = describeCredentialLength(field, site, trimmed[field.key])
      if (lengthProblem) {
        setFieldError({ keys: [field.key], message: lengthProblem })
        return
      }
    }
    setFieldError(null)
    setError(null)

    if (reconnecting) {
      reconnect.mutate(
        { connectionId: reconnecting.id, credentials: trimmed },
        {
          onSuccess: (result) => {
            showToast({ status: 'success', text: describeReconnected(result) })
            onClose()
          },
          onError: (cause) => (isAnsweredByApp(cause) ? reportAnswered(cause) : setError(UNANSWERED_RECONNECT_MESSAGE)),
        },
      )
      return
    }
    if (!providerId) return

    // Unread connections can't tell the one a claim saved from those already there, so a lost answer
    // then says at once that the connection may have been added
    const knownIds = connections && new Set(connections.map((connection) => connection.id))
    const finishedBy = Date.now() + UNANSWERED_CLAIM_WATCH_MS
    claim.mutate(
      { provider: providerId, credentials: trimmed, nickname },
      {
        onSuccess: (connection) => {
          showToast({ status: 'success', text: describeConnected(connection) })
          onClose()
        },
        onError: (cause) => {
          if (isAnsweredByApp(cause)) {
            reportAnswered(cause)
            return
          }
          onClaimUnanswered()
          if (knownIds) setUnanswered({ knownIds, endsAt: Math.max(finishedBy, Date.now() + UNANSWERED_CLAIM_POLL_MS) })
          else setError(describeUnansweredClaim(noun))
        },
      },
    )
  }

  // The connection a lost claim saved closes the dialogue the way a claim answered in time does, once
  // settled, or as it stands when the wait ends. A wait that ends with none says the connection may
  // have been added. Once closed, by the user or after its toast, the dialogue does neither again,
  // since the section lists the connection if it comes
  useEffect(() => {
    if (!open || !unanswered) return
    const connected = (connection: BankConnection) => {
      showToast({ status: 'success', text: describeConnected(connection) })
      onClose()
    }
    if (saved && settled) {
      connected(saved)
      return
    }
    const timer = window.setTimeout(() => {
      setUnanswered(null)
      if (saved) connected(saved)
      else setError(describeUnansweredClaim(noun))
    }, unanswered.endsAt - Date.now())
    return () => window.clearTimeout(timer)
  }, [open, unanswered, saved, settled, showToast, onClose, noun])

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onSubmit={submit}
      titleId="bank-connection-add-title"
      title={reconnecting ? `Reconnect ${connectionName(reconnecting)}` : 'Add a connection'}
      eyebrow={
        reconnecting
          ? `Added ${formatDate(new Date(reconnecting.created_at), DATE_FORMATS.monthDayYear, user?.tz)}`
          : 'Bank connection'
      }
      RailIcon={Landmark}
      railLabel="Bank"
      level={level}
      closeDisabled={sending}
      footer={
        <ModalFormFooter
          submitLabel={reconnecting ? 'Reconnect' : 'Connect'}
          submitDisabled={busy}
          cancelDisabled={sending}
          submitReason={heldBackReason}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName="w-full sm:w-32"
          error={error}
          level={level}
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-4 pb-2">
        {!reconnecting && (
          <div>
            <CreateModalFieldLabelRow htmlFor={FIELD_IDS.provider} label="Provider" />
            <Dropdown
              id={FIELD_IDS.provider}
              clampToPanel
              options={providers.map((entry) => ({
                value: entry.id,
                label: entry.name,
                description: entry.description,
                badge: entry.in_beta ? 'Beta' : undefined,
              }))}
              value={providerId ?? ''}
              disabled={busy}
              onChange={(value) => {
                setError(null)
                setFieldError(null)
                refusal.reset()
                setProviderId(value as BankProviderId)
              }}
            />
          </div>
        )}
        {!reconnecting && (
          <div>
            <CreateModalFieldLabelRow
              htmlFor={FIELD_IDS.nickname}
              label="Nickname"
              accessory={
                <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  (optional)
                </span>
              }
            />
            <input
              id={FIELD_IDS.nickname}
              className="app-input"
              value={nickname}
              maxLength={CONNECTION_NICKNAME_MAX_LENGTH}
              placeholder={`Shown instead of ${providerName}`}
              disabled={busy}
              onChange={(event) => setNickname(event.target.value)}
            />
          </div>
        )}
        {reconnecting ? (
          <WarningCallout>
            {site} no longer accepts this connection. Create a new {noun} there and paste it below. Linked accounts pick
            up where they stopped.
          </WarningCallout>
        ) : (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            One connection reaches every bank account you added in {site}. Connecting links nothing yet: each account
            then chooses its bank account.
          </p>
        )}
        {provider && provider.connect_steps.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {provider.connect_steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {fields.map((field) => {
          const refusedMessage = refusal.errors[field.key]
          const refused = Boolean(refusedMessage)
          const refusedErrorId = `${credentialFieldId(field.key)}-error`
          const refusedByServer = fieldError?.keys.includes(field.key) ?? false
          const serverMessage =
            refusedByServer && fieldError?.keys[fieldError.keys.length - 1] === field.key ? fieldError.message : null
          const invalid = refused || refusedByServer
          const message = refusedMessage ?? serverMessage
          const messageId = refused ? refusedErrorId : CREDENTIAL_ERROR_ID
          return (
            <div key={field.key}>
              <CreateModalFieldLabelRow
                htmlFor={credentialFieldId(field.key)}
                label={field.label}
                error={message ?? undefined}
                errorId={message ? messageId : undefined}
              />
              <textarea
                id={credentialFieldId(field.key)}
                className={`app-input w-full resize-none py-2.5 ${fields.length > 1 ? 'h-16' : 'h-24'} ${invalid ? 'app-input-error' : ''}`}
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? (refused ? refusedErrorId : CREDENTIAL_ERROR_ID) : undefined}
                disabled={busy}
                onChange={(event) => {
                  setFieldError(null)
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }}
              />
            </div>
          )
        })}
      </div>
    </ModalTitledPanel>
  )
}
