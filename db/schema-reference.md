# Database Schema Reference

Last updated: 2026-03-30

All monetary values are stored as `bigint` in the currency's base units (e.g., cents for CAD/USD, 1 for JPY). This avoids floating-point rounding issues.

---

## Users & Authentication

### `users`

Core user profile. Every user has exactly one row here.


| Column          | Type         | Constraints                    | Description                                                                  |
| --------------- | ------------ | ------------------------------ | ---------------------------------------------------------------------------- |
| `id`            | uuid         | PK                             |                                                                              |
| `email`         | varchar(254) | NOT NULL, UNIQUE               | Login email; 254 char limit per RFC 3696                                     |
| `first_name`    | varchar(256) | NOT NULL                       |                                                                              |
| `last_name`     | varchar(256) |                                | Optional                                                                     |
| `profile_pic`   | text         |                                | Path/URL to profile picture                                                  |
| `tz`            | varchar(40)  | NOT NULL                       | IANA timezone identifier, auto-derived from device (e.g., `America/Toronto`) |
| `base_currency` | char(3)      | NOT NULL, FK → `currencies.id` | Mandatory base currency for aggregate views and FX conversion                |
| `created_at`    | timestamptz  | NOT NULL                       |                                                                              |


### `auth_identities`

Links a user to an authentication provider. Supports multiple providers per user (only password for now).


| Column              | Type              | Constraints               | Description                                                  |
| ------------------- | ----------------- | ------------------------- | ------------------------------------------------------------ |
| `id`                | uuid              | PK                        |                                                              |
| `user_id`           | uuid              | FK → `users.id`           |                                                              |
| `auth_provider`     | enum (`password`) | NOT NULL                  | Currently only password; designed for future OAuth providers |
| `email_verified`    | boolean           | NOT NULL, default `false` |                                                              |
| `email_verified_at` | timestamptz       |                           | Null until verified                                          |


**Unique constraint:** `(user_id, auth_provider)` — one identity per provider per user.

### `password_credentials`

Stores password hashes. One-to-one with `users` (only exists when auth provider is password).


| Column                 | Type        | Constraints           | Description                                                                 |
| ---------------------- | ----------- | --------------------- | --------------------------------------------------------------------------- |
| `user_id`              | uuid        | PK, FK → `users.id`   | One-to-one relationship                                                     |
| `password_hash`        | text        | NOT NULL              | Hashed password                                                             |
| `password_algo`        | text        | NOT NULL              | Algorithm used (e.g., `argon2id`)                                           |
| `updated_at`           | timestamptz | NOT NULL              | Last password change                                                        |
| `failed_attempt_count` | int         | NOT NULL, default `0` | Reset to 0 on successful login                                              |
| `locked_until`         | timestamptz | default `null`        | Non-null means account is temporarily locked after too many failed attempts |


---

## Groups

### `groups`

A shared financial group (e.g., a couple, family, roommates). A user can own one or more groups.

**Data lifecycle:** Deleting a group cascades to all associated accounts, categories, budgets, and their transactions. Members who leave (or are removed from) a group lose access to all shared data — there is no transfer of ownership. Users should archive a group instead of deleting it to preserve historical data.

| Column        | Type        | Constraints               | Description                                 |
| ------------- | ----------- | ------------------------- | ------------------------------------------- |
| `id`          | uuid        | PK                        |                                             |
| `owner_id`    | uuid        | NOT NULL, FK → `users.id` | The user who created and owns the group     |
| `name`        | text        |                           | Display name                                |
| `profile_pic` | text        |                           | Path/URL to group picture                   |
| `is_archived` | boolean     | NOT NULL, default `false` | Hidden from default list but data preserved |
| `created_at`  | timestamptz | NOT NULL                  |                                             |


### `group_members`

Junction table linking users to groups.


| Column         | Type    | Constraints                                | Description                                                   |
| -------------- | ------- | ------------------------------------------ | ------------------------------------------------------------- |
| `group_id`     | uuid    | PK, FK → `groups.id` ON DELETE CASCADE     |                                                               |
| `user_id`      | uuid    | PK, FK → `users.id`                       |                                                               |
| `is_admin`     | boolean | NOT NULL, default `false`                  | Admins can manage membership and have implicit full access to all group resources. Only the owner can promote/demote admins. |


