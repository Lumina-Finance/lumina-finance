from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS, APP_ENV, RUNTIME
from app.routes.account import router as account_router
from app.routes.auth import router as auth_router
from app.routes.base_budget import router as base_budget_router
from app.routes.budget import router as budget_router
from app.routes.category import router as category_router
from app.routes.currency import router as currency_router
from app.routes.group import router as group_router
from app.routes.institution import router as institution_router
from app.routes.merchant import router as merchant_router
from app.routes.tag import router as tag_router
from app.routes.transaction import router as transaction_router
from app.routes.user import router as user_router

app = FastAPI(title="Lumina Finance API")

# CORS — origins from env; allow any origin in development for LAN testing
_allowed_origins = list(ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"^https?://(localhost|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$" if APP_ENV == "development" else None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router)
app.include_router(user_router)
app.include_router(currency_router)
app.include_router(institution_router)
app.include_router(account_router)
app.include_router(category_router)
app.include_router(merchant_router)
app.include_router(tag_router)
app.include_router(transaction_router)
app.include_router(group_router)
app.include_router(base_budget_router)
app.include_router(budget_router)


@app.get("/health")
async def health():
    """Return a simple health check response."""
    return {"status": "ok"}


# Lambda handler — only created when running on Lambda
if RUNTIME == "lambda":
    from mangum import Mangum

    handler = Mangum(app)
