import {
  CREATE_MERCHANT_VALUE,
  MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION,
  MERCHANT_MATCHES_LOAD_FAILURE_TITLE,
  SKIP_MERCHANT_VALUE,
} from '@/pages/imports/constants'
import { EmptyState, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getImportMerchantRowState } from '@/pages/imports/utils'
import { getNameKey } from '@/api/shared/nameKey'

type ImportMerchantMatchingStepProps = Pick<
  TransactionImportWorkflow,
  | 'importedMerchants'
  | 'merchantMappings'
  | 'merchantCreateNames'
  | 'setMerchantMappings'
  | 'setMerchantCreateNames'
  | 'matchedMerchantByKey'
  | 'merchantOptions'
  | 'rememberPickedMerchant'
  | 'merchantSearch'
  | 'setMerchantSearch'
  | 'merchantSearchLoading'
  | 'hasMoreMerchantResults'
  | 'loadMoreMerchantResults'
  | 'matchesLoading'
  | 'matchesFailed'
  | 'refetchMatches'
  | 'importResult'
>

/**
 * Merchant matching step of the generic CSV import flow, showing every merchant name found in the
 * mapped column against the merchant it will be filed under, which the user can change, rename or
 * skip before anything is created, and only see once the import has run
 */
export function ImportMerchantMatchingStep({
  importedMerchants,
  merchantMappings,
  merchantCreateNames,
  setMerchantMappings,
  setMerchantCreateNames,
  matchedMerchantByKey,
  merchantOptions,
  rememberPickedMerchant,
  merchantSearch,
  setMerchantSearch,
  merchantSearchLoading,
  hasMoreMerchantResults,
  loadMoreMerchantResults,
  matchesLoading,
  matchesFailed,
  refetchMatches,
  importResult,
}: ImportMerchantMatchingStepProps) {
  const isAnswerLocked = matchesLoading || Boolean(importResult)

  // Merchants are asked about again once an import has run, and a file's merchant then matches the
  // merchant the import created from it. The record shows the merchant as created, the way it was imported
  const createdByImport = new Set(importResult?.created_merchant_ids)

  return (
    <ImportStep
      index="05"
      title="Merchant matching"
      description="Match each merchant name in this import to the merchant its rows will be filed under."
    >
      {matchesFailed ? (
        <ImportLoadFailure
          title={MERCHANT_MATCHES_LOAD_FAILURE_TITLE}
          description={MERCHANT_MATCHES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchMatches}
        />
      ) : importedMerchants.length === 0 ? (
        <EmptyState title="No merchants yet" description="Map the column holding the merchant first." />
      ) : (
        <ImportValueMatchTable
          sourceLabel="Merchant from file"
          detailLabel="Name to create"
          targetLabel="Merchant"
          createValue={CREATE_MERCHANT_VALUE}
          rows={importedMerchants.map((value) => {
            const answer = merchantMappings[value] ?? ''
            const found = matchedMerchantByKey.get(getNameKey(value))
            const matched = found && !createdByImport.has(found.id) ? found : undefined
            const rowState = getImportMerchantRowState(answer, matched)

            return {
              id: value,
              source: value,

              // The matched merchant is what the commit would use without being asked, so the row
              // opens on it rather than on a blank the user has to answer
              value: answer || (matched ? matched.id : CREATE_MERCHANT_VALUE),
              // The glow tells the user a row was filled in for them to check, which means nothing on a
              // finished import's record or while the matches are still loading
              autoFilled: !answer && !isAnswerLocked,
              // A row filed under a merchant that already exists creates nothing, so the name it
              // would create is greyed out rather than taken away: the column keeps its shape down
              // the table, and switching the row back to creating shows what it was already holding
              detailNode:
                rowState === 'skipped' ? (
                  <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                    Skipped
                  </span>
                ) : (
                  <input
                    type="text"
                    className={`app-field-focus-visible w-full rounded-lg px-3 py-1.5 text-sm transition-[border-color,box-shadow,opacity] ${rowState === 'creating' ? '' : 'opacity-60'}`}
                    style={{
                      background: 'var(--app-input-bg)',
                      color: 'var(--app-text)',
                      border: '1px solid var(--app-border)',
                    }}
                    value={merchantCreateNames[value] ?? value}
                    aria-label={`Name for the merchant created from ${value}`}
                    onChange={(event) =>
                      setMerchantCreateNames((current) => ({
                        ...current,
                        [value]: event.target.value,
                      }))
                    }
                    disabled={isAnswerLocked || rowState !== 'creating'}
                  />
                ),
              onChange: (nextValue) => {
                // A merchant is held on to as it is chosen, since the option it came from goes when
                // the search that found it clears, and the row would then show nothing for its own
                // answer. The two actions are always offered, so neither is worth remembering
                const isMerchant = nextValue !== CREATE_MERCHANT_VALUE && nextValue !== SKIP_MERCHANT_VALUE
                const picked = isMerchant && merchantOptions.find((option) => option.value === nextValue)
                if (picked) rememberPickedMerchant(nextValue, picked.label)
                setMerchantMappings((current) => ({ ...current, [value]: nextValue }))
              },
            }
          })}
          options={merchantOptions}
          disabled={isAnswerLocked}
          searchValue={merchantSearch}
          onSearchChange={setMerchantSearch}
          isLoading={merchantSearchLoading}
          hasMore={hasMoreMerchantResults}
          onLoadMore={loadMoreMerchantResults}
        />
      )}
    </ImportStep>
  )
}
