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

  /** The name of the file the user picked, shown with the last import */
  file_name?: string;
}

/**
 * Where under a run an import uploads its batches and saves them, which is the one part of a run's
 * life that differs between the CSV import and the imports from other apps
 */
export interface ImportRunRoutes {
  rows: string;
  commit: string;
}

/** The last saved import, with when it can be undone until and what undoing it would delete and keep */
export type LastImport = {
  id: string;
  source: 'generic' | 'firefly' | 'actual_budget';
  file_name: string | null;
  committed_at: string;
  undo_until: string;

  /** The transactions the import wrote and the records it created, all of which undoing it deletes */
  transaction_count: number;
  account_count: number;
  category_count: number;
  merchant_count: number;
  tag_count: number;
  budget_count: number;
};

export type ImportUndoResult = {
  transactions_deleted: number;
  affected_account_ids: string[];
};
