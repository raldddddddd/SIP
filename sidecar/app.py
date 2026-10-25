"""Local FastAPI service for search and public-page extraction."""

import asyncio
import time
from urllib.parse import urlsplit

import httpx
from ddgs import DDGS
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .safe_fetch import FetchError, safe_fetch


app = FastAPI(title="Governed Research Search Sidecar", docs_url=None, redoc_url=None)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=6, ge=1, le=10)


class FetchRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=8)


@app.get("/health")
def health():
    return {"ok": True}


def search_web(query, max_results):
    error = None
    for attempt in range(3):
        try:
            results = DDGS(timeout=10).text(query, max_results=max_results, backend="duckduckgo,yahoo")
            clean = []
            for item in results or []:
                url = str(item.get("href") or "")
                if urlsplit(url).scheme not in {"http", "https"}:
                    continue
                clean.append({
                    "title": str(item.get("title") or url)[:200],
                    "url": url,
                    "snippet": str(item.get("body") or "")[:500],
                })
            if clean:
                return clean
            error = RuntimeError("Search returned no usable results; it may be rate-limited or blocked.")
        except Exception as caught:
            error = caught
        time.sleep(1.5 * (attempt + 1))
    raise error


@app.post("/search")
async def search(request: SearchRequest):
    try:
        return await asyncio.to_thread(search_web, request.query.strip(), request.max_results)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Search unavailable: {error}") from error


@app.post("/fetch")
async def fetch(request: FetchRequest):
    results = []
    robots_cache = {}
    page_requests = {}
    async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
        for url in request.urls:
            try:
                results.append(await safe_fetch(url, client, robots_cache=robots_cache,
                                                page_requests=page_requests))
            except (FetchError, ValueError) as error:
                results.append({
                    "url": url, "finalUrl": None, "title": None, "text": None,
                    "fetchedAt": None, "sha256": None, "ok": False, "error": str(error),
                })
            except Exception as error:
                results.append({
                    "url": url, "finalUrl": None, "title": None, "text": None,
                    "fetchedAt": None, "sha256": None, "ok": False,
                    "error": f"Extraction failed: {type(error).__name__}.",
                })
    return results
