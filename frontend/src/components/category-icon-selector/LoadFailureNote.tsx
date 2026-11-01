/**
 * Says why the emoji list could not be loaded, in the flow of the page directly under the icon button
 *
 * The note takes no floating layer of its own: a layer below the button lands on whatever the form
 * draws next, such as the following section's title and field label, and the room it needs is
 * only wanted while it shows. It is zero wide in the layout, so the button's column keeps its width and
 * only the row grows taller, while the text runs on to the right under the neighbouring field
 */
export function LoadFailureNote({ message }: { message: string }) {
  return (
    <div className="w-0 overflow-visible">
      <p
        role="alert"
        className="mt-2 w-60 rounded-md border px-3 py-2 text-sm"
        style={{
          background: 'var(--app-negative-soft)',
          borderColor: 'var(--app-negative-border)',
          color: 'var(--app-negative)',
        }}
      >
        {message}
      </p>
    </div>
  )
}
