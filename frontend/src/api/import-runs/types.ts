/** The run an import is uploaded and saved under */
export interface ImportRun {
  id: string;
}

/**
 * What opening a run states: how many rows it will write, and, for an import from another app,
 * which app, since a run takes requests only from the importer that opened it
 */
export interface OpenImportRunRequest {
  expected_transaction_count: number;
  source?: string;
}

/**
 * Where under a run an import uploads its batches and saves them, which is the one part of a run's
 * life that differs between the CSV import and the imports from other apps
 */
export interface ImportRunRoutes {
  rows: string;
  commit: string;
}
