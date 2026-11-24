type DeletionDateProps = {
  /** The date as the user's format writes it */
  children: string
}

/** A date a deletion runs on, kept on one line so a narrow screen never splits the month from the day and year */
export function DeletionDate({ children }: DeletionDateProps) {
  return <span className="whitespace-nowrap">{children}</span>
}
