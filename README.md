# Lumina Finance

<!-- markdownlint-disable MD033 -->
<div style="display: flex; flex-wrap: wrap; justify-content: left; align-items: center; column-gap: 16px; row-gap: 0;">
  <a style="flex: 0 0 auto;" href="https://github.com/Lumina-Finance/lumina-finance/actions/workflows/backend-tests.yml"><img alt="Backend Tests" src="https://img.shields.io/github/actions/workflow/status/Lumina-Finance/lumina-finance/backend-tests.yml?branch=main&label=Backend%20Tests&style=flat&logo=githubactions&logoColor=white"></a>
  <a style="flex: 0 0 auto;" href="https://github.com/Lumina-Finance/lumina-finance/actions/workflows/build-and-push-docker-image.yml"><img alt="Docker Image Builds" src="https://img.shields.io/github/actions/workflow/status/Lumina-Finance/lumina-finance/build-and-push-docker-image.yml?event=release&label=Docker%20Image%20Builds&style=flat&logo=githubactions&logoColor=white"></a>
  <a style="flex: 0 0 auto;" href="https://hub.docker.com/r/luminahq/lumina-finance"><img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/luminahq/lumina-finance?label=Docker%20Pulls&style=flat&logo=docker&logoColor=white&labelColor=2496ED&color=white"></a>
  <a style="flex: 0 0 auto;" href="https://github.com/Lumina-Finance/lumina-finance"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/Lumina-Finance/lumina-finance?label=GitHub%20Stars&style=flat&logo=github&logoColor=white&labelColor=181717&color=eac54f"></a>
</div>

<!-- markdownlint-enable MD033 -->

Lumina Finance is a self-hosted personal finance app for managing your finances, track expenses, set budgets, and perform analysis on your spending behaviour.

## DISCLAIMER

THIS APPLICATION IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTIES OF ANY KIND. THIS APPLICATION IS A SOFTWARE TOOL ONLY AND DOES NOT PROVIDE FINANCIAL, INVESTMENT, TAX, LEGAL, ACCOUNTING, OR OTHER PROFESSIONAL ADVICE. ANY CALCULATIONS, ESTIMATES, PROJECTIONS, SUMMARIES, OR OTHER OUTPUTS MAY BE INACCURATE OR INCOMPLETE AND SHOULD NOT BE RELIED ON AS A SUBSTITUTE FOR PROFESSIONAL JUDGMENT. YOU ARE SOLELY RESPONSIBLE FOR REVIEWING ALL OUTPUTS AND FOR ANY DECISIONS YOU MAKE. USE OF THIS APPLICATION IS AT YOUR OWN RISK.

## Features

Lumina Finance gives you one place to track accounts, transactions, budgets, and financial trends while keeping the app under your control.

- **Accounts** - Track cash, credit, savings, and other account types with balance history, detail views, and hide archived accounts
- **Transactions** - Add or import transactions, then organize them with merchants, categories, tags, and notes
- **Budgets** - Create recurring or one-off budgets, attach them to categories, and see current and historical utilization at a glance
- **Dashboard** - Check net worth, credit usage, spending, savings rate, recent activity, and top budgets from one place
- **Runway** - Choose the accounts that make up your cash cushion and see how many months they could cover based on your recent average spending in the worst case scenario
- **Insights** - Review cash flow, income and expense breakdowns, net worth trends, savings-rate trends, and merchant patterns
- **Self-hostable** - You have full control of your data, run it locally with Docker or bare metal

### Roadmap

This roadmap may change as Lumina Finance evolves based on user feedback, technical constraints, and project priorities.

#### Near Term

- [X] Insights tab for deeper reports and trends
- [X] UI/UX polish across the main workflows
- [X] Bug fixes and stability improvements
- [X] Multi-currency support
- [ ] Application security improvements and fixes
- [ ] OIDC and WebAuthN support
- [ ] SaaS development and testing

#### Long Term

- [ ] SimpleFIN and Plaid connections for automatic account and transaction syncing
- [ ] Basic investment tracker (bring your own data)
- [ ] A few quite ambitious features we're not quite ready to spoil yet :)

## Screenshots

These pages are now also fully mobile and tablet optimized!

<!-- markdownlint-disable MD033 -->

<p align="center">
  <img src="docs/screenshots/dashboard_light.png" alt="Screenshot of dashboard in light mode" width="49%">
  <img src="docs/screenshots/dashboard_dark.png" alt="Screenshot of dashboard in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/accounts_light.png" alt="Screenshot of accounts page in light mode" width="49%">
  <img src="docs/screenshots/accounts_dark.png" alt="Screenshot of accounts page in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/insights_light.png" alt="Screenshot of insights page in light mode" width="49%">
  <img src="docs/screenshots/insights_dark.png" alt="Screenshot of insights page in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/account_details_light.png" alt="Screenshot of account details in light mode" width="49%">
  <img src="docs/screenshots/account_details_dark.png" alt="Screenshot of account details in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/transactions_light.png" alt="Screenshot of transactions page in light mode" width="49%">
  <img src="docs/screenshots/transactions_dark.png" alt="Screenshot of transactions page in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/budgets_light.png" alt="Screenshot of budgets page in light mode" width="49%">
  <img src="docs/screenshots/budgets_dark.png" alt="Screenshot of budgets page in dark mode" width="49%">
</p>

<p align="center">
  <img src="docs/screenshots/budget_details_light.png" alt="Screenshot of budget details in light mode" width="49%">
  <img src="docs/screenshots/budget_details_dark.png" alt="Screenshot of budget details in dark mode" width="49%">
