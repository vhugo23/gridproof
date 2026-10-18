
from fastapi import FastAPI

app = FastAPI(
    title="GridProof API",
    description="Virtual Power Integration & Commissioning API",
    version="0.1.0",
)

@app.get("/api/v1/health")
def health_check():
    return {
        "status": "ok",
        "service": "gridproof-api"
    }
