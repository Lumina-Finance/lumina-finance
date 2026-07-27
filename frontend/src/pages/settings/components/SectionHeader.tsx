import type React from 'react'

/**
 * Title and description heading above a settings section, wrapping a plain string description
 * in a paragraph and rendering anything richer as it was given
 */
export default function SettingsSectionHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="app-section-header">
      <h2 className="app-section-title">{title}</h2>
      <div className="app-section-description space-y-2">
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    </div>
  )
}
