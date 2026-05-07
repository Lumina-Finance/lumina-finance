export default function CategoryRow({ label }: { label: string }) {
  return (
    <div
      className="flex h-8 items-center rounded-lg px-3 text-sm"
      style={{ background: 'var(--app-bg)', color: 'var(--app-text-muted)' }}
    >
      <span className="truncate">{label}</span>
    </div>
  )
}
