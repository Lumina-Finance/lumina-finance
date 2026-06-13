export interface ProfileFormState {
  first_name: string
  last_name: string
  tz: string
}

// last_name is stored as "" in the form so the input stays controlled; save
// translates it back to null when clearing the backend column.
export function profileFormFromUser(user: {
  first_name: string
  last_name: string | null
  tz: string
}): ProfileFormState {
  return {
    first_name: user.first_name,
    last_name: user.last_name ?? '',
    tz: user.tz,
  }
}
