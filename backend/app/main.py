from fastapi import FastAPI
from mangum import Mangum

from app.routes.account import router as account_router
from app.routes.auth import router as auth_router
from app.routes.category import router as category_router
from app.routes.currency import router as currency_router
from app.routes.institution import router as institution_router
from app.routes.user import router as user_router

app = FastAPI(title="Lumina Finance API")
app.include_router(auth_router)
app.include_router(user_router)
app.include_router(currency_router)
app.include_router(institution_router)
app.include_router(account_router)
app.include_router(category_router)


@app.get("/health")
async def health():
    """Return a simple health check response."""
    return {"status": "ok"}


# Lambda handler
handler = Mangum(app)
