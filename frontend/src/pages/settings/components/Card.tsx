import type React from 'react'

/**
 * Card surface every settings pane sits on, kept shrinkable so long values inside cannot
 * stretch the grid column it lives in
 */
export default function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-card min-w-0">
      {children}
    </div>
  )
}
