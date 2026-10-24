from pathlib import Path

import httpx
import pytest

from sidecar.safe_fetch import FetchError, safe_fetch


def public_resolver(host, port, **kwargs):
    return [(None, None, None, None, ("93.184.216.34", 0))]


def client_for(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False)


@pytest.mark.asyncio
async def test_private_and_localhost_addresses_are_blocked():
    async with client_for(lambda request: httpx.Response(200, text="unexpected")) as client:
        for url in ["http://127.0.0.1/", "http://10.0.0.1/", "http://192.168.1.1/",
                    "http://169.254.169.254/", "http://[::1]/", "http://localhost/"]:
            with pytest.raises(FetchError, match="blocked|resolve"):
                await safe_fetch(url, client, resolver=lambda host, port, **kwargs:
                                 [(None, None, None, None, ("127.0.0.1", 0))])


@pytest.mark.asyncio
async def test_public_redirect_to_private_address_is_blocked():
    seen = []
    def handler(request):
        seen.append(str(request.url))
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})
    async with client_for(handler) as client:
        with pytest.raises(FetchError, match="blocked"):
            await safe_fetch("https://example.com/article", client, resolver=public_resolver)
    assert all("127.0.0.1" not in url for url in seen)


@pytest.mark.asyncio
async def test_non_http_scheme_is_blocked():
    async with client_for(lambda request: httpx.Response(200)) as client:
        with pytest.raises(FetchError, match="Only http and https"):
            await safe_fetch("file:///etc/passwd", client)


@pytest.mark.asyncio
@pytest.mark.parametrize("response, error", [
    (httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"pdf"), "content type"),
    (httpx.Response(200, headers={"content-type": "text/html"}, content=b"x" * 2_000_001), "download limit"),
])
async def test_wrong_type_and_oversized_response_are_rejected(response, error):
    def handler(request):
        return httpx.Response(404) if request.url.path == "/robots.txt" else response
    async with client_for(handler) as client:
        with pytest.raises(FetchError, match=error):
            await safe_fetch("https://example.com/article", client, resolver=public_resolver)


@pytest.mark.asyncio
async def test_html_fixture_is_extracted_and_hashed():
    html = (Path(__file__).parent / "fixtures" / "article.html").read_text()
    def handler(request):
        return httpx.Response(404) if request.url.path == "/robots.txt" else httpx.Response(
            200, headers={"content-type": "text/html"}, text=html)
    async with client_for(handler) as client:
        result = await safe_fetch("https://example.com/article", client, resolver=public_resolver)
    assert result["ok"] is True
    assert result["title"] == "Research safety guide"
    assert "evidence behind each finding" in result["text"]
    assert "Home About Contact" not in result["text"]
    assert len(result["sha256"]) == 64


@pytest.mark.asyncio
async def test_robots_disallow_blocks_page_request():
    seen = []
    def handler(request):
        seen.append(request.url.path)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, headers={"content-type": "text/plain"},
                                  text="User-agent: *\nDisallow: /private")
        return httpx.Response(200, headers={"content-type": "text/plain"}, text="x" * 100)
    async with client_for(handler) as client:
        with pytest.raises(FetchError, match="robots.txt disallows"):
            await safe_fetch("https://example.com/private", client, resolver=public_resolver)
    assert seen == ["/robots.txt"]
