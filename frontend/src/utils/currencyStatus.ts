/** Whether the currency list is in hand, on its way, or not coming without another page load */
export type CurrencyListState = 'ready' | 'loading' | 'unavailable'

/** Stands in for the currency in a field that cannot name it yet */
export const CURRENCY_LIST_LOADING = 'Loading currencies...'

/** Shown beside a currency field once the list has failed */
export const CURRENCY_LIST_NOTICE = "We can't load the currency list right now. Refresh the page to try again."

/** Shown beside an amount field standing down, which needs the currency's decimal places to say anything */
export const CURRENCY_AMOUNT_NOTICE = "We can't load the currency list right now, so this amount can't be shown or changed. Refresh the page to try again."

/** Shown in that field's place when the list did load but does not carry that amount's own currency */
export const CURRENCY_AMOUNT_UNKNOWN = "We don't have the decimal places for this amount's currency, so it can't be shown or changed."

/** Shown when a form that creates something with an amount is refused because the list failed */
export const CURRENCY_LIST_REFUSAL = "We can't load the currency list right now. Refresh the page to try again."

/** Shown when that same form is refused only because the list has not arrived yet */
export const CURRENCY_LOADING_REFUSAL = 'The currency list is still loading. Try again in a moment.'
