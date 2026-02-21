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

    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


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

    def fake_run_analysis(file_bytes: bytes, analysis_type: str):
        return f"Analysis type: {analysis_type}\\nFile size: {len(file_bytes)} bytes"

    monkeypatch.setattr("app.api.files.upload_file", fake_upload)
    monkeypatch.setattr("app.api.analysis.download_file", fake_download)
    monkeypatch.setattr("app.api.analysis.run_analysis", fake_run_analysis)

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


def test_upload_requires_auth(client):
    response = client.post(
        "/api/v1/files",
        files={"file": ("sample.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 401


@pytest.mark.usefixtures("stub_external")
def test_analyze_happy_path(client):
    headers = _register_and_login(client)

    upload_response = client.post(
        "/api/v1/files",
        headers=headers,
        files={"file": ("sample.txt", b"hello world", "text/plain")},
    )
    assert upload_response.status_code == 200
    file_id = upload_response.json()["id"]

    analysis_response = client.post(
        "/api/v1/analysis",
        headers=headers,
        json={"file_id": file_id, "analysis_type": "summary"},
    )

    assert analysis_response.status_code == 200
    body = analysis_response.json()
    assert "analysis_id" in body
    assert body["result"].startswith("Analysis type: summary")


@pytest.mark.usefixtures("stub_external")
def test_analyze_file_not_found(client):
    headers = _register_and_login(client)

    response = client.post(
        "/api/v1/analysis",
        headers=headers,
        json={"file_id": 9999, "analysis_type": "summary"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "File not found"
