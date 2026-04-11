# Database Schema Reference

Last updated: 2026-04-11

All monetary values are stored as `bigint` in the currency's minor units (e.g., cents for CAD/USD, 1 for JPY) to avoid floating-point rounding.

---

## Users & Authentication

### `users`

Core user profile.

| Column          | Type         | Constraints                    | Description                                              |
| --------------- | ------------ | ------------------------------ | -------------------------------------------------------- |
| `id`            | uuid         | PK                             |                                                          |
| `email`         | varchar(254) | NOT NULL, UNIQUE               | Login email (254 char limit per RFC 3696)                |
| `first_name`    | varchar(256) | NOT NULL                       |                                                          |
| `last_name`     | varchar(256) |                                |                                                          |
| `profile_pic`   | text         |                                | Path/URL to profile picture                              |
| `tz`            | varchar(40)  | NOT NULL                       | IANA timezone, auto-derived from device                  |
| `base_currency` | char(3)      | NOT NULL, FK → `currencies.id` | Base currency for aggregate views and FX conversion      |
| `created_at`    | timestamptz  | NOT NULL                       |                                                          |

### `auth_identities`

Links a user to an auth provider. Currently password-only; designed for future OAuth.

| Column              | Type              | Constraints               | Description          |
| ------------------- | ----------------- | ------------------------- | -------------------- |
| `id`                | uuid              | PK                        |                      |
| `user_id`           | uuid              | FK → `users.id`           |                      |
| `auth_provider`     | enum (`password`) | NOT NULL                  |                      |
| `email_verified`    | boolean           | NOT NULL, default `false` |                      |
| `email_verified_at` | timestamptz       |                           | Null until verified  |

**Unique:** `(user_id, auth_provider)` — one identity per provider per user.

### `password_credentials`

Password hashes. One-to-one with `users`.

| Column                 | Type        | Constraints           | Description                                              |
| ---------------------- | ----------- | --------------------- | -------------------------------------------------------- |
| `user_id`              | uuid        | PK, FK → `users.id`   |                                                          |
| `password_hash`        | text        | NOT NULL              |                                                          |
| `password_algo`        | varchar(32) | NOT NULL              | e.g., `argon2id`                                         |
| `updated_at`           | timestamptz | NOT NULL              | Last password change                                     |
| `failed_attempt_count` | int         | NOT NULL, default `0` | Reset on successful login                                |
| `locked_until`         | timestamptz | default `null`        | Non-null = temporarily locked after too many failed attempts |


---

## Groups

### `groups`

A shared financial group (couple, family, roommates). A user can own multiple groups.

**Data lifecycle:** Deleting a group cascades to all associated accounts, categories, budgets, and transactions. Removed members lose all access — no ownership transfer. Archive instead of deleting to preserve history.

| Column        | Type        | Constraints               | Description                                 |
| ------------- | ----------- | ------------------------- | ------------------------------------------- |
| `id`          | uuid        | PK                        |                                             |
| `owner_id`    | uuid        | NOT NULL, FK → `users.id` | Creator/owner                               |
| `name`        | text        |                           |                                             |
| `profile_pic` | text        |                           |                                             |
| `is_archived` | boolean     | NOT NULL, default `false` | Hidden from default list but data preserved |
| `created_at`  | timestamptz | NOT NULL                  |                                             |

### `group_members`

Links users to groups.

| Column         | Type    | Constraints                                | Description                                                   |
| -------------- | ------- | ------------------------------------------ | ------------------------------------------------------------- |
| `group_id`     | uuid    | PK, FK → `groups.id` ON DELETE CASCADE     |                                                               |
| `user_id`      | uuid    | PK, FK → `users.id`                       |                                                               |
| `is_admin`     | boolean | NOT NULL, default `false`                  | Implicit full access to all group resources. Only the owner can promote/demote. |

### `account_permissions`

Per-account access control for non-admin group members. Admins bypass this table. Transactions inherit permissions from their parent account. Categories are visible to all members; any member can create, only admins can edit/delete.

