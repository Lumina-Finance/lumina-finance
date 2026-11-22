import { useDataExport } from '@/api/user'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { useToast } from '@/hooks/useToast'
import { getDataExportFilename } from '@/pages/settings/utils/dataExport'
import { getDownloadFailureMessage } from '@/utils/downloadFailure'
import { saveBlobAsFile } from '@/utils/downloadFile'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

/**
 * Downloads everything the user owns as one ZIP of CSV files, named for the user's today
 *
 * The settings page owns the download, so it finishes after the compact menu holding its button
 * closes. A failure shows the shared download failure message
 */
export function useExportAllData(): { exportAllData: () => void; isExporting: boolean } {
  const dataExport = useDataExport({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })
  const { showToast } = useToast()
  const today = useTodayYmd()

  function exportAllData() {
    dataExport.mutate(undefined, {
      onSuccess: (file) => saveBlobAsFile(file, getDataExportFilename(today)),
      onError: (exportError) => showToast({ status: 'error', text: getDownloadFailureMessage(exportError) }),
    })
  }

  return { exportAllData, isExporting: dataExport.isPending }
}
