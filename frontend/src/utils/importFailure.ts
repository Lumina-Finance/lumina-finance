/**
 * What an import shows the user when it fails
 *
 * Both the request layer and the import pages need this, and the request layer cannot reach into a
 * page, so the message and the reading of it live here rather than beside either caller
 */

// Shown when an import fails with nothing usable to show for it, which is a rejection carrying no
// message and anything thrown that is not an error at all. It says nothing about which record failed,
// so a caller matching a detail against its own records must leave this one out
export const GENERIC_IMPORT_FAILURE = 'Import failed.'

/**
 * Reads a user-facing message off a failed import
 *
 * A rejection that is not an error, and one carrying an empty message, both fall back, since an
 * empty message reaches the user as a failure notice with nothing in it
 */
export function getImportFailureMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : GENERIC_IMPORT_FAILURE
}