</p>

<!-- markdownlint-enable MD033 -->

## Deployment

### Docker

If you'd like to deploy this with Docker, an example docker compose file is provided in [`docker/compose.example.yml`](docker/compose.example.yml) with an example [`.env`](docker/.env.example) file containing the required variables and optional `APP_URL` and `FRANKFURTER_URL` values.

### Bare Metal

If you'd like to deploy this bare metal, please clone the repo. The frontend is built with vite and you can build it and serve the static files with things like Caddy or Nginx. The backend is built with FastAPI, so you can serve it as a plain ASGI application with uvicorn. All environment variables should be set at the repo's root level. **Note that you will be responsible for generating the required RSA256 private keys as the auto generation currently only works with the Docker deployment as part of the startup process, in additon to configuring the environment variables correctly.**

### Frankfurter (Foreign Currency Exchange Rates)

Lumina uses [Frankfurter](https://github.com/lineofflight/frankfurter) for FX rates. By default, it uses the hosted API at `https://api.frankfurter.dev/v2`.

Frankfurter can also be self-hosted. To use a self-hosted instance, see Frankfurter's GitHub repository for details. After it's set up, set `FRANKFURTER_URL` to its versioned API URL, including the `/v2` path, for Lumina Finance to use your self hosted instance.

## Environment Variables

| Variable | Required | Expected Values | Default Value | Purpose |
| --- | --- | --- | --- | --- |
| `APP_URL` | No | URL origin | None | Public frontend origin. Automatically included in the backend CORS allowed origins. If unset, CORS allows all origins |
| `DB_HOST` | Yes | Hostname or IP | None | PostgreSQL host |
| `DB_PORT` | Yes | Port number | None | PostgreSQL port |
| `DB_NAME` | Yes | Database name | None | PostgreSQL database name |
| `DB_USER` | Yes | Database user | None | PostgreSQL username |
| `DB_PASSWORD` | Yes | Database password | None | PostgreSQL password |
| `FRANKFURTER_URL` | No | URL including API version path | `https://api.frankfurter.dev/v2` | Frankfurter-compatible FX rate API URL; set this to a self-hosted Frankfurter instance to keep FX lookups private |

### [JWKS (JSON Web Key Set)](https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-key-sets) and JWT Configs

These are some advanced variables that you could also set. Lumina Finance provides an endpoint that exposes known RSA public keys used to verify the JWT tokens. However, you should only modify these settings if you set up an API gateway or a reverse proxy that validates JWT token signatures. If you'd like to verify the JWT tokens so that only validated requests go through your API gateway/reverse proxy, you can configure the options below:

| Variable | Required | Expected Values | Default Value | Purpose |
| --- | --- | --- | --- | --- |
| `JWT_ACCESS_KID` | No | String | `access-kid` | Key ID written into access-token JWT headers and published in JWKS. It does not need to match the private key filename |
| `JWT_REFRESH_KID` | No | String | `refresh-kid` | Key ID written into refresh-token JWT headers and published in JWKS. It does not need to match the private key filename |
| `JWT_ACCESS_TOKEN_EXPIRE_SECONDS` | No | Positive integer | `900` | Access-token lifetime in seconds |
| `JWT_REFRESH_TOKEN_EXPIRE_SECONDS` | No | Positive integer | `86400` | Refresh-token lifetime in seconds |
| `JWT_ISSUER` | No | String | `lumina-finance` | JWT issuer claim |
| `JWT_ACCESS_PRIVATE_KEY_PATH` | No | File path | `/data/keys/access_private.pem` | Access token RSA256 private key path inside the container. If a key is not provided, the app will generate one automatically |
| `JWT_REFRESH_PRIVATE_KEY_PATH` | No | File path | `/data/keys/refresh_private.pem` | Refresh token RSA256 private key path inside the container. If a key is not provided, the app will generate one automatically |

## FAQs

1. **Why are you building Lumina Finance when other personal finance tools already exist?**

    There are already great personal finance tools out there, including some that are self-hostable, but many feel outdated, too simplistic, overly complicated, or too focused on one specific workflow.

    We are building Lumina Finance because we want a modern, feature-rich, and accessible alterantive that helps people understand their finances more clearly without needing to fight the software. Our goal is to combine strong financial tracking, a clean and modern user experience, privacy conscious design, and practical insights in one product. Essentially, we want to bulid something that "just works."

2. **Is this open source, and will self-hosting be free?**

    We are committed to keeping Lumina Finance free to self-host for non-commercial personal use, excluding features and services that require external data, paid APIs, or external compute.

    Our goal is to eventually make Lumina Finance open source, but because we may commercialize the project in the future, we are still evaluating the best licensing structure with legal professionals. We want to choose a license that supports community use while keeping the project sustainable.

    For now, any commercial, organizational, or business related use is not permitted unless explicitly authorized. This includes, but is not limited to, self hosting Lumina Finance for employees, clients, customers, contractors, teams, or business operations.

3. **What data does Lumina Finance collect?**

    For self hosted instances, Lumina Finance collects no data. Your data stays within your own deployment environment and never leaves your site. You are also responsible for securing your own deployment, database, backups, and any connected services.

---

<!-- markdownlint-disable MD033 -->
<a href="https://www.star-history.com/?repos=Lumina-Finance%2Flumina-finance&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Lumina-Finance/lumina-finance&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Lumina-Finance/lumina-finance&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Lumina-Finance/lumina-finance&type=date&legend=top-left" />
 </picture>
</a>
