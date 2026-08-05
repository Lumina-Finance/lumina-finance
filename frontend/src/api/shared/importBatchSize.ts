/**
 * The request-size budget both import flows split their uploads to, and the measurements they
 * decide each batch against
 */

const MAX_IMPORT_BATCH_BYTES = 750 * 1024;
const TARGET_IMPORT_BATCH_BYTES = 650 * 1024;
const IMPORT_BATCH_YIELD_INTERVAL = 250;
const IMPORT_PAYLOAD_ENCODER = new TextEncoder();

// Account or category mappings one batch may carry, matching what the API accepts. A batch is
// closed on this as well as on its byte budget, because mappings are small: a file with well over a
// thousand distinct category values fits them all inside the byte budget and would otherwise build
// one batch the API refuses and re-batching cannot fix
const MAX_IMPORT_BATCH_MAPPINGS = 1_000;

// Rows one batch may carry, matching what the API accepts. The byte budget keeps a batch of
// ordinary rows well under this on its own, so the count is what holds when rows are unusually
// small rather than something a normal file ever reaches
const MAX_IMPORT_BATCH_ROWS = 5_000;

export {
  IMPORT_BATCH_YIELD_INTERVAL,
  MAX_IMPORT_BATCH_BYTES,
  MAX_IMPORT_BATCH_MAPPINGS,
  MAX_IMPORT_BATCH_ROWS,
  TARGET_IMPORT_BATCH_BYTES,
};

/**
 * Measures what one more item costs an array, counting the comma before it
 */
export function getNextArrayItemByteSize(currentLength: number, value: unknown) {
  return getJsonByteSize(value) + (currentLength > 0 ? 1 : 0);
}

/**
 * Measures the wrapper an import request carries before any of its contents
 */
export function getEmptyImportPayloadByteSize() {
  return getJsonByteSize({ accounts: [], categories: [], rows: [] });
}

/**
 * Yields during large imports so the browser can paint between batch-building chunks
 *
 * Uses the global timer rather than the one on `window`, which is the same function in a browser
 * and is what lets the batching be exercised outside one
 */
export function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export function getJsonByteSize(value: unknown) {
  return IMPORT_PAYLOAD_ENCODER.encode(JSON.stringify(value)).length;
}