### `account_permissions`

Per-account access control for group members. Admins have implicit full access and don't need explicit permission rows. Categories are visible to all group members and any member can create new ones, but only admins can edit or delete them. Transactions inherit permissions from their parent account.


| Column         | Type             | Constraints                                                          | Description                              |
| -------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`           | uuid             | PK                                                                   |                                          |
| `group_id`     | uuid             | NOT NULL, FK → `groups.id` ON DELETE CASCADE                         |                                          |
| `user_id`      | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `account_id`   | uuid             | NOT NULL, FK → `accounts.id` ON DELETE CASCADE                       |                                          |
| `level`        | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view account + transactions; `write` = also create/edit/delete transactions; `admin` = also edit/delete account |
| `created_at`   | timestamptz      | NOT NULL                                                             |                                          |

**Unique constraint:** `(group_id, user_id, account_id)` — one permission level per member per account.

**Composite FK:** `(group_id, user_id)` → `group_members(group_id, user_id) ON DELETE CASCADE` — removing a member cleans up all their permissions.


### `budget_permissions`

Per-base-budget access control for group members. Same structure as account_permissions. Permissions live on the long-lived `base_budget` and apply to all child instances under it. Budget permissions are independent of account permissions — a user with READ can see aggregated spending per category without needing account access. This enables privacy-respecting monitoring (e.g., parents see "Food: $150 / $300" without seeing individual transactions).


| Column            | Type             | Constraints                                                          | Description                              |
| ----------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`              | uuid             | PK                                                                   |                                          |
| `group_id`        | uuid             | NOT NULL, FK → `groups.id` ON DELETE CASCADE                         |                                          |
| `user_id`         | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `base_budget_id`  | uuid             | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE                   |                                          |
| `level`           | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view base + aggregated utilization; `write` = also edit base details; `admin` = also delete base + manage instances |
| `created_at`      | timestamptz      | NOT NULL                                                             |                                          |

**Unique constraint:** `(group_id, user_id, base_budget_id)` — one permission level per member per base budget.

**Composite FK:** `(group_id, user_id)` → `group_members(group_id, user_id) ON DELETE CASCADE`.


---

## Reference Data

### `institutions`

Global registry of financial institutions (banks, brokerages, etc.).


| Column         | Type                          | Constraints                          | Description                                                                  |
| -------------- | ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `id`           | uuid                          | PK                                   |                                                                              |
| `status`       | enum (`canonical`, `pending`) | NOT NULL, default `pending`          | `canonical` = verified/approved; `pending` = user-submitted, awaiting review |
| `name`         | varchar(256)                  | NOT NULL, UNIQUE(name, country_code) | e.g., "Royal Bank of Canada"                                                 |
| `country_code` | char(2)                       | NOT NULL, UNIQUE(name, country_code) | ISO 3166-1 alpha-2 (e.g., `CA`, `US`)                                        |
| `website`      | text                          | NOT NULL                             |                                                                              |


### `currencies`

Reference table of supported currencies. Seeded with ISO 4217 data.


| Column                | Type        | Constraints | Description                                           |
| --------------------- | ----------- | ----------- | ----------------------------------------------------- |
| `id`                  | char(3)     | PK          | ISO 4217 code (e.g., `CAD`, `USD`, `JPY`)             |
| `name`                | varchar(64) | NOT NULL    | Full name in singular (e.g., "Canadian Dollar")       |
| `symbol`              | varchar(8)  | NOT NULL    | e.g., `$`, `¥`, `£`                                   |
| `minor_unit_exponent` | smallint    | NOT NULL    | Number of decimal places: CAD=2 (cents), JPY=0, BHD=3 |


---

## Accounts

### `accounts`

Represents a real-world financial account. Owned by either a user (personal) or a group (shared/joint), never both.


