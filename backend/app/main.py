from fastapi import FastAPI
from mangum import Mangum

app = FastAPI(title="Lumina Finance API")


@app.get("/health")
async def health():
    return {"status": "ok"}


# Lambda handler
handler = Mangum(app)
