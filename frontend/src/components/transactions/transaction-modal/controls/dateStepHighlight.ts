import { createContext } from 'react'

/**
 * Whether the date field is lit because a bracket just stepped it from another field, or is easing back out
 * once the light has held. Null while it rests
 */
export type DateStepHighlight = 'lit' | 'fading' | null

/** The state of the light on the date field, for the field to show */
export const DateStepHighlightContext = createContext<DateStepHighlight>(null)
