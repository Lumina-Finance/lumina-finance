"""Application entrypoint"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import DBAPIError

from app.abuse_log import log_source_address
from app.config.email import EMAIL_BACKEND, EMAIL_BACKEND_LOGGING
from app.config.log_level import LOG_LEVEL
from app.config.runtime import ALLOWED_ORIGINS
from app.database import verify_app_role_is_unprivileged
from app.db.database_keys import verify_database_keys
from app.log_setup import configure_logging
from app.null_characters import refuse_null_characters
from app.request_hook import RequestObserverMiddleware, observe_requests
from app.request_log import log_request
from app.request_security import RequestBodySizeLimitMiddleware, SignInNoStoreMiddleware
from app.request_validation import handle_request_validation_error
from app.routes.accounts import router as account_router
from app.routes.app_version import router as app_version_router
from app.routes.auth import router as auth_router
from app.routes.bank_sync import bank_link_router, review_router
from app.routes.bank_sync import router as bank_sync_router
from app.routes.base_budgets import router as base_budget_router
from app.routes.budgets import router as budget_router
from app.routes.categories import router as category_router
from app.routes.currency import router as currency_router
from app.routes.dashboard import router as dashboard_router
from app.routes.groups import router as group_router
from app.routes.import_rules import router as import_rule_router
from app.routes.insights import router as insights_router
from app.routes.institution import router as institution_router
from app.routes.merchants import router as merchant_router
from app.routes.runway import router as runway_router
from app.routes.tags import router as tag_router
from app.routes.tax_advantaged_categories import router as tax_advantaged_category_router
from app.routes.transactions import router as transaction_router
from app.routes.users import router as user_router
from app.services.auth.step_up import ATTEMPTS_REMAINING_HEADER
from app.services.bank_sync.providers.contract import REFUSED_FIELDS_HEADER
from app.services.bank_sync.providers.registry import run_startup_checks
from app.services.email import build_email_sender, is_email_sender_installed, set_email_sender
from app.services.fx.lookup_budget import FxLookupBudgetMiddleware
from app.services.importers.background_save import run_in_app_saves
from app.services.maintenance.expired_records import run_cleanup_timer
from app.startup import sync_sign_in_providers
from app.statement_timeout import handle_statement_timeout
from app.valkey_store import use_valkey

configure_logging(LOG_LEVEL)

logger = logging.getLogger(__name__)

_LOGGING_BACKEND_WARNING = (
    "EMAIL_BACKEND is set to logging, so sign-up, password reset and email change links go to this log, and anyone "
    "who can read the log can use the links to take over an account. Please set EMAIL_BACKEND to smtp, "
    "with your SMTP settings, before inviting anyone else"
)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Verify the runtime, its database keys and each bank provider's settings, seed OIDC providers, then serve

    While serving, the app prunes expired records and saves imports. Code outside the app can turn the cleanup
    timer off, as the cleanup module says, and take over saving imports by installing its own starter
    """
    await verify_app_role_is_unprivileged()
    await verify_database_keys()
    await sync_sign_in_providers()
    run_startup_checks()

    # The cache's pool lives as long as the app, and a server without ValKey starts as usual
    async with use_valkey(), run_cleanup_timer(), run_in_app_saves():
        yield


# The API publishes no map of its routes, and no setting brings one back
app = FastAPI(
    title="Lumina Finance API",
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
    lifespan=_lifespan,
    # Ahead of every route's own dependencies, so a refused request reaches neither authentication nor the database
    dependencies=[Depends(refuse_null_characters)],
)

# Install the configured email sender before any request can send mail. A sender that code outside the
# app installed before reading the app stays in place
if not is_email_sender_installed():
    set_email_sender(build_email_sender())

    # Said on every start, since logging is the default and a first run works without mail, so an install
    # can run for months writing live links where anyone reading its log can use them
    if EMAIL_BACKEND == EMAIL_BACKEND_LOGGING:
        logger.warning(_LOGGING_BACKEND_WARNING)

app.add_exception_handler(RequestValidationError, handle_request_validation_error)
app.add_exception_handler(DBAPIError, handle_statement_timeout)


# Added before CORS so CORS ends up the outer layer, since middleware wraps in reverse order
# of addition and a rejected oversized body still has to carry its CORS headers
app.add_middleware(RequestBodySizeLimitMiddleware)
app.add_middleware(FxLookupBudgetMiddleware)

# Outside the body size guard, so even its refusal of a sign-in request carries the header
app.add_middleware(SignInNoStoreMiddleware)


# Without a configured origin the CORS layer is left out, so no response carries CORS headers
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        # The client reads the bearer challenge to tell an expired-token 401 from a wrong-credential 401, the
        # attempts count to warn before the lockout, and the fields a bank sign-in start refused to mark them.
        # A browser on another origin sees only what is listed
        expose_headers=["WWW-Authenticate", ATTEMPTS_REMAINING_HEADER, REFUSED_FIELDS_HEADER],
    )

# Added last so it is the outermost layer and sees every request, including one CORS or the body
# size guard answers without reaching a route
app.add_middleware(RequestObserverMiddleware)
observe_requests(log_source_address)
observe_requests(log_request)

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
app.include_router(import_rule_router)
app.include_router(transaction_router)
app.include_router(bank_sync_router)
app.include_router(bank_link_router)
app.include_router(review_router)
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