| Column         | Type             | Constraints                                                          | Description                              |
| -------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`           | uuid             | PK                                                                   |                                          |
| `group_id`     | uuid             | NOT NULL, FK → `groups.id` ON DELETE CASCADE                         |                                          |
| `user_id`      | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `account_id`   | uuid             | NOT NULL, FK → `accounts.id` ON DELETE CASCADE                       |                                          |
| `level`        | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view; `write` = + create/edit/delete transactions; `admin` = + edit/delete account |
| `created_at`   | timestamptz      | NOT NULL                                                             |                                          |

**Unique:** `(group_id, user_id, account_id)` — one level per member per account.

**Composite FK:** `(group_id, user_id)` → `group_members` ON DELETE CASCADE — removing a member cleans up permissions.

### `budget_permissions`

Per-base-budget access control for non-admin group members. Applies to all child instances. Independent of account permissions — a user with READ can see aggregated category spending without account access (e.g., parents see "Food: $150 / $300" without individual transactions).

| Column            | Type             | Constraints                                                          | Description                              |
| ----------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `id`              | uuid             | PK                                                                   |                                          |
| `group_id`        | uuid             | NOT NULL, FK → `groups.id` ON DELETE CASCADE                         |                                          |
| `user_id`         | uuid             | NOT NULL, FK → `users.id`                                           |                                          |
| `base_budget_id`  | uuid             | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE                   |                                          |
| `level`           | enum (`read`, `write`, `admin`) | NOT NULL                                              | `read` = view + aggregated utilization; `write` = + edit base; `admin` = + delete base + manage instances |
| `created_at`      | timestamptz      | NOT NULL                                                             |                                          |

**Unique:** `(group_id, user_id, base_budget_id)` — one level per member per base budget.

**Composite FK:** `(group_id, user_id)` → `group_members` ON DELETE CASCADE.


---

## Reference Data

### `institutions`

Global registry of financial institutions.

| Column         | Type                          | Constraints                          | Description                                  |
| -------------- | ----------------------------- | ------------------------------------ | -------------------------------------------- |
| `id`           | uuid                          | PK                                   |                                              |
| `status`       | enum (`canonical`, `pending`) | NOT NULL, default `pending`          | `canonical` = verified; `pending` = awaiting review |
| `name`         | varchar(256)                  | NOT NULL, UNIQUE(name, country_code) |                                              |
| `country_code` | char(2)                       | NOT NULL, UNIQUE(name, country_code) | ISO 3166-1 alpha-2                           |
| `website`      | text                          | NOT NULL                             |                                              |
| `logo_url`     | text                          |                                      |                                              |

### `currencies`

Supported currencies, seeded from ISO 4217.

| Column                | Type        | Constraints | Description                                            |
| --------------------- | ----------- | ----------- | ------------------------------------------------------ |
| `id`                  | char(3)     | PK          | ISO 4217 code (e.g., `CAD`, `USD`, `JPY`)              |
| `name`                | varchar(64) | NOT NULL    | Full name (e.g., "Canadian Dollar")                    |
| `symbol`              | varchar(8)  | NOT NULL    | e.g., `$`, `¥`, `£`                                    |
| `minor_unit_exponent` | smallint    | NOT NULL    | Decimal places: CAD=2, JPY=0, BHD=3                    |


---

## Accounts

### `accounts`

A real-world financial account. Owned by either a user (personal) or a group (shared), never both.

| Column                        | Type         | Constraints                        | Description                                                      |
| ----------------------------- | ------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `id`                          | uuid         | PK                                 |                                                                  |
| `owner_id`                    | uuid         | FK → `users.id`                    | Personal accounts; null for group                                |
| `group_id`                    | uuid         | FK → `groups.id` ON DELETE CASCADE | Group accounts; null for personal                                |
| `account_kind`                | enum         | NOT NULL                           | `asset`, `liability` — validated against `account_type`          |
| `account_type`                | enum         | NOT NULL                           | Assets: `checking`, `savings`, `term_deposit`, `cash`, `investment`; Liabilities: `credit_card`, `line_of_credit`, `heloc`, `loan`, `mortgage` |
| `tax_treatment`               | enum         | NOT NULL, default `taxable`        | `taxable`, `tax_free`, `tax_deferred`, `tax_assisted`            |
| `name`                        | varchar(256) | NOT NULL                           |                                                                  |
| `institution_id`              | uuid         | FK → `institutions.id`             | Null for cash or unlinked accounts                               |
| `currency`                    | char(3)      | NOT NULL, FK → `currencies.id`     | Account's native currency                                        |
| `lifetime_contribution_limit` | bigint       |                                    | Lifetime cap in minor units; null if N/A                         |
| `credit_limit`                | bigint       |                                    | Liability accounts only; null on assets                          |
| `is_hidden`                   | boolean      | NOT NULL, default `false`          | Excluded from default views                                      |
| `closed_at`                   | timestamptz  |                                    | Null = active; non-null = closed date                            |
| `created_at`                  | timestamptz  | NOT NULL                           |                                                                  |

**Check:** exactly one of `owner_id` or `group_id` must be non-null.

**Immutable after creation:** `account_kind`, `account_type`, `currency`.

### `account_balance_snapshots`

End-of-day balance records for historical charts and net worth tracking. Backend-maintained — one row per (account, day) where a transaction occurred, recomputed automatically on any transaction mutation. Never user-written.

`ts` is always midnight UTC (e.g., `2026-03-15 00:00:00+00`), enforced in the service layer.

| Column       | Type        | Constraints                              | Description                          |
| ------------ | ----------- | ---------------------------------------- | ------------------------------------ |
| `account_id` | uuid        | PK, FK → `accounts.id` ON DELETE CASCADE |                                      |
| `balance`    | bigint      | NOT NULL                                 | End-of-day balance in minor units    |
| `ts`         | timestamptz | PK, NOT NULL                             | Midnight UTC of the snapshot day     |

### `tax_advantaged_configs`

Per-account, per-year contribution/withdrawal limits. User-entered. Applies to all non-taxable accounts — specific treatment is determined by `accounts.tax_treatment`.

| Column               | Type     | Constraints                       | Description                              |
| -------------------- | -------- | --------------------------------- | ---------------------------------------- |
| `account_id`         | uuid     | PK, NOT NULL, FK → `accounts.id`  |                                          |
| `year`               | smallint | PK, NOT NULL                      | Calendar year                            |
| `contribution_limit` | bigint   | NOT NULL                          | Annual limit in minor units              |
| `withdrawal_limit`   | bigint   |                                   | Null = no limit                          |


---

## Transactions & Categorization

### `categories`

Hierarchical transaction categories. App seeds a default "Uncategorized" per kind per user so `category_id` is never null. Any group member can create group categories; only admins can edit/delete.

| Column         | Type                                   | Constraints               | Description                                        |
| -------------- | -------------------------------------- | ------------------------- | -------------------------------------------------- |
| `id`           | uuid                                   | PK                        |                                                    |
| `group_id`     | uuid                                   | FK → `groups.id` ON DELETE CASCADE | Non-null for group categories              |
| `owner_id`     | uuid                                   | NOT NULL, FK → `users.id`, UNIQUE(owner_id, name, kind) | Creator                        |
| `name`         | text                                   | NOT NULL, UNIQUE(owner_id, name, kind)                  |                                |
| `kind`         | enum (`expense`, `income`, `transfer`) | NOT NULL, UNIQUE(owner_id, name, kind)                  | Transaction direction          |
| `parent_id`    | uuid                                   | FK → `categories.id`      | Null = top-level; non-null = subcategory           |
| `created_at`   | timestamptz                            | NOT NULL                  |                                                    |

**Unique:** `(owner_id, name, kind)` for personal; `(group_id, name, kind)` for groups (NULLs are distinct).

**Hierarchy:** one level of nesting via `parent_id`.

### `merchants`

Entities that send or receive money. Any group member can create group merchants; only admins can edit/delete.

| Column                | Type         | Constraints                            | Description                                         |
| --------------------- | ------------ | -------------------------------------- | --------------------------------------------------- |
| `id`                  | uuid         | PK                                     |                                                     |
| `owner_id`            | uuid         | NOT NULL, FK → `users.id`              | Creator                                             |
| `group_id`            | uuid         | FK → `groups.id` ON DELETE CASCADE     | Non-null for group merchants                        |
| `name`                | varchar(256) | NOT NULL                               |                                                     |
| `default_category_id` | uuid         | FK → `categories.id`                   | Auto-categorization hint for new transactions       |
| `created_at`          | timestamptz  | NOT NULL                               |                                                     |

**Unique:** `(owner_id, name) WHERE group_id IS NULL` for personal; `(group_id, name)` for groups.

### `transactions`

Core ledger. Positive = inflow (income/transfer in), negative = outflow (expense/transfer out). Own-account transfers are two independent rows.

| Column               | Type        | Constraints                                    | Description                                                       |
| -------------------- | ----------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `id`                 | uuid        | PK                                             |                                                                   |
| `created_by_user_id` | uuid        | NOT NULL, FK → `users.id`                      | Audit trail for shared accounts                                   |
| `account_id`         | uuid        | NOT NULL, FK → `accounts.id` ON DELETE CASCADE |                                                                   |
| `ts`                 | timestamptz | NOT NULL                                       | When the transaction occurred                                     |
| `merchant_id`        | uuid        | FK → `merchants.id`                            | Null for own-account transfers                                    |
| `category_id`        | uuid        | NOT NULL, FK → `categories.id`                 | Never null (seeded "Uncategorized" defaults)                      |
| `amount`             | bigint      | NOT NULL                                       | Account-currency minor units; positive = in, negative = out       |
| `currency`           | char(3)     | NOT NULL, FK → `currencies.id`                 | Original receipt currency; defaults to account currency           |
| `fx_rate`            | numeric     | default `null`                                 | Metadata only; frontend default 1.0                               |
| `notes`              | text        |                                                |                                                                   |
| `created_at`         | timestamptz | NOT NULL                                       | When entered into the system                                      |
| `updated_at`         | timestamptz | NOT NULL                                       | Last modification; used for sync/conflict resolution              |

**Immutable after creation:** `created_by_user_id`, `currency`, `created_at`.

**Currency handling:** `amount` is always in the parent **account's** currency (minor units). `currency` and `fx_rate` are receipt metadata: `currency` is the receipt's currency, `fx_rate` is the rate **between that currency and the account's currency** — not the user's base currency. The frontend pre-converts before posting; the backend never re-applies `fx_rate` (snapshots, totals, and reports sum `amount` directly).

### `tags`

Tags for cross-cutting analysis outside the category hierarchy. Support both personal and group scopes.

| Column       | Type        | Constraints                        | Description                        |
| ------------ | ----------- | ---------------------------------- | ---------------------------------- |
| `id`         | uuid        | PK                                 |                                    |
| `owner_id`   | uuid        | NOT NULL, FK → `users.id`          | Creator                            |
| `group_id`   | uuid        | FK → `groups.id` ON DELETE CASCADE | Non-null for group tags            |
| `name`       | varchar(64) | NOT NULL                           | e.g., "vacation", "tax-deductible" |
| `created_at` | timestamptz | NOT NULL                           |                                    |

**Unique:** `(owner_id, name) WHERE group_id IS NULL` for personal; `(group_id, name)` for groups.

### `transaction_tags`

Junction table. Dedicated table (vs. column on transactions) enables indexed joins, single-row renames, and consistent naming.

| Column           | Type | Constraints                 | Description |
| ---------------- | ---- | --------------------------- | ----------- |
| `transaction_id` | uuid | PK, FK → `transactions.id`  |             |
| `tag_id`         | uuid | PK, FK → `tags.id`          |             |


---

## Budgets

Two-table design: a long-lived **`base_budget`** (name, currency, cadence, tracked categories, permissions) and per-period **`budget`** instances (frozen period dates + limit). Past instances stay pinned when limits or category sets change — the utilization query reconstructs the tracked set as of each instance's `period_end`.

One-off budgets are a `base_budget` with `recurs = false` plus a single child instance. Every `budget` row has a parent `base_budget`.

### `base_budgets`

Long-lived spending plan. Per-period caps live on child instances. Cadence fields are immutable after creation.

| Column                | Type                                 | Constraints                        | Description                                                             |
| --------------------- | ------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------- |
| `id`                  | uuid                                 | PK                                 |                                                                         |
| `owner_id`            | uuid                                 | FK → `users.id`                    | Personal budgets; null for group                                        |
| `group_id`            | uuid                                 | FK → `groups.id` ON DELETE CASCADE | Group budgets; null for personal                                        |
| `name`                | varchar(256)                         | NOT NULL                           |                                                                         |
| `currency`            | char(3)                              | NOT NULL, FK → `currencies.id`     | All instances and utilization in this currency                          |
| `recurrence_freq`     | enum (`weekly`, `monthly`, `yearly`) | NOT NULL                           | Alignment unit for instance periods                                     |
| `instance_length`     | smallint                             | NOT NULL, CHECK > 0, default `1`   | Freq-units per instance (1 = week/month/year, 3 = quarterly, etc.)      |
| `recurrence_weekday`  | smallint                             | CHECK 0–6                          | 0=Mon..6=Sun; required iff `weekly`                                     |
| `recurrence_dom`      | smallint                             | CHECK 1–31                         | Day of month; required iff `monthly`/`yearly`. Falls back to last day   |
| `recurrence_month`    | smallint                             | CHECK 1–12                         | Required iff `yearly`                                                   |
| `recurs`              | boolean                              | NOT NULL, default `false`          | True = auto-suggest next instance; false = one-off                      |
| `created_at`          | timestamptz                          | NOT NULL                           |                                                                         |

**Check:** exactly one of `owner_id`/`group_id` non-null; `instance_length > 0`.

**Cadence pairing** (enforced at Pydantic/route layer): `weekly` → weekday required, dom/month null; `monthly` → dom required, weekday/month null; `yearly` → dom+month required, weekday null.

### `budgets`

Per-period instance. `period_start` is user-provided and must align with cadence; `period_end` is backend-computed. Only `overall_limit` is editable after creation.

| Column            | Type        | Constraints                                        | Description                                                      |
| ----------------- | ----------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `id`              | uuid        | PK                                                 |                                                                  |
| `base_budget_id`  | uuid        | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE | Scope derived via this FK                                        |
| `period_start`    | date        | NOT NULL                                           | Must align with base cadence                                     |
| `period_end`      | date        | NOT NULL, CHECK `>= period_start`                  | Backend-computed                                                 |
| `overall_limit`   | bigint      | NOT NULL, CHECK > 0                                | Spending cap in parent base's currency minor units               |
| `created_at`      | timestamptz | NOT NULL                                           |                                                                  |

**Unique:** `(base_budget_id, period_start, period_end)`.

### `budget_tracked_categories`

Which categories a base monitors and when. `added_at`/`removed_at` lets the utilization query reconstruct the tracked set as of any instance's `period_end`, preserving historical accuracy.

| Column            | Type        | Constraints                                        | Description                              |
| ----------------- | ----------- | -------------------------------------------------- | ---------------------------------------- |
| `id`              | uuid        | PK                                                 |                                          |
| `base_budget_id`  | uuid        | NOT NULL, FK → `base_budgets.id` ON DELETE CASCADE |                                          |
| `category_id`     | uuid        | NOT NULL, FK → `categories.id`                     |                                          |
| `added_at`        | timestamptz | NOT NULL                                           | When tracking started                    |
| `removed_at`      | timestamptz |                                                    | Null = active; set when unlinked         |

**Partial unique index:** `(base_budget_id, category_id) WHERE removed_at IS NULL` — one active row per pair. Re-add-after-remove keeps a clean audit trail.
