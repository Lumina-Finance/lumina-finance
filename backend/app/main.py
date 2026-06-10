"""Application entrypoint"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS, RUNTIME
from app.routes.accounts import router as account_router
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
from app.routes.tax_advantaged_plans import router as tax_advantaged_plan_router
from app.routes.transactions import router as transaction_router
from app.routes.users import router as user_router

app = FastAPI(title="Lumina Finance API")


# CORS — origins from env
_allowed_origins = list(ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router)
app.include_router(user_router)
app.include_router(runway_router)
app.include_router(currency_router)
app.include_router(institution_router)
app.include_router(account_router)
app.include_router(tax_advantaged_plan_router)
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
