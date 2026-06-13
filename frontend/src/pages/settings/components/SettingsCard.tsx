import type React from 'react'

export default function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-card min-w-0">
      {children}
    </div>
  )
}
