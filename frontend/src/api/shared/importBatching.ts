import {
  IMPORT_BATCH_YIELD_INTERVAL,
  MAX_IMPORT_BATCH_BYTES,
  MAX_IMPORT_BATCH_MAPPINGS,
  MAX_IMPORT_BATCH_ROWS,
  TARGET_IMPORT_BATCH_BYTES,
  getEmptyImportPayloadByteSize,
  getNextArrayItemByteSize,
  yieldToBrowser,
} from '@/api/shared/importBatchSize';

/**
 * The mappings a prepared import carries, keyed by the batch field each list is sent in, and each
 * looked up by the source its rows name
 */
type ImportMappingsByKind = { accounts: Map<string, unknown> } & Record<string, Map<string, unknown>>;

type MappingSources<Mappings> = { [Kind in keyof Mappings]: string[] };

type MappingValue<Lookup> = Lookup extends Map<string, infer Mapping> ? Mapping : never;

export type ImportBatch<Row, Mappings> = { [Kind in keyof Mappings]: MappingValue<Mappings[Kind]>[] } & {
  rows: Row[];
  start_row_index: number;
};

interface ImportBatchOptions<Row, Mappings> {
  rows: Row[];
  mappings: Mappings;

  // The mapping sources one row references, for every kind the import maps
  getRowSources: (row: Row) => MappingSources<Mappings>;

  // Sources no row references that still travel with the first batch, since the server only takes
  // a batch that holds rows
  firstBatchSources?: Partial<MappingSources<Mappings>>;
}

/**
 * Splits a prepared import into batches that each fit the request-size budget
 *
 * Nothing is created while an import is staged, so a batch carries the mappings its own rows
 * reference exactly as they were prepared, and no batch depends on what an earlier one returned
 */
export async function buildImportBatches<Row, Mappings extends ImportMappingsByKind>(
  options: ImportBatchOptions<Row, Mappings>,
): Promise<ImportBatch<Row, Mappings>[]> {
  const batches: ImportBatch<Row, Mappings>[] = [];
  let rowIndex = 0;

  while (rowIndex < options.rows.length) {
    const batch = await buildNextImportBatch(options, rowIndex);
    batches.push(batch.payload);
    rowIndex = batch.nextRowIndex;
  }

  return batches;
}

/**
 * Builds the next batch without exceeding the request-size budget
 */
async function buildNextImportBatch<Row, Mappings extends ImportMappingsByKind>(
  { rows: sourceRows, mappings, getRowSources, firstBatchSources }: ImportBatchOptions<Row, Mappings>,
  startIndex: number,
) {
  const kinds = Object.keys(mappings) as (keyof Mappings & string)[];
  const sourcesByKind = new Map(kinds.map((kind) => [kind, new Set<string>()]));
  const rows: Row[] = [];
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  if (startIndex === 0) {
    for (const kind of kinds) {
      const sources = sourcesByKind.get(kind)!;
      for (const source of firstBatchSources?.[kind] ?? []) {
        estimatedBytes += getNextMappingByteSize(source, sources, mappings[kind], kind);
        sources.add(source);
      }
    }
  }

  // Each row may introduce mappings of every kind, so the batch budget tracks them all
  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    const rowSources = getRowSources(row);
    let nextEstimatedBytes = estimatedBytes + getNextArrayItemByteSize(rows.length, row);
    let hasTooManyMappings = false;
    for (const kind of kinds) {
      const sources = sourcesByKind.get(kind)!;
      for (const source of rowSources[kind]) {
        nextEstimatedBytes += getNextMappingByteSize(source, sources, mappings[kind], kind);
      }

      // Mappings are small enough that a file with many distinct values fills the count long
      // before it fills the byte budget, so both are what closes a batch
      hasTooManyMappings ||= countWithNewSources(sources, rowSources[kind]) > MAX_IMPORT_BATCH_MAPPINGS;
    }

    const isBatchFull = nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES
      || rows.length >= MAX_IMPORT_BATCH_ROWS
      || hasTooManyMappings;

    if (rows.length > 0 && isBatchFull) break;
    if (rows.length === 0 && nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to upload safely.');
    }

    rows.push(row);
    for (const kind of kinds) {
      const sources = sourcesByKind.get(kind)!;
      for (const source of rowSources[kind]) sources.add(source);
    }
    estimatedBytes = nextEstimatedBytes;
    rowIndex += 1;

    if ((rowIndex - startIndex) % IMPORT_BATCH_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  if (rows.length === 0) throw new Error('No import rows are available to upload.');

  // The server takes at least one account mapping per batch, and every row the browser uploads
  // writes to an account, so a batch without one means a row that should have been left out
  if (sourcesByKind.get('accounts')!.size === 0) throw new Error('An import batch writes to no account.');

  const batchMappings = Object.fromEntries(kinds.map((kind) => [
    kind,
    [...sourcesByKind.get(kind)!].map((source) => getMapping(source, mappings[kind], kind)),
  ]));
  return {
    payload: { ...batchMappings, rows, start_row_index: startIndex } as ImportBatch<Row, Mappings>,
    nextRowIndex: rowIndex,
  };
}

/**
 * Counts what a set would hold once the given sources were added to it
 */
function countWithNewSources(sources: Set<string>, candidates: string[]) {
  const added = new Set(candidates.filter((source) => !sources.has(source)));
  return sources.size + added.size;
}

const MAPPING_LABELS: Record<string, string> = {
  accounts: 'Account',
  categories: 'Category',
  merchants: 'Merchant',
};

/**
 * Returns the mapping for a source the payload must already carry
 */
function getMapping<T>(source: string, mappingsBySource: Map<string, T>, kind: string): T {
  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`${MAPPING_LABELS[kind] ?? kind} source is not mapped: ${source}`);
  return mapping;
}

/**
 * Estimates the bytes a source adds to a batch that does not carry it yet
 */
function getNextMappingByteSize<T>(source: string, sources: Set<string>, mappingsBySource: Map<string, T>, kind: string) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(sources.size, getMapping(source, mappingsBySource, kind));
}
