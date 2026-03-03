import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth, files, analysis, exercises
from app.db.base import Base
from app.db.session import engine

# Configure logging
logging.basicConfig(
    level=logging.INFO,  # change to INFO in prod
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

logger = logging.getLogger(__name__)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Analysis Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Health check endpoint — confirms the server is up."""
    return {"status": "ok"}

app.include_router(auth.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")
app.include_router(exercises.router, prefix="/api/v1")
