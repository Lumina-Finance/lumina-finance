import { useEffect, useState, type FormEvent } from 'react'
import { Landmark } from 'lucide-react'
import { isAnsweredByApp, type ApiError } from '@/api/auth'
import {
  CONNECTION_NICKNAME_MAX_LENGTH,
  UNANSWERED_CLAIM_POLL_MS,
  UNANSWERED_CLAIM_WATCH_MS,
  useClaimSetupToken,
  useReconnectBankConnection,
  type BankConnection,
  type BankProvider,
  type BankProviderId,
} from '@/api/bank-sync'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import Dropdown from '@/components/dropdown/Dropdown'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import {
  describeConnected,
  describeReconnected,
  describeSetupTokenLength,
  isClaimSettled,
} from '@/pages/settings/components/bank-connections-section/utils'
import { connectionName, providerSite } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

const FIELD_IDS = {
  provider: 'bank-connection-provider',
  nickname: 'bank-connection-nickname',
  setupToken: 'bank-connection-setup-token',
} as const

// A reconnect sent again with the same token is safe, since the server refuses it for a connection
// already working again
const UNANSWERED_RECONNECT_MESSAGE = 'Something went wrong. Please try again.'

// The server carries on with a claim whose own answer never reached the browser, lost on the way or
// replaced by a proxy's page, so it may have saved the connection and spent the setup token, which
// works only once. The dialogue waits for that connection to show in the list, and says this only
// when none has by the time the claim must have finished. Sent again, the token is refused as used,
// and a new one would add the same connection twice
const UNANSWERED_CLAIM_MESSAGE =
  'Oops, something went wrong. The connection may have been added, so please check before you create a new setup token.'

/** A claim whose answer was lost, waited on until its connection shows or the claim must have finished */
type UnansweredClaim = {
  /** The connections listed when it was sent, so a connection not among them is the one it saved */
  knownIds: Set<string>

  /**
   * When the wait ends, in epoch milliseconds: once the claim must have finished, and never before the
   * next poll after the failure is due, which a claim the browser itself timed out comes near
   */
  endsAt: number
}

interface ConnectModalProps {
  open: boolean

  /** Providers the server offers for new connections from settings, in the order it lists them */
  providers: BankProvider[]

  /** A connection whose credential was rejected, given a new one in place, or null to add a connection */
  reconnecting: BankConnection | null

  /** The user's connections as last read, or undefined until they load */
  connections: BankConnection[] | undefined

  /** Stacked when opened from a connection's own modal */
  level?: ModalLevel
  onClose: () => void

  /** Told when a claim ends without the app's answer, while the server may still be saving its connection */
  onClaimUnanswered: () => void
}

/**
 * Adds one bank connection: the user picks one of the offered providers and exchanges its setup token
 * for stored access, all in one form. Reconnecting a rejected connection has no provider to pick and
 * replaces its credential in place
 *
 * A connection reaches every bank account the user holds with the provider, so connecting links
 * nothing by itself. Each account then chooses one of them. A refused token is about the token, so
 * its reason sits on that field, and anything else, such as the Bridge being out of reach, sits beside
 * the actions. Callers remount it with a key for each opening, so nothing typed carries over
 */
export function ConnectModal({
  open,
  providers,
  reconnecting,
  connections,
  level = 'page',
  onClose,
  onClaimUnanswered,
}: ConnectModalProps) {
  const { showToast } = useToast()
  const { user } = useAuth()
  const claim = useClaimSetupToken()
  const reconnect = useReconnectBankConnection()
  const [providerId, setProviderId] = useState<BankProviderId | null>(providers[0]?.id ?? null)
  const [setupToken, setSetupToken] = useState('')
  const [nickname, setNickname] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<UnansweredClaim | null>(null)

  // The wait reads as the claim still in flight, since from the user's side it is: it lasts no longer
  // than a claim answered in time may take. Unlike a claim in flight, it can be closed, since the
  // section lists the connection if one comes
  const sending = claim.isPending || reconnect.isPending
  const busy = sending || unanswered !== null
  const saved = unanswered ? connections?.find((connection) => !unanswered.knownIds.has(connection.id)) : undefined
  const settled = saved !== undefined && isClaimSettled(saved)
  const provider = providers.find((entry) => entry.id === providerId)
  const providerName = reconnecting?.provider_name ?? provider?.name ?? 'SimpleFIN'
  const site = providerSite({
    provider: reconnecting?.provider ?? providerId ?? 'simplefin',
    provider_name: providerName,
  })

  const reportAnswered = (cause: ApiError) => {
    if (cause.status === 422) {
      setTokenError(cause.message)
      return
    }
    setError(cause.message)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const token = setupToken.trim()
    if (busy || !token) return
    const lengthProblem = describeSetupTokenLength(token)
    if (lengthProblem) {
      setTokenError(lengthProblem)
      return
    }
    setTokenError(null)
    setError(null)

    if (reconnecting) {
      reconnect.mutate(
        { connectionId: reconnecting.id, setupToken: token },
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
      { provider: providerId, setup_token: token, nickname },
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
          else setError(UNANSWERED_CLAIM_MESSAGE)
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
      else setError(UNANSWERED_CLAIM_MESSAGE)
    }, unanswered.endsAt - Date.now())
    return () => window.clearTimeout(timer)
  }, [open, unanswered, saved, settled, showToast, onClose])

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
          submitUnavailable={(!reconnecting && !providerId) || !setupToken.trim()}
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
              options={providers.map((entry) => ({
                value: entry.id,
                label: entry.name,
                description: entry.description,
              }))}
              value={providerId ?? ''}
              disabled={busy}
              onChange={(value) => {
                setError(null)
                setTokenError(null)
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
            {site} no longer accepts this connection. Create a new setup token there and paste it below. Linked accounts
            pick up where they stopped.
          </WarningCallout>
        ) : (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            One connection reaches every bank account you added in {site}. Connecting links nothing yet: each account
            then chooses its bank account.
          </p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          <li>Open {site} and connect your banks there.</li>
          <li>Create a setup token. It works once and expires if unused.</li>
          <li>Paste it here. Lumina Finance exchanges it for access and never sees your bank login.</li>
        </ol>
        <div>
          <CreateModalFieldLabelRow
            htmlFor={FIELD_IDS.setupToken}
            label="Setup token"
            error={tokenError ?? undefined}
          />
          <textarea
            id={FIELD_IDS.setupToken}
            className={`app-input h-24 w-full resize-none py-2.5 font-mono text-xs ${tokenError ? 'app-input-error' : ''}`}
            value={setupToken}
            placeholder="Paste the token"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={tokenError ? true : undefined}
            disabled={busy}
            onChange={(event) => {
              setTokenError(null)
              setSetupToken(event.target.value)
            }}
          />
        </div>
      </div>
    </ModalTitledPanel>
  )
}