| Column                        | Type         | Constraints                    | Description                                                                         |
| ----------------------------- | ------------ | ------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                          | uuid         | PK                             |                                                                                     |
| `owner_id`                    | uuid         | FK → `users.id`                | Set for personal accounts; null for group accounts                                  |
| `group_id`                    | uuid         | FK → `groups.id` ON DELETE CASCADE | Set for shared/joint accounts; null for personal accounts                           |
| `account_type`                | enum         | NOT NULL                       | `checking`, `savings`, `credit_card`, `cash`, `investment`                          |
| `tax_treatment`               | enum         | NOT NULL, default `taxable`    | `taxable`, `tax_free`, `tax_deferred`, `tax_assisted`                               |
| `name`                        | varchar(256) | NOT NULL                       | User-facing display name                                                            |
| `institution_id`              | uuid         | FK → `institutions.id`         | Null for cash or unlinked accounts                                                  |
| `currency`                    | char(3)      | NOT NULL, FK → `currencies.id` | Account's native currency                                                           |
| `lifetime_contribution_limit` | bigint       |                                | Lifetime cap in base currency units; null if N/A (e.g., FHSA=4000000, RESP=5000000) |
| `is_hidden`                   | boolean      | NOT NULL, default `false`      | Hidden accounts are excluded from default views                                     |
| `closed_at`                   | timestamptz  |                                | Null = active; non-null = closed on this date                                       |
| `created_at`                  | timestamptz  | NOT NULL                       |                                                                                     |


**Check constraint:** exactly one of `owner_id` or `group_id` must be non-null.

**Immutable after creation:** `account_type`, `currency`.

### `account_balance_snapshots`

End-of-day balance records used for historical balance charts and net worth tracking. Backend-maintained: one row per `(account, day)` where a transaction occurred. Snapshots are derived from transactions and recomputed automatically on any transaction mutation affecting that account. They are never written to directly by users.

**Convention:** `ts` is always stored as midnight UTC of the snapshot's day (e.g., `2026-03-15 00:00:00+00`). The midnight-UTC convention is enforced in the snapshot service layer, keeping the column type consistent with the rest of the schema while still expressing daily granularity.


| Column       | Type        | Constraints                              | Description                                     |
| ------------ | ----------- | ---------------------------------------- | ----------------------------------------------- |
| `account_id` | uuid        | PK, FK → `accounts.id` ON DELETE CASCADE |                                                 |
| `balance`    | bigint      | NOT NULL                                 | End-of-day balance in currency base units       |
| `ts`         | timestamptz | PK, NOT NULL                             | Midnight UTC of the day this snapshot represents |


### `tax_advantaged_configs`

Per-account, per-year contribution and withdrawal limits for tax-advantaged accounts. User is responsible for entering limits. Applies to all non-taxable accounts regardless of tax treatment (`tax_free`, `tax_deferred`, `tax_assisted`) — the specific treatment is determined by `accounts.tax_treatment`, not by this table.


| Column               | Type     | Constraints                      | Description                                      |
| -------------------- | -------- | -------------------------------- | ------------------------------------------------ |
| `account_id`         | uuid     | PK, NOT NULL, FK → `accounts.id` |                                                  |
| `year`               | smallint | PK, NOT NULL                     | Calendar year (e.g., 2026)                       |
| `contribution_limit` | bigint   | NOT NULL                         | Annual contribution limit in base currency units |
| `withdrawal_limit`   | bigint   |                                  | Annual withdrawal limit; null = no limit         |


---

## Transactions & Categorization

### `categories`

Hierarchical transaction categories. App seeds a default "Uncategorized" category per kind per user so `category_id` on transactions is never null. Any group member can create group categories, but only admins can edit or delete them. This lets members add categories they need (e.g., a kid adding "Games") without requiring admin intervention.


| Column         | Type                                   | Constraints               | Description                                                     |
| -------------- | -------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `id`           | uuid                                   | PK                        |                                                                 |
| `group_id`     | uuid                                   | FK → `groups.id` ON DELETE CASCADE | Non-null for group-shared categories                            |
| `owner_id`     | uuid                                   | NOT NULL, FK → `users.id`, UNIQUE(owner_id, name, kind) | Creator of the category                                         |
| `name`         | text                                   | NOT NULL, UNIQUE(owner_id, name, kind)                  | e.g., "Groceries", "Salary"                                     |
| `kind`         | enum (`expense`, `income`, `transfer`) | NOT NULL, UNIQUE(owner_id, name, kind)                  | Determines which transaction direction this category applies to |
| `parent_id`    | uuid                                   | FK → `categories.id`      | Null = top-level; non-null = subcategory                        |
| `created_at`   | timestamptz                            | NOT NULL                  |                                                                 |

