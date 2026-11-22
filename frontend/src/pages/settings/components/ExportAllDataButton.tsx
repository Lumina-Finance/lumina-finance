import { Download, LoaderCircle } from 'lucide-react'

type ExportAllDataButtonProps = {
  exporting: boolean
  onExport: () => void
}

/**
 * Settings menu item that starts the download of all the user's data, under Import in both settings
 * menus and styled like it. While the download runs it is disabled and spins in place of its icon
 */
export default function ExportAllDataButton({ exporting, onExport }: ExportAllDataButtonProps) {
  return (
    <button type="button" className="app-nav-link" onClick={onExport} disabled={exporting} aria-busy={exporting}>
      {exporting ? (
        <LoaderCircle
          size={17}
          strokeWidth={1.75}
          className="shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      ) : (
        <Download size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
      )}
      Export all data
    </button>
  )
}
