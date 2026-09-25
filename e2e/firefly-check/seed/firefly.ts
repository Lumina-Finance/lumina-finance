/**
 * The few Firefly III API calls the seed makes, over its personal access token
 */
export class FireflyClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  /**
   * Sends one request and returns the parsed JSON body, failing with the start of the body when
   * Firefly III refuses it, since its validation messages name the field at fault
   */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body, 'application/json')
    const text = await response.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /**
   * Downloads one export file as the text Firefly III writes. Its API refuses a CSV Accept header
   * and sends the file under the JSON one
   */
  async download(path: string): Promise<string> {
    const response = await this.send('GET', path, undefined, 'application/json')
    return response.text()
  }

  /** Reads every page of a list endpoint */
  async list<T>(path: string): Promise<T[]> {
    const items: T[] = []
    const separator = path.includes('?') ? '&' : '?'
    for (let page = 1; ; page += 1) {
      const result = await this.call<FireflyPage<T>>('GET', `${path}${separator}limit=200&page=${page}`)
      items.push(...result.data)
      if (page >= result.meta.pagination.total_pages) return items
    }
  }

  private async send(method: string, path: string, body: unknown, accept: string) {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 800)
      throw new Error(`${method} ${path} failed with ${response.status}: ${detail}`)
    }
    return response
  }
}

interface FireflyPage<T> {
  data: T[]
  meta: { pagination: { total_pages: number } }
}

/** One resource in a Firefly III API response */
export interface FireflyResource<A> {
  id: string
  attributes: A
}

export interface FireflyAccountAttributes {
  name: string
  type: string
  active: boolean
  account_role: string | null
  liability_type: string | null
  liability_direction: string | null
  currency_code: string
  current_balance: string
}

export interface FireflySplit {
  type: string
  date: string
  amount: string
  currency_code: string
  foreign_amount: string | null
  foreign_currency_code: string | null
  description: string
  source_name: string
  source_type: string
  destination_name: string
  destination_type: string
  category_name: string | null
  budget_name: string | null
  tags: string[]
  notes: string | null
}

export interface FireflyTransactionGroupAttributes {
  group_title: string | null
  transactions: FireflySplit[]
}

export interface FireflyBudgetAttributes {
  name: string
  active: boolean
}

export interface FireflyBudgetLimitAttributes {
  start: string
  end: string
  amount: string
  currency_code: string
}
