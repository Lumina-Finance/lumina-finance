import {
  CREATE_TAG_VALUE,
  SKIP_TAG_VALUE,
  TAG_MATCHES_LOAD_FAILURE_EXPLANATION,
  TAG_MATCHES_LOAD_FAILURE_TITLE,
} from '@/pages/imports/constants'
import { EmptyState, ImportLoadFailure, ImportStep, ImportValueMatchTable } from '@/pages/imports/components'
import type { TransactionImportWorkflow } from '@/pages/imports/hooks'
import { getImportTagRowState } from '@/pages/imports/utils'
import { getNameKey } from '@/api/shared/nameKey'

type ImportTagMatchingStepProps = Pick<
  TransactionImportWorkflow,
  | 'importedTags'
  | 'tagMappings'
  | 'tagCreateNames'
  | 'setTagMappings'
  | 'setTagCreateNames'
  | 'matchedTagByKey'
  | 'tagOptions'
  | 'rememberPickedTag'
  | 'tagSearch'
  | 'setTagSearch'
  | 'tagSearchLoading'
  | 'hasMoreTagResults'
  | 'loadMoreTagResults'
  | 'tagMatchesLoading'
  | 'tagMatchesFailed'
  | 'refetchTagMatches'
  | 'importResult'
>

/**
 * Tag matching step of the generic CSV import flow, showing every tag name found in the mapped
 * column against the tag it will be filed under, which the user can change, rename or skip before
 * anything is created
 */
export function ImportTagMatchingStep({
  importedTags,
  tagMappings,
  tagCreateNames,
  setTagMappings,
  setTagCreateNames,
  matchedTagByKey,
  tagOptions,
  rememberPickedTag,
  tagSearch,
  setTagSearch,
  tagSearchLoading,
  hasMoreTagResults,
  loadMoreTagResults,
  tagMatchesLoading,
  tagMatchesFailed,
  refetchTagMatches,
  importResult,
}: ImportTagMatchingStepProps) {
  const isAnswerLocked = tagMatchesLoading || Boolean(importResult)

  // Tags are asked about again once an import has run, and a file's tag then matches the tag the
  // import created from it. The record shows the tag as created, the way it was imported
  const createdByImport = new Set(importResult?.created_tag_ids)

  return (
    <ImportStep
      index="06"
      title="Tag matching"
      description="Match each tag name in this import to the tag its rows will carry. Skip leaves a tag off its rows."
    >
      {tagMatchesFailed ? (
        <ImportLoadFailure
          title={TAG_MATCHES_LOAD_FAILURE_TITLE}
          description={TAG_MATCHES_LOAD_FAILURE_EXPLANATION}
          onRetry={refetchTagMatches}
        />
      ) : importedTags.length === 0 ? (
        <EmptyState title="No tags yet" description="Map the column holding the tags first." />
      ) : (
        <ImportValueMatchTable
          sourceLabel="Tag from file"
          detailLabel="Name to create"
          targetLabel="Tag"
          createValue={CREATE_TAG_VALUE}
          rows={importedTags.map((value) => {
            const answer = tagMappings[value] ?? ''
            const found = matchedTagByKey.get(getNameKey(value))
            const matched = found && !createdByImport.has(found.id) ? found : undefined
            const rowState = getImportTagRowState(answer, matched)

            return {
              id: value,
              source: value,

              // The matched tag is what the commit would use without being asked, so the row opens
              // on it rather than on a blank the user has to answer
              value: answer || (matched ? matched.id : CREATE_TAG_VALUE),

              // The glow tells the user a row was filled in for them to check, which means nothing
              // on a finished import's record or while the matches are still loading
              autoFilled: !answer && !isAnswerLocked,

              // A row filed under a tag that already exists creates nothing, so the name it would
              // create is greyed out rather than taken away, and the column keeps its shape
              excluded: rowState === 'skipped',
              detailNode: (
                <input
                  type="text"
                  className={`app-field-focus-visible w-full rounded-lg px-3 py-1.5 text-sm transition-[border-color,box-shadow,opacity] ${rowState === 'creating' ? '' : 'opacity-60'}`}
                  style={{
                    background: 'var(--app-input-bg)',
                    color: 'var(--app-text)',
                    border: '1px solid var(--app-border)',
                  }}
                  value={tagCreateNames[value] ?? value}
                  aria-label={`Name for the tag created from ${value}`}
                  onChange={(event) =>
                    setTagCreateNames((current) => ({
                      ...current,
                      [value]: event.target.value,
                    }))
                  }
                  disabled={isAnswerLocked || rowState !== 'creating'}
                />
              ),
              onChange: (nextValue) => {
                // A tag is held on to as it is chosen, since the option it came from goes when the
                // search that found it clears. The two actions are always offered
                const isTag = nextValue !== CREATE_TAG_VALUE && nextValue !== SKIP_TAG_VALUE
                const picked = isTag && tagOptions.find((option) => option.value === nextValue)
                if (picked) rememberPickedTag(nextValue, picked.label)
                setTagMappings((current) => ({ ...current, [value]: nextValue }))
              },
            }
          })}
          options={tagOptions}
          disabled={isAnswerLocked}
          searchValue={tagSearch}
          onSearchChange={setTagSearch}
          isLoading={tagSearchLoading}
          hasMore={hasMoreTagResults}
          onLoadMore={loadMoreTagResults}
        />
      )}
    </ImportStep>
  )
}
