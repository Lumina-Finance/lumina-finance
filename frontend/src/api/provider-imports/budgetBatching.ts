import type { ImportBudgetDraft, ImportRunBudgets, ImportRunBudgetsPart } from '@/api/provider-imports/types'
import {
  MAX_IMPORT_BATCH_BYTES,
  MAX_IMPORT_BATCH_MAPPINGS,
  TARGET_IMPORT_BATCH_BYTES,
  getJsonByteSize,
  getNextArrayItemByteSize,
} from '@/api/shared/importBatchSize'

/**
 * Splits the budgets an import creates into parts that each fit the request-size budget
 *
 * A part carries only the category mappings its own budgets name, so no part depends on another,
 * and each says where it starts among all the budgets. A part closes on its bytes and on the
 * mappings the server takes in one request, as the row batches do
 *
 * @throws When one budget alone is more than a request can carry
 */
export function buildImportBudgetParts(budgets: ImportRunBudgets): ImportRunBudgetsPart[] {
  const mappingsBySource = new Map(budgets.categories.map((mapping) => [mapping.source, mapping]))
  const parts: ImportRunBudgetsPart[] = []
  let startIndex = 0

  while (startIndex < budgets.budgets.length) {
    const part = buildNextBudgetPart(budgets.budgets, mappingsBySource, startIndex)
    parts.push(part)
    startIndex += part.budgets.length
  }

  return parts
}

/**
 * Builds the next part without exceeding the request-size budget
 */
function buildNextBudgetPart(
  drafts: ImportBudgetDraft[],
  mappingsBySource: Map<string, ImportRunBudgets['categories'][number]>,
  startIndex: number,
): ImportRunBudgetsPart {
  const part: ImportRunBudgetsPart = { categories: [], budgets: [], start_index: startIndex }
  let estimatedBytes = getJsonByteSize(part)

  for (const draft of drafts.slice(startIndex)) {
    const newMappings = [...new Set(draft.category_sources)]
      .filter((source) => !part.categories.some((mapping) => mapping.source === source))
      .flatMap((source) => mappingsBySource.get(source) ?? [])

    let nextEstimatedBytes = estimatedBytes + getNextArrayItemByteSize(part.budgets.length, draft)
    newMappings.forEach((mapping, index) => {
      nextEstimatedBytes += getNextArrayItemByteSize(part.categories.length + index, mapping)
    })
    const hasTooManyMappings = part.categories.length + newMappings.length > MAX_IMPORT_BATCH_MAPPINGS

    if (part.budgets.length > 0 && (nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES || hasTooManyMappings)) break
    if (part.budgets.length === 0 && (nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES || hasTooManyMappings)) {
      throw new Error(`The ${draft.name} budget is too large to upload safely.`)
    }

    part.budgets.push(draft)
    part.categories.push(...newMappings)
    estimatedBytes = nextEstimatedBytes
  }

  return part
}
