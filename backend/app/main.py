from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .history import router as history_router

app = FastAPI(title="Monte Carlo API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
app.include_router(history_router)


@app.get("/")
def root():
    return {"service": "Monte Carlo API", "status": "running"}