**Unique constraint:** `(owner_id, name, kind)` — no duplicate personal categories per user. `(group_id, name, kind)` — no duplicate categories within a group (NULLs are distinct so personal categories are unaffected).

**Hierarchy behavior:** Categories support one level of nesting via `parent_id`. A category with `parent_id = null` is top-level; setting `parent_id` to another category's ID makes it a subcategory.

### `merchants`

Per-user registry of entities that send or receive money (stores, employers, people, etc.). Any group member can create a group merchant; only admins can edit or delete them.


| Column                | Type         | Constraints                            | Description                                                                                                                                         |
| --------------------- | ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid         | PK                                     |                                                                                                                                                     |
| `owner_id`            | uuid         | NOT NULL, FK → `users.id`              | Creator of the merchant                                                                                                                             |
| `group_id`            | uuid         | FK → `groups.id` ON DELETE CASCADE     | Non-null for group-shared merchants                                                                                                                 |
| `name`                | varchar(256) | NOT NULL                               | e.g., "Costco", "Employer Inc."                                                                                                                     |
| `default_category_id` | uuid         | FK → `categories.id`                   | Auto-categorization hint: new transactions with this merchant default to this category (used for manually created merchants not imported from Plaid) |
| `created_at`          | timestamptz  | NOT NULL                               |                                                                                                                                                     |

**Unique constraint:** `(owner_id, name)` where `group_id IS NULL` — no duplicate personal merchants per user. `(group_id, name)` — no duplicate merchants within a group.


### `transactions`

Core ledger table. Positive amount = money in (income/transfer received), negative = money out (expense/transfer sent). Transfers between own accounts are recorded as two independent rows.


| Column               | Type        | Constraints                    | Description                                                       |
| -------------------- | ----------- | ------------------------------ | ----------------------------------------------------------------- |
| `id`                 | uuid        | PK                             |                                                                   |
| `created_by_user_id` | uuid        | NOT NULL, FK → `users.id`      | Who recorded this transaction (audit trail for shared accounts)   |
| `account_id`         | uuid        | NOT NULL, FK → `accounts.id` ON DELETE CASCADE | Which account this transaction belongs to                         |
| `ts`                 | timestamptz | NOT NULL                       | When the transaction occurred                                     |
| `merchant_id`        | uuid        | FK → `merchants.id`            | Null for transfers between own accounts                           |
| `category_id`        | uuid        | NOT NULL, FK → `categories.id` | Never null due to seeded "Uncategorized" defaults                 |
| `amount`             | bigint      | NOT NULL                       | Account-currency minor units; positive = inflow, negative = outflow |
| `currency`           | char(3)     | NOT NULL, FK → `currencies.id` | Original receipt currency; defaults to the account's currency     |
| `fx_rate`            | numeric     | default `null`                 | Metadata only; frontend default is 1.0                            |
| `notes`              | text        |                                | User-provided context for analysis                                |
| `created_at`         | timestamptz | NOT NULL                       | When the transaction was entered into the system                  |
| `updated_at`         | timestamptz | NOT NULL                       | Tracks last modification; useful for sync and conflict resolution |

**Immutable after creation:** `created_by_user_id`, `currency`, `created_at`.

**Currency handling:** `amount` is always stored in the parent **account's** currency (in minor units, e.g. cents). The `currency` and `fx_rate` columns are metadata about the original receipt: `currency` is the receipt's currency, and `fx_rate` is the exchange rate **between that currency and the parent account's currency** at the time of the transaction — *not* the user's base currency, since the user may hold accounts in currencies other than their own base. The frontend pre-converts foreign-currency receipts before posting; the backend never re-applies `fx_rate` (snapshot balances, totals, and reports all sum `amount` directly).

### `tags`

Per-user tag registry for cross-cutting analysis that doesn't fit into the category hierarchy.


| Column       | Type        | Constraints               | Description                        |
| ------------ | ----------- | ------------------------- | ---------------------------------- |
| `id`         | uuid        | PK                        |                                    |
| `owner_id`   | uuid        | NOT NULL, FK → `users.id` |                                    |
| `name`       | varchar(64) | NOT NULL                  | e.g., "vacation", "tax-deductible" |
| `created_at` | timestamptz | NOT NULL                  |                                    |


