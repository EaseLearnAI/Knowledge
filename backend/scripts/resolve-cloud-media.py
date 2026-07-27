#!/usr/bin/env python3
"""Resolve public social-video pages to a cloud-downloadable media URL.

Xiaohongshu and Douyin are resolved from public SSR metadata first so the cloud
worker does not depend on a developer browser profile. yt-dlp remains the
generic fallback for other compatible public URLs.
"""

from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import yt_dlp

DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 Mobile/15E148"
)
DOUYIN_ID_PATTERN = re.compile(r"(?:modal_id=|/video/|/share/video/)(\d{10,24})")


class MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.meta: dict[str, str] = {}

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() != "meta":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        key = values.get("property") or values.get("name")
        content = values.get("content")
        if key and content:
            self.meta[key.lower()] = html.unescape(content)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--cookies-browser")
    parser.add_argument("--cookies-file")
    return parser.parse_args()


def fetch_html(url: str, user_agent: str) -> str:
    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "User-Agent": user_agent,
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            if response.status != 200:
                raise RuntimeError(f"公开页面返回 HTTP {response.status}")
            return response.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as error:
        raise RuntimeError(f"公开页面请求失败：{type(error).__name__}") from error


def duration_from_clock(value: str) -> float:
    parts = value.strip().split(":")
    if not parts or not all(part.isdigit() for part in parts):
        return 0
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return float(total)


def resolve_xiaohongshu(source: str) -> dict[str, Any] | None:
    host = (urlparse(source).hostname or "").lower()
    if not (host == "xiaohongshu.com" or host.endswith(".xiaohongshu.com")):
        return None
    page = fetch_html(source, DESKTOP_USER_AGENT)
    parser = MetaParser()
    parser.feed(page)
    media_url = parser.meta.get("og:video")
    if not media_url or not media_url.startswith(("http://", "https://")):
        raise RuntimeError("小红书公开页面没有可处理的视频地址")
    title = parser.meta.get("og:title", "小红书视频").removesuffix(" - 小红书")
    return {
        "url": media_url,
        "title": title,
        "durationSeconds": duration_from_clock(parser.meta.get("og:videotime", "")),
        "format": "mp4",
        "headers": {
            "Referer": source,
            "User-Agent": DESKTOP_USER_AGENT,
        },
    }


def find_douyin_item(value: Any, expected_id: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        video = value.get("video")
        if (
            str(value.get("aweme_id") or "") == expected_id
            and isinstance(video, dict)
            and isinstance(video.get("play_addr"), dict)
        ):
            return value
        for child in value.values():
            result = find_douyin_item(child, expected_id)
            if result:
                return result
    elif isinstance(value, list):
        for child in value:
            result = find_douyin_item(child, expected_id)
            if result:
                return result
    return None


def resolve_douyin(source: str) -> dict[str, Any] | None:
    host = (urlparse(source).hostname or "").lower()
    if not (
        host == "douyin.com"
        or host.endswith(".douyin.com")
        or host == "iesdouyin.com"
        or host.endswith(".iesdouyin.com")
    ):
        return None
    match = DOUYIN_ID_PATTERN.search(source)
    if not match:
        modal_id = parse_qs(urlparse(source).query).get("modal_id", [])
        match_id = modal_id[0] if modal_id and modal_id[0].isdigit() else None
    else:
        match_id = match.group(1)
    if not match_id:
        return None

    public_page = f"https://www.iesdouyin.com/share/video/{match_id}/"
    page = fetch_html(public_page, MOBILE_USER_AGENT)
    state_match = re.search(
        r"<script>window\._ROUTER_DATA\s*=\s*(\{.*?\})</script>",
        page,
        flags=re.DOTALL,
    )
    if not state_match:
        raise RuntimeError("抖音公开页面缺少视频元数据")
    state = json.loads(state_match.group(1))
    item = find_douyin_item(state, match_id)
    if not item:
        raise RuntimeError("抖音公开页面没有找到对应视频")
    video = item["video"]
    urls = video.get("play_addr", {}).get("url_list", [])
    media_url = next(
        (
            value
            for value in urls
            if isinstance(value, str) and value.startswith(("http://", "https://"))
        ),
        None,
    )
    if not media_url:
        raise RuntimeError("抖音公开页面没有可处理的视频地址")
    raw_duration = float(video.get("duration") or 0)
    return {
        "url": media_url,
        "title": str(item.get("desc") or "抖音视频").strip(),
        "durationSeconds": raw_duration / 1000 if raw_duration > 18_000 else raw_duration,
        "format": "mp4",
        "headers": {
            "Referer": public_page,
            "User-Agent": MOBILE_USER_AGENT,
        },
    }


def resolve_with_ytdlp(args: argparse.Namespace) -> dict[str, Any]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "format": "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best",
        "noplaylist": True,
        "retries": 3,
        "socket_timeout": 30,
        "http_headers": {"User-Agent": DESKTOP_USER_AGENT},
    }
    if args.cookies_browser:
        options["cookiesfrombrowser"] = (args.cookies_browser,)
    if args.cookies_file:
        options["cookiefile"] = args.cookies_file
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(args.source, download=False)

    if not isinstance(info, dict):
        raise RuntimeError("链接解析服务没有返回媒体信息")
    if info.get("_type") in {"playlist", "multi_video"}:
        entries = [
            entry for entry in info.get("entries", []) if isinstance(entry, dict)
        ]
        if not entries:
            raise RuntimeError("链接中没有可处理的媒体")
        info = entries[0]

    media_url = info.get("url")
    if not isinstance(media_url, str) or not media_url.startswith(
        ("http://", "https://")
    ):
        raise RuntimeError("没有解析到可供云端 ASR 读取的媒体地址")
    extension = str(info.get("ext") or "m4a").lower()
    if extension not in {
        "mp3",
        "m4a",
        "mp4",
        "wav",
        "ogg",
        "webm",
        "aac",
        "flac",
    }:
        extension = "m4a"
    return {
        "url": media_url,
        "title": str(info.get("title") or "视频内容"),
        "durationSeconds": float(info.get("duration") or 0),
        "format": extension,
        "headers": {
            str(key): str(value)
            for key, value in (info.get("http_headers") or {}).items()
            if key.lower() in {"user-agent", "referer", "origin"}
        },
    }


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    if source_path.exists():
        raise RuntimeError("火山录音识别需要公网可访问的音频 URL，不支持本地文件")

    result = (
        resolve_xiaohongshu(args.source)
        or resolve_douyin(args.source)
        or resolve_with_ytdlp(args)
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
