import { explainRequestFailure } from '@/api/server'

export interface EmojiMartData {
  emojis?: Record<string, unknown>
}

const EMOJI_MART_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data'

let emojiMartDataPromise: Promise<EmojiMartData> | null = null
let cachedEmojiMartData: EmojiMartData | null = null

/**
 * Returns the emoji dataset once it has loaded, so a selector opened later starts with it
 */
export function getCachedEmojiMartData(): EmojiMartData | null {
  return cachedEmojiMartData
}

/**
 * Loads the large emoji dataset once because multiple icon selectors can open during settings edits
 * A failed load is forgotten, so a later call fetches again
 */
export function loadEmojiMartData(): Promise<EmojiMartData> {
  if (!emojiMartDataPromise) {
    emojiMartDataPromise = fetch(EMOJI_MART_DATA_URL)
      .catch((error: unknown) => {
        throw explainRequestFailure(error)
      })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load emoji data.')
        const data = (await response.json()) as EmojiMartData
        cachedEmojiMartData = data
        return data
      })
      .catch((error: unknown) => {
        // A failed download is not kept, so the next click on the icon button fetches again
        emojiMartDataPromise = null
        throw error
      })
  }

  return emojiMartDataPromise
}
