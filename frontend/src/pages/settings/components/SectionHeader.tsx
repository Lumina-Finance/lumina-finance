import type React from 'react'

export default function SectionHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="app-section-header">
      <h2 className="app-section-title">{title}</h2>
      <div className="app-section-description space-y-2">
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    </div>
  )
}
