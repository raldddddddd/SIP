"""Bounded, public-web-only fetching for human-selected pages."""

import asyncio
import hashlib
import ipaddress
import socket
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura


USER_AGENT = "GovernedResearchBriefAssistant/1.0 (+local academic demo)"
MAX_BYTES = 2_000_000
MAX_ROBOTS_BYTES = 256_000
MAX_TEXT_CHARS = 6_000
MAX_REDIRECTS = 3
MAX_REQUESTS_PER_HOST = 2


class FetchError(ValueError):
    """An expected, user-visible fetch failure."""


class TitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self.in_title = True

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.parts.append(data)


def checked_url(url):
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except (ValueError, TypeError) as error:
        raise FetchError("Invalid URL.") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise FetchError("Only http and https URLs are allowed.")
    if parsed.username or parsed.password:
        raise FetchError("URLs containing credentials are not allowed.")
    if port not in {None, 80, 443}:
        raise FetchError("Only standard web ports 80 and 443 are allowed.")
    return parsed, urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


async def public_destination(url, resolver=socket.getaddrinfo):
    parsed, clean = checked_url(url)
    host = parsed.hostname
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            answers = await asyncio.to_thread(resolver, host, None, type=socket.SOCK_STREAM)
            addresses = [ipaddress.ip_address(answer[4][0]) for answer in answers]
        except (OSError, ValueError, IndexError) as error:
            raise FetchError("Could not resolve the destination host.") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise FetchError("Local, private, link-local, and reserved addresses are blocked.")
    return parsed, clean


async def fetch_bytes(url, client, *, resolver=socket.getaddrinfo, max_bytes=MAX_BYTES,
                      allowed_types=("text/html", "text/plain"), page_requests=None,
                      before_request=None):
    current = url
    for redirects in range(MAX_REDIRECTS + 1):
        parsed, current = await public_destination(current, resolver)
        if before_request is not None:
            await before_request(current)
        if page_requests is not None:
            count = page_requests.get(parsed.hostname, 0)
            if count >= MAX_REQUESTS_PER_HOST:
                raise FetchError("This domain has reached the two-request limit for this batch.")
            page_requests[parsed.hostname] = count + 1
        try:
            async with client.stream("GET", current, follow_redirects=False,
                                     headers={"User-Agent": USER_AGENT}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise FetchError("Redirect did not provide a destination.")
                    if redirects == MAX_REDIRECTS:
                        raise FetchError("Too many redirects.")
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400:
                    return b"", current, response.status_code, ""
                if response.status_code < 200 or response.status_code >= 300:
                    raise FetchError(f"Unexpected HTTP status {response.status_code}.")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if content_type not in allowed_types:
                    raise FetchError(f"Unsupported content type: {content_type or 'missing'}.")
                try:
                    stated_size = int(response.headers.get("content-length", "0") or "0")
                except ValueError:
                    stated_size = 0
                if stated_size > max_bytes:
                    raise FetchError("Page exceeds the download limit.")
                chunks = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise FetchError("Page exceeds the download limit.")
                    chunks.append(chunk)
                return b"".join(chunks), current, response.status_code, content_type
        except httpx.HTTPError as error:
            raise FetchError(f"Could not fetch the page: {type(error).__name__}.") from error
    raise FetchError("Too many redirects.")


async def robots_allow(url, client, resolver, robots_cache):
    parsed, _ = checked_url(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in robots_cache:
        robots_url = f"{origin}/robots.txt"
        body, _, status, _ = await fetch_bytes(
            robots_url, client, resolver=resolver, max_bytes=MAX_ROBOTS_BYTES,
            allowed_types=("text/plain", "text/html")
        )
        if status == 404:
            robots_cache[origin] = None
        elif status >= 400:
            raise FetchError(f"robots.txt could not be read (HTTP {status}).")
        else:
            rules = RobotFileParser()
            rules.set_url(robots_url)
            rules.parse(body.decode("utf-8", errors="replace").splitlines())
            robots_cache[origin] = rules
    rules = robots_cache[origin]
    if rules is not None and not rules.can_fetch(USER_AGENT, url):
        raise FetchError("robots.txt disallows this page for the demo user agent.")


async def safe_fetch(url, client, *, resolver=socket.getaddrinfo, robots_cache=None,
                     page_requests=None):
    """Fetch one URL, checking each hop and preserving the exact extracted snapshot."""
    robots_cache = {} if robots_cache is None else robots_cache
    page_requests = {} if page_requests is None else page_requests
    parsed, clean = await public_destination(url, resolver)
    async def check_robots(destination):
        await robots_allow(destination, client, resolver, robots_cache)

    body, final_url, status, content_type = await fetch_bytes(
        clean, client, resolver=resolver, page_requests=page_requests,
        before_request=check_robots
    )
    if status >= 400:
        raise FetchError(f"Page returned HTTP {status}.")
    raw_text = body.decode("utf-8", errors="replace")
    if content_type == "text/html":
        parser = TitleParser()
        parser.feed(raw_text)
        title = " ".join(" ".join(parser.parts).split())[:200] or urlsplit(final_url).hostname
        extracted = trafilatura.extract(raw_text, output_format="txt", include_comments=False)
    else:
        title = urlsplit(final_url).hostname
        extracted = raw_text
    text = "\n".join(line.strip() for line in (extracted or "").splitlines() if line.strip())[:MAX_TEXT_CHARS]
    if len(text) < 80:
        raise FetchError("Extraction returned too little usable text.")
    return {
        "url": clean,
        "finalUrl": final_url,
        "title": title,
        "text": text,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "ok": True,
        "error": None,
    }
