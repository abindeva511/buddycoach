from fastapi import FastAPI
from app.api import auth, files, analysis
from app.db.base import Base
from app.db.session import engine

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Analysis Backend")

app.include_router(auth.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")