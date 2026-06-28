import ipaddress
import json
import re
import socket
from html.parser import HTMLParser
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode

MAX_RESPONSE_BYTES = 1_000_000
MAX_YOUTUBE_PAGE_BYTES = 5_000_000
MAX_REDIRECTS = 3
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
YOUTUBE_VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
YOUTUBE_DESCRIPTION_PATTERN = re.compile(
    r'"shortDescription":"((?:\\.|[^"\\])*)"',
)


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.metadata: dict[str, str] = {}
        self._inside_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.lower(): value for key, value in attrs if value}
        if tag.lower() == "title":
            self._inside_title = True
        if tag.lower() != "meta":
            return
        key = (attributes.get("property") or attributes.get("name") or "").lower()
        content = (attributes.get("content") or "").strip()
        if key and content and key not in self.metadata:
            self.metadata[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._inside_title = False

    def handle_data(self, data: str) -> None:
        if self._inside_title:
            self._title_parts.append(data.strip())

    @property
    def title(self) -> str:
        return " ".join(part for part in self._title_parts if part).strip()


def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AppError(ErrorCode.INVALID_VIDEO, "URL sumber harus menggunakan HTTP atau HTTPS.")
    if parsed.username or parsed.password:
        raise AppError(ErrorCode.INVALID_VIDEO, "URL sumber tidak boleh berisi kredensial.")
    try:
        default_port = 443 if parsed.scheme == "https" else 80
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or default_port)
    except socket.gaierror as exc:
        raise AppError(ErrorCode.INVALID_VIDEO, "Nama host sumber tidak dapat ditemukan.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise AppError(
                ErrorCode.INVALID_VIDEO,
                "URL lokal, private, atau internal tidak diizinkan.",
            )


def is_youtube_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname in YOUTUBE_HOSTS


def extract_youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    candidate: str | None = None
    if hostname == "youtu.be":
        candidate = parsed.path.strip("/").split("/", 1)[0]
    elif hostname in YOUTUBE_HOSTS:
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [None])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live"}:
                candidate = parts[1]
    if candidate and YOUTUBE_VIDEO_ID_PATTERN.fullmatch(candidate):
        return candidate
    return None


def parse_youtube_oembed(payload: dict, source_url: str) -> dict[str, str | bool | None]:
    title = str(payload.get("title") or "").strip()
    creator = str(payload.get("author_name") or "").strip()
    thumbnail = str(payload.get("thumbnail_url") or "").strip()
    return {
        "url": source_url,
        "title": title[:300] or None,
        "description": (
            f"Video YouTube oleh {creator}." if creator else "Sumber video YouTube."
        ),
        "creator": creator[:200] or None,
        "site_name": "YouTube",
        "thumbnail_url": thumbnail or None,
        "is_direct_media": False,
    }


def parse_youtube_api_response(
    payload: dict,
    source_url: str,
) -> dict[str, str | bool | None] | None:
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        return None
    snippet = items[0].get("snippet")
    if not isinstance(snippet, dict):
        return None
    thumbnails = snippet.get("thumbnails")
    thumbnail_url = None
    if isinstance(thumbnails, dict):
        candidates = [
            value
            for value in thumbnails.values()
            if isinstance(value, dict) and value.get("url")
        ]
        if candidates:
            best = max(
                candidates,
                key=lambda value: int(value.get("width", 0)) * int(value.get("height", 0)),
            )
            thumbnail_url = str(best["url"])
    title = str(snippet.get("title") or "").strip()
    description = str(snippet.get("description") or "").strip()
    creator = str(snippet.get("channelTitle") or "").strip()
    return {
        "url": source_url,
        "title": title[:300] or None,
        "description": description[:10_000] or None,
        "creator": creator[:200] or None,
        "site_name": "YouTube",
        "thumbnail_url": thumbnail_url,
        "is_direct_media": False,
    }


def parse_youtube_page_description(html: str) -> str | None:
    match = YOUTUBE_DESCRIPTION_PATTERN.search(html)
    if not match:
        return None
    try:
        description = json.loads(f'"{match.group(1)}"').strip()
    except (json.JSONDecodeError, AttributeError):
        return None
    return description[:10_000] or None


def fetch_youtube_page_description(
    client: httpx.Client,
    video_id: str,
) -> str | None:
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    with client.stream("GET", canonical_url) as response:
        response.raise_for_status()
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > MAX_YOUTUBE_PAGE_BYTES:
                break
            chunks.append(chunk)
    encoding = response.encoding or "utf-8"
    html = b"".join(chunks).decode(encoding, errors="replace")
    return parse_youtube_page_description(html)


