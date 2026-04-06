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

## Households

### `households`

A shared financial group (e.g., a couple, family). A user can own one or more households.

**Data lifecycle:** Deleting a household cascades to all associated accounts, categories, budgets, and their transactions. Members who leave (or are removed from) a household lose access to all shared data — there is no transfer of ownership. Users should archive a household instead of deleting it to preserve historical data.

| Column        | Type        | Constraints               | Description                                 |
| ------------- | ----------- | ------------------------- | ------------------------------------------- |
| `id`          | uuid        | PK                        |                                             |
| `owner_id`    | uuid        | NOT NULL, FK → `users.id` | The user who created and owns the household |
| `name`        | text        |                           | Display name                                |
| `profile_pic` | text        |                           | Path/URL to household picture               |
| `is_archived` | boolean     | NOT NULL, default `false` | Hidden from default list but data preserved |
| `created_at`  | timestamptz | NOT NULL                  |                                             |


### `household_members`

Junction table linking users to households.


| Column         | Type    | Constraints                                | Description                                                   |
| -------------- | ------- | ------------------------------------------ | ------------------------------------------------------------- |
| `household_id` | uuid    | PK, FK → `households.id` ON DELETE CASCADE |                                                               |
| `user_id`      | uuid    | PK, FK → `users.id`                       |                                                               |
| `is_admin`     | boolean | NOT NULL, default `false`                  | Admins can manage membership and have implicit full access to all household resources. Only the owner can promote/demote admins. |


### `account_permissions`

Per-account access control for household members. Admins have implicit full access and don't need explicit permission rows. Categories are visible to all household members and any member can create new ones, but only admins can edit or delete them. Transactions inherit permissions from their parent account.


| Column         | Type             | Constraints                                                          | Description                              |
| -------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`           | uuid             | PK                                                                   |                                          |
| `household_id` | uuid             | NOT NULL, FK → `households.id` ON DELETE CASCADE                     |                                          |
| `user_id`      | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `account_id`   | uuid             | NOT NULL, FK → `accounts.id` ON DELETE CASCADE                       |                                          |
| `level`        | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view account + transactions; `write` = also create/edit/delete transactions; `admin` = also edit/delete account |
| `created_at`   | timestamptz      | NOT NULL                                                             |                                          |

**Unique constraint:** `(household_id, user_id, account_id)` — one permission level per member per account.

**Composite FK:** `(household_id, user_id)` → `household_members(household_id, user_id) ON DELETE CASCADE` — removing a member cleans up all their permissions.


### `budget_permissions`

Per-budget access control for household members. Same structure as account_permissions. Budget permissions are independent of account permissions — a user with budget READ can see aggregated spending per category without needing account access. This enables privacy-respecting monitoring (e.g., parents see "Food: $150 / $300" without seeing individual transactions).


| Column         | Type             | Constraints                                                          | Description                              |
| -------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`           | uuid             | PK                                                                   |                                          |
| `household_id` | uuid             | NOT NULL, FK → `households.id` ON DELETE CASCADE                     |                                          |
| `user_id`      | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `budget_id`    | uuid             | NOT NULL, FK → `budgets.id` ON DELETE CASCADE                        |                                          |
| `level`        | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view budget config + aggregated utilization; `write` = also edit budget details; `admin` = also delete budget |
| `created_at`   | timestamptz      | NOT NULL                                                             |                                          |

**Unique constraint:** `(household_id, user_id, budget_id)` — one permission level per member per budget.

**Composite FK:** `(household_id, user_id)` → `household_members(household_id, user_id) ON DELETE CASCADE`.


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

Represents a real-world financial account. Owned by either a user (personal) or a household (shared/joint), never both.


| Column                        | Type         | Constraints                    | Description                                                                         |
| ----------------------------- | ------------ | ------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                          | uuid         | PK                             |                                                                                     |
| `owner_id`                    | uuid         | FK → `users.id`                | Set for personal accounts; null for household accounts                              |
| `household_id`                | uuid         | FK → `households.id` ON DELETE CASCADE | Set for shared/joint accounts; null for personal accounts                           |
| `account_type`                | enum         | NOT NULL                       | `checking`, `savings`, `credit_card`, `cash`, `investment`                          |
| `tax_treatment`               | enum         | NOT NULL, default `taxable`    | `taxable`, `tax_free`, `tax_deferred`, `tax_assisted`                               |
| `name`                        | varchar(256) | NOT NULL                       | User-facing display name                                                            |
| `institution_id`              | uuid         | FK → `institutions.id`         | Null for cash or unlinked accounts                                                  |
| `currency`                    | char(3)      | NOT NULL, FK → `currencies.id` | Account's native currency                                                           |
| `lifetime_contribution_limit` | bigint       |                                | Lifetime cap in base currency units; null if N/A (e.g., FHSA=4000000, RESP=5000000) |
| `is_hidden`                   | boolean      | NOT NULL, default `false`      | Hidden accounts are excluded from default views                                     |
| `closed_at`                   | timestamptz  |                                | Null = active; non-null = closed on this date                                       |
| `created_at`                  | timestamptz  | NOT NULL                       |                                                                                     |


