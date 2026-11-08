import type { BankProvidersResponse } from '@/api/bank-sync/types'

/**
 * Whether the deployment lets the user link through one of its providers. Until the providers are read
 * the answer is no, so a deployment without bank sync never shows a bank screen, even for a moment
 *
 * @param providers - The deployment's providers and whether the user may link, undefined until read
 */
export function offersBankSync(providers: BankProvidersResponse | undefined): boolean {
  return providers !== undefined && providers.may_link && providers.providers.length > 0
}
