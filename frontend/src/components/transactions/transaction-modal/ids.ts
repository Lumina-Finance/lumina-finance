import { createContext, useContext } from 'react'
import {
  TRANSACTION_MODAL_ERROR_IDS,
  TRANSACTION_MODAL_FIELD_IDS,
} from '@/components/transactions/transaction-modal/constants'

/**
 * Added to every element id in a transaction modal. The refund modal opens over the modal of the
 * expense it refunds, and two dialogs holding the same ids would label, focus and describe each
 * other's fields. The first modal has none, so its ids stay as they have always been
 */
export const TransactionModalIdSuffix = createContext('')

/**
 * The ids of the open transaction modal's fields and controls, unique among the modals on screen
 */
export function useTransactionModalIds() {
  return getTransactionModalIds(useContext(TransactionModalIdSuffix))
}

/**
 * The same ids for a given suffix, for the modal itself. It sits above the provider that hands its
 * suffix to everything inside it
 */
export function getTransactionModalIds(suffix: string) {
  return {
    kind: `txn-kind${suffix}`,
    direction: `txn-direction${suffix}`,
    account: `${TRANSACTION_MODAL_FIELD_IDS.account}${suffix}`,
    counterpartyAccount: `${TRANSACTION_MODAL_FIELD_IDS.counterpartyAccount}${suffix}`,
    merchant: `${TRANSACTION_MODAL_FIELD_IDS.merchant}${suffix}`,
    category: `${TRANSACTION_MODAL_FIELD_IDS.category}${suffix}`,
    tags: `${TRANSACTION_MODAL_FIELD_IDS.tags}${suffix}`,
    currency: `${TRANSACTION_MODAL_FIELD_IDS.currency}${suffix}`,
    date: `txn-date${suffix}`,
    amount: `txn-amount${suffix}`,
    notes: `txn-notes${suffix}`,
    keepOpen: `txn-keep-open${suffix}`,
    symmetricTransfer: `txn-symmetric-transfer${suffix}`,
    title: `create-txn-title${suffix}`,
    errors: Object.fromEntries(
      Object.entries(TRANSACTION_MODAL_ERROR_IDS).map(([field, id]) => [field, `${id}${suffix}`]),
    ) as typeof TRANSACTION_MODAL_ERROR_IDS,
  }
}

/** The control each validated field hands focus to when a refused press lands on it, for the modal with this suffix */
export function suffixControlIds<T extends Record<string, string>>(controlIds: T, suffix: string): T {
  return Object.fromEntries(Object.entries(controlIds).map(([field, id]) => [field, `${id}${suffix}`])) as T
}