**Check constraint:** exactly one of `owner_id` or `household_id` must be non-null.

**Immutable after creation:** `account_type`, `currency`.

### `account_balance_snapshots`

Point-in-time balance records for an account. Used for historical balance charts and net worth tracking.


| Column       | Type        | Constraints            | Description                          |
| ------------ | ----------- | ---------------------- | ------------------------------------ |
| `account_id` | uuid        | PK, FK → `accounts.id` |                                      |
| `balance`    | bigint      | NOT NULL               | Balance in the currency's base units |
| `ts`         | timestamptz | PK, NOT NULL           | Snapshot timestamp                   |


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

Hierarchical transaction categories. App seeds a default "Uncategorized" category per kind per user so `category_id` on transactions is never null. Any household member can create household categories, but only admins can edit or delete them. This lets members add categories they need (e.g., a kid adding "Games") without requiring admin intervention.


| Column         | Type                                   | Constraints               | Description                                                     |
| -------------- | -------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `id`           | uuid                                   | PK                        |                                                                 |
| `household_id` | uuid                                   | FK → `households.id` ON DELETE CASCADE | Non-null for household-shared categories                        |
| `owner_id`     | uuid                                   | NOT NULL, FK → `users.id`, UNIQUE(owner_id, name, kind) | Creator of the category                                         |
| `name`         | text                                   | NOT NULL, UNIQUE(owner_id, name, kind)                  | e.g., "Groceries", "Salary"                                     |
| `kind`         | enum (`expense`, `income`, `transfer`) | NOT NULL, UNIQUE(owner_id, name, kind)                  | Determines which transaction direction this category applies to |
| `parent_id`    | uuid                                   | FK → `categories.id`      | Null = top-level; non-null = subcategory                        |
| `created_at`   | timestamptz                            | NOT NULL                  |                                                                 |

**Unique constraint:** `(owner_id, name, kind)` — no duplicate personal categories per user. `(household_id, name, kind)` — no duplicate categories within a household (NULLs are distinct so personal categories are unaffected).

**Hierarchy behavior:** Categories support one level of nesting via `parent_id`. A category with `parent_id = null` is top-level; setting `parent_id` to another category's ID makes it a subcategory.

### `merchants`

Per-user registry of entities that send or receive money (stores, employers, people, etc.). Any household member can create a household merchant; only admins can edit or delete them.


| Column                | Type         | Constraints                            | Description                                                                                                                                         |
| --------------------- | ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid         | PK                                     |                                                                                                                                                     |
| `owner_id`            | uuid         | NOT NULL, FK → `users.id`              | Creator of the merchant                                                                                                                             |
| `household_id`        | uuid         | FK → `households.id` ON DELETE CASCADE | Non-null for household-shared merchants                                                                                                             |
| `name`                | varchar(256) | NOT NULL                               | e.g., "Costco", "Employer Inc."                                                                                                                     |
| `default_category_id` | uuid         | FK → `categories.id`                   | Auto-categorization hint: new transactions with this merchant default to this category (used for manually created merchants not imported from Plaid) |
| `created_at`          | timestamptz  | NOT NULL                               |                                                                                                                                                     |

**Unique constraint:** `(owner_id, name)` where `household_id IS NULL` — no duplicate personal merchants per user. `(household_id, name)` — no duplicate merchants within a household.


### `transactions`

Core ledger table. Positive amount = money in (income/transfer received), negative = money out (expense/transfer sent). Transfers between own accounts are recorded as two independent rows.