def inspect_youtube_url(
    client: httpx.Client, source_url: str
) -> dict[str, str | bool | None]:
    try:
        response = client.get(
            "https://www.youtube.com/oembed",
            params={"url": source_url, "format": "json"},
        )
        response.raise_for_status()
        if len(response.content) > 100_000:
            raise AppError(ErrorCode.FILE_TOO_LARGE, "Metadata YouTube terlalu besar.")
        metadata = parse_youtube_oembed(response.json(), source_url)
    except (httpx.HTTPError, ValueError):
        try:
            with YoutubeDL(
                {
                    "quiet": True,
                    "no_warnings": True,
                    "skip_download": True,
                    "noplaylist": True,
                    "socket_timeout": 30,
                }
            ) as downloader:
                info = downloader.extract_info(source_url, download=False)
        except DownloadError as exc:
            raise AppError(
                ErrorCode.INVALID_VIDEO,
                "Metadata video YouTube tidak dapat dibaca.",
                422,
            ) from exc
        creator = str(info.get("uploader") or info.get("channel") or "").strip()
        metadata = {
            "url": source_url,
            "title": str(info.get("title") or "").strip()[:300] or None,
            "description": str(info.get("description") or "").strip()[:10_000] or None,
            "creator": creator[:200] or None,
            "site_name": "YouTube",
            "thumbnail_url": str(info.get("thumbnail") or "").strip() or None,
            "is_direct_media": False,
        }
    video_id = extract_youtube_video_id(source_url)
    if not video_id:
        return metadata

    api_key = get_settings().youtube_api_key.strip()
    if api_key:
        try:
            api_response = client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={"part": "snippet", "id": video_id, "key": api_key},
            )
            api_response.raise_for_status()
            api_metadata = parse_youtube_api_response(api_response.json(), source_url)
            if api_metadata:
                return api_metadata
        except (httpx.HTTPError, ValueError):
            pass

    try:
        description = fetch_youtube_page_description(client, video_id)
    except httpx.HTTPError:
        description = None
    if description:
        metadata["description"] = description
    return metadata


def parse_metadata(html: str, final_url: str) -> dict[str, str | bool | None]:
    parser = MetadataParser()
    parser.feed(html)
    title = parser.metadata.get("og:title") or parser.metadata.get("twitter:title") or parser.title
    description = (
        parser.metadata.get("og:description")
        or parser.metadata.get("twitter:description")
        or parser.metadata.get("description")
    )
    creator = (
        parser.metadata.get("author")
        or parser.metadata.get("article:author")
        or parser.metadata.get("og:site_name")
    )
    image = parser.metadata.get("og:image") or parser.metadata.get("twitter:image")
    return {
        "url": final_url,
        "title": title[:300] if title else None,
        "description": description[:10_000] if description else None,
        "creator": creator[:200] if creator else None,
        "site_name": (parser.metadata.get("og:site_name") or "")[:200] or None,
        "thumbnail_url": urljoin(final_url, image) if image else None,
        "is_direct_media": False,
    }


def inspect_source_url(url: str) -> dict[str, str | bool | None]:
    current_url = url
    headers = {
        "User-Agent": "XA-AutoClip/0.1 (+source-metadata-inspector)",
        "Accept": "text/html,video/*;q=0.8,*/*;q=0.1",
    }
    with httpx.Client(timeout=10, follow_redirects=False, headers=headers) as client:
        validate_public_url(current_url)
        if is_youtube_url(current_url):
            return inspect_youtube_url(client, current_url)
        for _ in range(MAX_REDIRECTS + 1):
            validate_public_url(current_url)
            with client.stream("GET", current_url) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise AppError(ErrorCode.INVALID_VIDEO, "Redirect sumber tidak valid.")
                    current_url = urljoin(current_url, location)
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if content_type.startswith("video/"):
                    return {
                        "url": str(response.url),
                        "title": urlparse(str(response.url)).path.rsplit("/", 1)[-1] or None,
                        "description": "Direct media URL terdeteksi.",
                        "creator": None,
                        "site_name": urlparse(str(response.url)).hostname,
                        "thumbnail_url": None,
                        "is_direct_media": True,
                    }
                if "text/html" not in content_type:
                    raise AppError(
                        ErrorCode.INVALID_VIDEO,
                        "URL tidak mengarah ke halaman HTML atau file video.",
                    )
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise AppError(
                            ErrorCode.FILE_TOO_LARGE,
                            "Halaman sumber terlalu besar untuk dibaca.",
                        )
                    chunks.append(chunk)
                encoding = response.encoding or "utf-8"
                html = b"".join(chunks).decode(encoding, errors="replace")
                return parse_metadata(html, str(response.url))
    raise AppError(ErrorCode.INVALID_VIDEO, "Terlalu banyak redirect pada URL sumber.")
