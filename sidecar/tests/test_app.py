from fastapi.testclient import TestClient

import sidecar.app as sidecar_app


def test_search_reports_provider_failure(monkeypatch):
    def blocked(query, max_results):
        raise RuntimeError("rate limited")
    monkeypatch.setattr(sidecar_app, "search_web", blocked)
    response = TestClient(sidecar_app.app).post("/search", json={"query": "AI governance", "max_results": 3})
    assert response.status_code == 502
    assert "rate limited" in response.json()["detail"]


def test_fetch_reports_failure_for_each_selected_url(monkeypatch):
    async def failed(url, client, **kwargs):
        raise TypeError("unexpected parser error")
    monkeypatch.setattr(sidecar_app, "safe_fetch", failed)
    response = TestClient(sidecar_app.app).post("/fetch", json={
        "urls": ["https://example.org/one", "https://example.org/two"]
    })
    assert response.status_code == 200
    results = response.json()
    assert len(results) == 2
    assert all(result["ok"] is False and "Extraction failed" in result["error"] for result in results)
