import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Landmark } from 'lucide-react'
import { isAnsweredByApp, type ApiError } from '@/api/auth'
import {
  UNANSWERED_CLAIM_POLL_MS,
  UNANSWERED_CLAIM_WATCH_MS,
  useClaimCredential,
  useReconnectBankConnection,
  useStartBankAuthorization,
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
  buildAuthorizationStart,
  getCredentialProblems,
  getNicknameProblem,
  isClaimSettled,
  markServerRefusal,
  readDroppedCredentialFile,
} from '@/pages/settings/components/bank-connections-section/utils'
import {
  connectionName,
  credentialNoun,
  describeConnected,
  describeReconnected,
  fillRedirectUrl,
} from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

const FIELD_IDS = {
  provider: 'bank-connection-provider',
  nickname: 'bank-connection-nickname',
} as const

// The nickname's name among the problems a refused press marks. A provider's credential fields have
// keys of their own
const NICKNAME_FIELD = 'nickname'
const NICKNAME_ERROR_ID = 'bank-connection-nickname-error'

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

type ConnectModalProps = {
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

  /**
   * Takes the user back to the account's link flow once a connection is added or reconnected, as the
   * dialogue closes on it. Its confirmation then leaves out where to link the bank accounts
   */
  onConnected?: (connectionId: string) => void

  /**
   * The account whose link flow sent the user here. A provider that signs in at the bank sends the
   * user away, so the return page needs it to go back to that flow
   */
  returnToAccountId?: string | null

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
  onConnected,
  returnToAccountId,
  onClaimUnanswered,
}: ConnectModalProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const claim = useClaimCredential()
  const reconnect = useReconnectBankConnection()
  const startAuthorization = useStartBankAuthorization()

  // Set once the browser is on its way to the bank, so the form stays held until the page is left
  const [leavingForBank, setLeavingForBank] = useState(false)
  const [providerId, setProviderId] = useState<BankProviderId | null>(providers[0]?.id ?? null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [nickname, setNickname] = useState('')

  // Why a file dropped onto a field couldn't fill it, by field, until the field changes again
  const [dropErrors, setDropErrors] = useState<Partial<Record<string, string>>>({})

  // The server's own refusal of the credential. It marks the fields it names, or every field when it
  // names none, and its message is drawn once, on the last marked. A value too long is refused before
  // any press goes through, as a problem of its own field
  const [fieldError, setFieldError] = useState<{ message: string; fields?: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<UnansweredClaim | null>(null)

  // The wait reads as the claim still in flight, since from the user's side it is: it lasts no longer
  // than a claim answered in time may take. Unlike a claim in flight, it can be closed, since the
  // section lists the connection if one comes
  const sending = claim.isPending || reconnect.isPending || startAuthorization.isPending || leavingForBank
  const busy = sending || unanswered !== null
  const saved = unanswered ? connections?.find((connection) => !unanswered.knownIds.has(connection.id)) : undefined
  const settled = saved !== undefined && isClaimSettled(saved)
  const provider = reconnecting ? reconnectingProvider : providers.find((entry) => entry.id === providerId)
  const signsInAtBank = provider?.authorizes_at_bank === true
  const providerName = reconnecting?.provider_name ?? provider?.name ?? ''
  const site = reconnecting?.provider_site ?? provider?.site ?? ''
  const fields = provider?.credential_fields ?? FALLBACK_FIELDS

  // The messages that speak of the credential as one thing name the provider's first field
  const noun = credentialNoun(fields[0].label)
  const trimmed = Object.fromEntries(fields.map((field) => [field.key, (values[field.key] ?? '').trim()]))
  const serverMarks = fieldError
    ? markServerRefusal(
        fields.map((field) => field.key),
        fieldError.fields,
      )
    : null

  // Without a provider there is nothing to fill in, so Connect says so before any press, the way any
  // held-back button does. An empty field is only marked once a press finds it
  const heldBackReason = !reconnecting && !providerId ? 'Choose a provider first' : null
  // The nickname comes first, as the form draws it, and a reconnect has none
  const nicknameFields = reconnecting ? [] : [NICKNAME_FIELD]
  const refusal = useRefusedSubmit(
    {
      ...(reconnecting ? {} : { [NICKNAME_FIELD]: getNicknameProblem(nickname) }),
      ...getCredentialProblems(fields, trimmed, site),
    },
    [...nicknameFields, ...fields.map((field) => field.key)],
    {
      [NICKNAME_FIELD]: FIELD_IDS.nickname,
      ...Object.fromEntries(fields.map((field) => [field.key, credentialFieldId(field.key)])),
    },
  )

  const reportAnswered = (cause: ApiError) => {
    if (cause.status === 422) {
      setFieldError({ message: cause.message, fields: cause.refusedFields })
      return
    }
    setError(cause.message)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !refusal.guard()) return
    setFieldError(null)
    setError(null)

    // Nothing is saved until the user returns from the bank, so a start that goes unanswered is safe to
    // send again: the server drops the earlier sign-in the new one replaces
    if (signsInAtBank && provider) {
      startAuthorization.mutate(
        buildAuthorizationStart({
          provider: provider.id,
          credentials: trimmed,
          nickname,
          reconnectingId: reconnecting?.id,
          returnToAccountId,
        }),
        {
          onSuccess: ({ url }) => {
            setLeavingForBank(true)
            window.location.assign(url)
          },
          onError: (cause) => (isAnsweredByApp(cause) ? reportAnswered(cause) : setError(UNANSWERED_RECONNECT_MESSAGE)),
        },
      )
      return
    }

    if (reconnecting) {
      reconnect.mutate(
        { connectionId: reconnecting.id, credentials: trimmed },
        {
          onSuccess: (result) => {
            showToast({ status: 'success', text: describeReconnected(result) })
            onClose()
            onConnected?.(result.connection.id)
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
          showToast({ status: 'success', text: describeConnected(connection, onConnected !== undefined) })
          onClose()
          onConnected?.(connection.id)
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
      showToast({ status: 'success', text: describeConnected(connection, onConnected !== undefined) })
      onClose()
      onConnected?.(connection.id)
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
  }, [open, unanswered, saved, settled, showToast, onClose, onConnected, noun])

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
          submitLabel={signsInAtBank ? 'Go to your bank' : reconnecting ? 'Reconnect' : 'Connect'}
          submitDisabled={busy}
          cancelDisabled={sending}
          submitReason={heldBackReason}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName={signsInAtBank ? 'w-full sm:w-auto' : 'w-full sm:w-32'}
          error={error}
          holdsButtonWidth
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
              error={refusal.errors[NICKNAME_FIELD]}
              errorId={refusal.errors[NICKNAME_FIELD] ? NICKNAME_ERROR_ID : undefined}
              keepsLabelWhole
            />
            <input
              id={FIELD_IDS.nickname}
              className={`app-input ${refusal.errors[NICKNAME_FIELD] ? 'app-input-error' : ''}`}
              value={nickname}
              placeholder={`Shown instead of ${providerName}`}
              aria-invalid={refusal.errors[NICKNAME_FIELD] ? true : undefined}
              aria-describedby={refusal.errors[NICKNAME_FIELD] ? NICKNAME_ERROR_ID : undefined}
              disabled={busy}
              onChange={(event) => setNickname(event.target.value)}
              onBlur={() => refusal.touch(NICKNAME_FIELD)}
            />
          </div>
        )}
        {reconnecting ? (
          <WarningCallout>
            {signsInAtBank
              ? `${site} no longer accepts this connection. Please fill in the details below, then sign in at your bank again.`
              : `${site} no longer accepts this connection. Please create a new ${noun} in ${site} and paste the ${noun} below.`}
          </WarningCallout>
        ) : (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {signsInAtBank
              ? 'One connection covers the bank accounts you share when you sign in at your bank.'
              : `One connection covers every bank account you added in ${site}.`}{' '}
            Each account then links to a bank account from the account&apos;s own page.
          </p>
        )}
        {provider && provider.connect_steps.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {provider.connect_steps.map((step) => (
              <li key={step}>{fillRedirectUrl(step, window.location.origin)}</li>
            ))}
          </ol>
        )}
        {fields.map((field) => {
          const dropMessage = dropErrors[field.key]
          const refusedMessage = dropMessage ?? refusal.errors[field.key]
          const refused = Boolean(refusedMessage)
          const refusedErrorId = `${credentialFieldId(field.key)}-error`
          const refusedByServer = serverMarks?.marked.has(field.key) === true
          const serverMessage = fieldError && field.key === serverMarks?.messageOn ? fieldError.message : null
          const invalid = refused || refusedByServer
          const message = refusedMessage ?? serverMessage
          const messageId = refused ? refusedErrorId : CREDENTIAL_ERROR_ID
          // An older server sends no flag, and every field it lists is a secret
          const masked = field.masked !== false
          const shared = {
            id: credentialFieldId(field.key),
            // Block, so a field leaves no room for descenders under it and every field sits the same
            // distance from the label below, whichever element draws it
            className: `app-input block w-full ${invalid ? 'app-input-error' : ''}`,
            // A provider's token or key is masked as it is typed or pasted. A plain detail the user needs to
            // read back, such as the bank's country, shows as typed
            type: masked ? 'password' : 'text',
            value: values[field.key] ?? '',
            placeholder: field.placeholder,
            spellCheck: false,
            // A provider's key isn't the user's password here, so the browser must neither fill in a saved
            // password nor offer to save the key as one. Chromium's password manager skips one-time-code
            // fields for both, and ignores off on a password field. A shown detail takes no suggestions
            autoComplete: masked ? 'one-time-code' : 'off',
            'aria-invalid': invalid ? true : undefined,
            'aria-describedby': invalid ? (refused ? refusedErrorId : CREDENTIAL_ERROR_ID) : undefined,
            disabled: busy,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              setFieldError(null)
              setDropErrors((current) => ({ ...current, [field.key]: undefined }))
              setValues((current) => ({ ...current, [field.key]: event.target.value }))
            },
          }
          const fileExtension = field.file_extension
          return (
            <div key={field.key}>
              <CreateModalFieldLabelRow
                htmlFor={credentialFieldId(field.key)}
                label={field.label}
                error={message ?? undefined}
                errorId={message ? messageId : undefined}
                // A refusal runs to two lines, so it wraps beside the whole label rather than over it
                keepsLabelWhole
              />
              {fileExtension ? (
                // A key handed out as a file takes either its text pasted or the file dropped onto it.
                // A file dragged over takes the field's focus look, so the user sees where it lands,
                // and the browser never opens a dropped file in place of the app
                <input
                  {...shared}
                  onDragEnter={(event) => {
                    if (busy || !event.dataTransfer.types.includes('Files')) return
                    event.currentTarget.focus()
                  }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
                  }}
                  onDrop={(event) => {
                    if (!event.dataTransfer.types.includes('Files')) return
                    event.preventDefault()
                    if (busy) return
                    const dropped = Array.from(event.dataTransfer.files)
                    void readDroppedCredentialFile({ ...field, file_extension: fileExtension }, dropped).then(
                      (read) => {
                        setFieldError(null)
                        if ('error' in read) {
                          setDropErrors((current) => ({ ...current, [field.key]: read.error }))
                          return
                        }
                        setDropErrors((current) => ({ ...current, [field.key]: undefined }))
                        setValues((current) => ({ ...current, [field.key]: read.value }))
                      },
                    )
                  }}
                />
              ) : (
                <input {...shared} />
              )}
            </div>
          )
        })}
      </div>
    </ModalTitledPanel>
  )
}
