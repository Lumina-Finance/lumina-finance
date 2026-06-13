export type MerchantMarketMerchant = {
  id: string
  name: string
  totalAmount: number
  changePct: number | null
  changeAmount: number | null
}

export type MerchantMarketTile = MerchantMarketMerchant & {
  x: number
  y: number
  width: number
  height: number
}
