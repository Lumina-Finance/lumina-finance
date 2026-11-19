import emojiMartDataUrl from '@emoji-mart/data/sets/15/native.json?url'
import { explainRequestFailure } from '@/api/server'

export interface EmojiMartData {
  emojis?: Record<string, unknown>
}

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
 *
 * The dataset is a file of the app's own build, downloaded from the app's own server when a picker
 * first opens. It is fetched rather than imported as a module, since a browser keeps a failed module
 * import until the page reloads, while a failed fetch is forgotten, so a later call fetches again
 */
export function loadEmojiMartData(): Promise<EmojiMartData> {
  if (!emojiMartDataPromise) {
    emojiMartDataPromise = fetch(emojiMartDataUrl)
      .catch((error: unknown) => {
        throw explainRequestFailure(error)
      })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load emoji data.')
        // A tab left open across an upgrade asks for a file name that no longer exists. The server answers
        // with the app's page, so the body is not JSON and the browser's parser message must stay hidden
        const data = (await response.json().catch(() => {
          throw new Error('Failed to load emoji data.')
        })) as EmojiMartData
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