| Column               | Type        | Constraints                    | Description                                                       |
| -------------------- | ----------- | ------------------------------ | ----------------------------------------------------------------- |
| `id`                 | uuid        | PK                             |                                                                   |
| `created_by_user_id` | uuid        | NOT NULL, FK → `users.id`      | Who recorded this transaction (audit trail for shared accounts)   |
| `account_id`         | uuid        | NOT NULL, FK → `accounts.id`   | Which account this transaction belongs to                         |
| `ts`                 | timestamptz | NOT NULL                       | When the transaction occurred                                     |
| `merchant_id`        | uuid        | FK → `merchants.id`            | Null for transfers between own accounts                           |
| `category_id`        | uuid        | NOT NULL, FK → `categories.id` | Never null due to seeded "Uncategorized" defaults                 |
| `amount`             | bigint      | NOT NULL                       | In currency base units; positive = inflow, negative = outflow     |
| `currency`           | char(3)     | NOT NULL, FK → `currencies.id` | Defaults to the account's currency                                |
| `fx_rate`            | numeric     | default `null`                 | Exchange rate to account currency; frontend shows 1.0 as default  |
| `notes`              | text        |                                | User-provided context for analysis                                |
| `created_at`         | timestamptz | NOT NULL                       | When the transaction was entered into the system                  |
| `updated_at`         | timestamptz | NOT NULL                       | Tracks last modification; useful for sync and conflict resolution |

**Immutable after creation:** `created_by_user_id`, `currency`, `created_at`.

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

### `budgets`

Spending plan for a time period. Can be one-off or recurring. Recurring budgets use lazy recurrence: the frontend computes which period the user is currently in by adding `recurrence_interval` × `recurrence_freq` to `period_start` and `period_end`. No instance rows are generated — each budget row is self-contained. `base_budget_id` is reserved for future use when users want to override limits for a specific period (the override row would point back to the original).

**Recurrence:** the frontend computes subsequent periods by adding `recurrence_interval` × `recurrence_freq` to both `period_start` and `period_end`. Recurring budgets must use calendar-aligned dates to avoid drift: weekly = any 7-day span (user picks start day), monthly = 1st to last day of month, yearly = Jan 1 to Dec 31. Custom date ranges are only allowed for one-off budgets. This alignment is enforced by the frontend.


| Column                | Type                                          | Constraints                    | Description                                                                         |
| --------------------- | --------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                  | uuid                                          | PK                             |                                                                                     |
| `owner_id`            | uuid                                          | FK → `users.id`                | Set for personal budgets                                                            |
| `household_id`        | uuid                                          | FK → `households.id` ON DELETE CASCADE | Set for household budgets                                                           |
| `base_budget_id`    | uuid                                          | FK → `budgets.id`              | Reserved for per-period overrides; null for most budgets                             |
| `name`                | varchar(256)                                  | NOT NULL                       | e.g., "March 2026 Budget"                                                           |
| `period_start`        | date                                          | NOT NULL                       |                                                                                     |
| `period_end`          | date                                          | NOT NULL                       |                                                                                     |
| `recurrence_freq`     | enum (`weekly`, `monthly`, `yearly`)          |                                | Null = one-off; set when the budget recurs                                          |
| `recurrence_interval` | smallint                                      |                                | e.g., 1 = every period, 2 = every other; null when `recurrence_freq` is null        |
| `overall_limit`       | bigint                                        | default `null`                 | Optional overall spending cap across all categories, in the budget's currency units |
| `currency`            | char(3)                                       | NOT NULL, FK → `currencies.id` |                                                                                     |
| `created_at`          | timestamptz                                   | NOT NULL                       |                                                                                     |


**Check constraint:** exactly one of `owner_id` or `household_id` must be non-null.

### `budget_tracked_categories`

Tracks which categories a budget monitors and when. Enables historical budget utilization by preserving a record of when categories were added and removed. A budget tracking "Eating" across Groceries + Takeout would have two active rows (where `removed_at` is null).


| Column        | Type        | Constraints                     | Description                                |
| ------------- | ----------- | ------------------------------- | ------------------------------------------ |
| `id`          | uuid        | PK                              |                                            |
| `budget_id`   | uuid        | NOT NULL, FK → `budgets.id` ON DELETE CASCADE |                                            |
| `category_id` | uuid        | NOT NULL, FK → `categories.id`  |                                            |
| `added_at`    | timestamptz | NOT NULL                        | When this category started being tracked   |
| `removed_at`  | timestamptz |                                 | Null = still active; set when unlinked     |


**Data lifecycle:** Budgets use hard delete. Expired budgets are naturally preserved as historical records (they remain queryable by period), so a delete means the user intentionally wants the budget removed. Cascading delete removes associated `budget_tracked_categories` and `budget_permissions` rows.


