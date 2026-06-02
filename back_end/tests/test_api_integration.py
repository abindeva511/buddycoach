import pytest


def _register_and_login(client, username="alice", password="password123"):
    register_response = client.post(
        "/api/v1/auth/register",
        data={"username": username, "password": password},
    )
    assert register_response.status_code == 200

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
    )
    assert login_response.status_code == 200

    return login_response.json()


@pytest.fixture
def stub_external(monkeypatch):
    stored_files = {}

    def fake_upload(file_obj, user_id, filename):
        data = file_obj.read()
        key = f"uploads/{user_id}/{filename}"
        stored_files[key] = data
        return key

    def fake_download(key):
        return stored_files[key]

    monkeypatch.setattr("app.api.files.upload_file", fake_upload)
    monkeypatch.setattr("app.api.analysis.download_file", fake_download)

    return stored_files


def test_register_success(client):
    response = client.post(
        "/api/v1/auth/register",
        data={"username": "newuser", "password": "secret123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "id" in body
    assert body["username"] == "newuser"


def test_login_invalid_credentials(client):
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "missing-user", "password": "wrong"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


def test_login_returns_refresh_token(client):
    _register_and_login(client, username="token-user", password="secret123")
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "token-user", "password": "secret123"},
    )

    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["refresh_expires_in"] > 0


def test_refresh_token_happy_path(client):
    tokens = _register_and_login(client, username="refresh-user", password="secret123")
    response = client.post(
        "/api/v1/auth/refresh-token",
        json={"refresh_token": tokens["refresh_token"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


def test_refresh_token_rejects_access_token(client):
    tokens = _register_and_login(client, username="reject-user", password="secret123")
    response = client.post(
        "/api/v1/auth/refresh-token",
        json={"refresh_token": tokens["access_token"]},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid refresh token"


def test_upload_requires_auth(client):
    response = client.post(
        "/api/v1/files",
        files={"file": ("sample.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 401
