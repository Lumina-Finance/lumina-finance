from fastapi import FastAPI
from mangum import Mangum

from app.routes.auth import router as auth_router
from app.routes.user import router as user_router

app = FastAPI(title="Lumina Finance API")
app.include_router(auth_router)
app.include_router(user_router)


@app.get("/health")
async def health():
    """Return a simple health check response."""
    return {"status": "ok"}


# Lambda handler
handler = Mangum(app)
