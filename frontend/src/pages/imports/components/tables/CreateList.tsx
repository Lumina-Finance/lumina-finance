/**
 * Lists source values that will each be created or matched by name during import, since these
 * sources have no mapping step of their own
 */
export function ImportCreateList({
  sourceLabel,
  rows,
}: {
  sourceLabel: string
  rows: string[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed min-w-[42rem] text-left text-[0.9375rem]">
        <colgroup>
          <col className="w-[45%]" />
          <col />
        </colgroup>
        <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{sourceLabel}</th>
            <th className="px-4 py-2.5 font-medium">Import Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <td className="px-4 py-2 align-middle">
                <p className="truncate font-medium" title={row}>{row}</p>
              </td>
              <td className="px-4 py-2 align-middle">
                <span className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
                  Create or use existing by name
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
