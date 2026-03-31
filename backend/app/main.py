from fastapi import FastAPI
from mangum import Mangum

app = FastAPI(title="Lumina Finance API")


@app.get("/health")
async def health():
    """Return a simple health check response."""
    return {"status": "ok"}


# Lambda handler
handler = Mangum(app)