**Unique constraint:** `(owner_id, name)` — no duplicate tag names per user.

### `transaction_tags`

Junction table linking transactions to tags. Uses a dedicated table instead of a tags column on transactions to enable indexed joins for tag queries, single-row renames, and consistent tag naming.


| Column           | Type | Constraints                | Description |
| ---------------- | ---- | -------------------------- | ----------- |
| `transaction_id` | uuid | PK, FK → `transactions.id` |             |
| `tag_id`         | uuid | PK, FK → `tags.id`         |             |


---

## Budgets

Budgets are split into two tables: a long-lived **`base_budget`** that holds the mutable "what" (name, currency, recurrence rule, tracked categories, permissions) and per-period **`budget`** instances that hold the frozen "what for this period" (period dates, overall limit). This split keeps historical utilization accurate when limits or category sets change — past instances stay pinned because the utilization query reconstructs the tracked-category set as of each instance's `period_end`.

A one-off (non-recurring) budget is a `base_budget` with `recurrence_freq = NULL` plus a single child `budget` instance. There are no standalone instances — every `budget` row has a parent `base_budget`.

### `base_budgets`

The long-lived spending plan. Holds name, currency, cadence, tracked categories, and permissions. Per-period caps and date ranges live on child `budget` instances. Cadence fields are immutable after creation — if the user wants a different shape, they create a new base.


| Column                | Type                                 | Constraints                        | Description                                                                                         |
| --------------------- | ------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                  | uuid                                 | PK                                 |                                                                                                     |
| `owner_id`            | uuid                                 | FK → `users.id`                    | Set for personal base budgets                                                                       |
| `group_id`            | uuid                                 | FK → `groups.id` ON DELETE CASCADE | Set for group base budgets                                                                          |
| `name`                | varchar(256)                         | NOT NULL                           | e.g., "Monthly Household"                                                                           |
| `currency`            | char(3)                              | NOT NULL, FK → `currencies.id`     | All child instances and utilization totals are expressed in this currency                            |
| `recurrence_freq`     | enum (`weekly`, `monthly`, `yearly`) | NOT NULL                           | Defines the alignment unit for instance periods                                                     |
| `instance_length`     | smallint                             | NOT NULL, CHECK > 0                | How many freq-units per instance (1 = one week/month/year, 3 = quarterly, etc.)                     |
| `recurrence_weekday`  | smallint                             | CHECK 0–6                          | 0=Mon..6=Sun; required iff `freq=weekly`, null otherwise                                            |
| `recurrence_dom`      | smallint                             | CHECK 1–31                         | Day of month the budget rotates on; required iff `freq` in (`monthly`, `yearly`), null otherwise. Falls back to last day of month when the month is shorter |
| `recurrence_month`    | smallint                             | CHECK 1–12                         | Month the budget rotates on; required iff `freq=yearly`, null otherwise                             |
| `recurs`              | boolean                              | NOT NULL                           | True = frontend auto-suggests next instance; false = one-off                                        |
| `created_at`          | timestamptz                          | NOT NULL                           |                                                                                                     |


**Check constraints:**
- Exactly one of `owner_id` or `group_id` must be non-null.
- `instance_length > 0`.
- `recurrence_weekday` in 0–6, `recurrence_dom` in 1–31, `recurrence_month` in 1–12 (all nullable, enforced at the application layer for pairing rules).

**Cadence pairing rules** (enforced at the Pydantic/route layer):
- `weekly` → `recurrence_weekday` required; `recurrence_dom` and `recurrence_month` must be null.
- `monthly` → `recurrence_dom` required; `recurrence_weekday` and `recurrence_month` must be null.
- `yearly` → `recurrence_dom` and `recurrence_month` required; `recurrence_weekday` must be null.


### `budgets`

Per-period instance of a `base_budget`. `period_start` is user-provided and must align with the base's cadence. `period_end` is computed by the backend from the base's cadence settings. Only `overall_limit` is editable after creation.


