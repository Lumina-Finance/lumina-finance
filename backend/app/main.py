from fastapi import FastAPI
from mangum import Mangum

from app.routes.auth import router as auth_router

app = FastAPI(title="Lumina Finance API")
app.include_router(auth_router)


@app.get("/health")
async def health():
    """Return a simple health check response."""
    return {"status": "ok"}


# Lambda handler
handler = Mangum(app)
