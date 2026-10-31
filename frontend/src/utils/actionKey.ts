/**
 * The keys a user can hold with a letter to reach a field in the transaction dialogue. Only Alt (Option
 * on a Mac) is offered, since Control and Command belong to the browser and the system, such as
 * Control+W closing the tab, and Shift types capitals. Left Alt leaves the right one free to type the
 * symbols some layouts put on it
 */
export const ACTION_KEY_CHOICES = ['alt', 'left-alt'] as const

export type ActionKeySetting = (typeof ACTION_KEY_CHOICES)[number]

// What a new account starts on, and what the dialogue uses while nobody is signed in
export const DEFAULT_ACTION_KEY: ActionKeySetting = 'alt'
