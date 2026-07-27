"""Application entrypoint"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.oidc import OIDC_PROVIDER_CONFIGS
from app.config.runtime import ALLOWED_ORIGINS, RUNTIME
from app.database import async_session, verify_app_role_is_unprivileged
from app.routes.accounts import router as account_router
from app.routes.app_version import router as app_version_router
from app.routes.auth import router as auth_router
from app.routes.base_budgets import router as base_budget_router
from app.routes.budgets import router as budget_router
from app.routes.categories import router as category_router
from app.routes.currency import router as currency_router
from app.routes.dashboard import router as dashboard_router
from app.routes.groups import router as group_router
from app.routes.insights import router as insights_router
from app.routes.institution import router as institution_router
from app.routes.merchants import router as merchant_router
from app.routes.runway import router as runway_router
from app.routes.tags import router as tag_router
from app.routes.tax_advantaged_categories import router as tax_advantaged_category_router
from app.routes.transactions import router as transaction_router
from app.routes.users import router as user_router
from app.services.auth.oidc_providers import sync_oidc_providers
from app.services.email import build_email_sender, set_email_sender

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Verify the runtime cannot bypass row-level security, then seed OIDC providers before serving"""
    await verify_app_role_is_unprivileged()

    # Reconcile the provider table with the environment on every boot so credential
    # rotations and removals apply without a migration
    async with async_session() as session:
        await sync_oidc_providers(session, OIDC_PROVIDER_CONFIGS)

    if OIDC_PROVIDER_CONFIGS:
        enabled_slugs = ", ".join(provider.slug for provider in OIDC_PROVIDER_CONFIGS)
        logger.info("OIDC sign-in enabled for: %s", enabled_slugs)
    else:
        logger.info("OIDC sign-in is not configured")
    yield


app = FastAPI(title="Lumina Finance API", lifespan=_lifespan)

# Install the configured email sender before any request can send mail
set_email_sender(build_email_sender())


# CORS — origins from env
_allowed_origins = list(ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    # The client reads the bearer challenge to tell an expired-token 401 from a wrong-credential 401
    expose_headers=["WWW-Authenticate"],
)

app.include_router(auth_router)
app.include_router(app_version_router)
app.include_router(user_router)
app.include_router(runway_router)
app.include_router(currency_router)
app.include_router(institution_router)
app.include_router(account_router)
app.include_router(tax_advantaged_category_router)
app.include_router(category_router)
app.include_router(merchant_router)
app.include_router(tag_router)
app.include_router(transaction_router)
app.include_router(group_router)
app.include_router(base_budget_router)
app.include_router(budget_router)
app.include_router(dashboard_router)
app.include_router(insights_router)


@app.get("/health")
async def health():
    """Return API process health

    The endpoint intentionally avoids database or dependency checks so load
    balancers can verify that the application process is responding

    Returns:
        Static health status payload
    """
    return {"status": "ok"}


# Lambda handler — only created when running on Lambda
if RUNTIME == "lambda":
    from mangum import Mangum

    handler = Mangum(app)
