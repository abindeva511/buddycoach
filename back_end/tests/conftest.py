import os

import pytest
from fastapi.testclient import TestClient

# Configure required settings before importing the app.
os.environ["DATABASE_URL"] = "sqlite:///./test_integration.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["JWT_ALGORITHM"] = "HS256"
os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"] = "30"
os.environ["REFRESH_TOKEN_EXPIRE_DAYS"] = "7"
os.environ["AWS_ACCESS_KEY_ID"] = "test"
os.environ["AWS_SECRET_ACCESS_KEY"] = "test"
os.environ["AWS_REGION"] = "us-east-1"
os.environ["AWS_S3_BUCKET"] = "test-bucket"

from app.db.base import Base
from app.db.session import engine
from app.main import app


@pytest.fixture(autouse=True)
def reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