| Column            | Type        | Constraints                                        | Description                                                                      |
| ----------------- | ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`              | uuid        | PK                                                 |                                                                                  |
| `base_budget_id`  | uuid        | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE | Parent base; owner/group scope is derived by joining through this FK             |
| `period_start`    | date        | NOT NULL                                           | Must align with the base's cadence (1st of month, matching weekday, etc.)        |
| `period_end`      | date        | NOT NULL, CHECK `period_end >= period_start`       | Computed from the base's cadence; not user-provided                              |
| `overall_limit`   | bigint      | NOT NULL, CHECK > 0                                | Spending cap across all categories, in the parent base's currency minor units    |
| `created_at`      | timestamptz | NOT NULL                                           |                                                                                  |


**Unique constraint:** `(base_budget_id, period_start, period_end)` — blocks duplicate instances for the same period under one base.


### `budget_tracked_categories`

Tracks which categories a base budget monitors and when. The `added_at` / `removed_at` pair lets the utilization query reconstruct the tracked set as of any instance's `period_end`, so editing the base does not rewrite historical period totals.


| Column            | Type        | Constraints                                        | Description                              |
| ----------------- | ----------- | -------------------------------------------------- | ---------------------------------------- |
| `id`              | uuid        | PK                                                 |                                          |
| `base_budget_id`  | uuid        | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE |                                          |
| `category_id`     | uuid        | NOT NULL, FK → `categories.id`                     |                                          |
| `added_at`        | timestamptz | NOT NULL                                           | When this category started being tracked |
| `removed_at`      | timestamptz |                                                    | Null = still active; set when unlinked   |


**Partial unique index:** `(base_budget_id, category_id) WHERE removed_at IS NULL` — at most one active row per `(base_budget, category)`. Multiple historical rows are allowed so the re-add-after-remove pattern keeps a clean audit trail without collapsing the history.


### Utilization query (the `period_end` cutoff)

The `GET /budgets/{id}/utilization` endpoint reconstructs the tracked-category set as of the instance's `period_end` using this predicate:

```sql
WITH tracked AS (
  SELECT DISTINCT category_id
  FROM budget_tracked_categories btc
  WHERE btc.base_budget_id = :base_budget_id
    AND btc.added_at <= :period_end
    AND (btc.removed_at IS NULL OR btc.removed_at > :period_end)
)
SELECT t.category_id, SUM(-t.amount) AS spent
FROM transactions t
JOIN accounts a ON t.account_id = a.id
WHERE t.category_id IN (SELECT category_id FROM tracked)
  AND t.ts::date BETWEEN :period_start AND :period_end
  AND a.currency = :base_budget_currency
  AND (
    (:group_id IS NULL AND a.owner_id = :owner_id)
    OR (:group_id IS NOT NULL AND a.group_id = :group_id)
  )
GROUP BY t.category_id;
```

`period_end` is the single reference point for category membership. This handles both past and current periods cleanly:

- **Past period:** `period_end` is fixed, so the tracked set is a snapshot of what was active at the moment the period ended. Editing the base afterwards (adding, removing, or re-adding categories) does not touch historical totals.
- **Current period:** `period_end` is in the future, so `added_at <= period_end` is trivially true for any already-active row and `removed_at > period_end` reduces to `removed_at IS NULL`. The tracked set is just "currently active".
- **Mid-period addition (`added_at` inside the period):** counts retroactively for the whole period — the predicate is `added_at <= period_end`, not `added_at <= ts_day`.
- **Mid-period removal (`removed_at` inside the period):** excludes the category for the whole period, including transactions that predate the removal — the row fails `removed_at > period_end` so no in-period spend counts.
- **Re-add after remove:** produces two historical rows (one removed, one active). For any given `period_end`, at most one of the two satisfies the predicate, so totals are single-counted.

The `DISTINCT` in the tracked CTE is a defensive guard — under the partial unique index and natural timing, at most one historical row for a given category satisfies the predicate anyway.

The currency and scope filters ensure cross-currency and cross-scope spending never leak into a base's totals (see the account/transaction currency discussion in the Transactions section).


**Data lifecycle:** Base budgets use hard delete. Deleting a base cascades to all child `budgets`, `budget_tracked_categories`, and `budget_permissions` rows. Expired base budgets and their instances are naturally preserved as historical records (they remain queryable by period), so a delete means the user intentionally wants the budget removed.


