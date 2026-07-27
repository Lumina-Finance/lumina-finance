export type FundFlowNodeKind = 'income' | 'expense' | 'summary' | 'retained'

export type FundFlowNode = {
  name: string
  kind: FundFlowNodeKind
  labelSide?: 'left' | 'right'
}

export type FundFlowLink = {
  source: number
  target: number
  value: number
}

export type FundFlowData = {
  nodes: FundFlowNode[]
  links: FundFlowLink[]
}
