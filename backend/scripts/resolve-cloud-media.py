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
        self.meta_all: dict[str, list[str]] = {}

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() != "meta":
            return
        values = {key.lower(): value or "" for key, value in attrs}
        key = values.get("property") or values.get("name")
        content = values.get("content")
        if key and content:
            normalized_key = key.lower()
            normalized_content = html.unescape(content)
            self.meta[normalized_key] = normalized_content
            self.meta_all.setdefault(normalized_key, []).append(normalized_content)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--cookies-browser")
    parser.add_argument("--cookies-file")
    parser.add_argument("--content", action="store_true")
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
    if not (
        host == "xiaohongshu.com"
        or host.endswith(".xiaohongshu.com")
        or host == "xhslink.com"
        or host.endswith(".xhslink.com")
    ):
        return None
    page = fetch_html(source, DESKTOP_USER_AGENT)
    parser = MetaParser()
    parser.feed(page)
    media_url = parser.meta.get("og:video")
    title = parser.meta.get("og:title", "小红书内容").removesuffix(" - 小红书")
    description = (
        parser.meta.get("og:description")
        or parser.meta.get("description")
        or ""
    ).strip()
    duration = duration_from_clock(parser.meta.get("og:videotime", ""))
    if media_url and media_url.startswith(("http://", "https://")):
        return {
            "url": media_url,
            "title": title,
            "durationSeconds": duration,
            "format": "mp4",
            "headers": {
                "Referer": source,
                "User-Agent": DESKTOP_USER_AGENT,
            },
            "kind": "short_video" if duration <= 180 else "long_video",
            "platform": "xiaohongshu",
            "text": description,
            "assets": [
                {
                    "kind": "video",
                    "url": media_url,
                    "format": "mp4",
                    "headers": {
                        "Referer": source,
                        "User-Agent": DESKTOP_USER_AGENT,
                    },
                }
            ],
        }
    images = []
    for key in ("og:image", "twitter:image"):
        for value in parser.meta_all.get(key, []):
            if value.startswith(("http://", "https://")) and value not in images:
                images.append(value)
    if not images:
        raise RuntimeError("小红书公开页面没有可处理的图片或视频地址")
    return {
        "title": title,
        "durationSeconds": 0,
        "kind": "image_post",
        "platform": "xiaohongshu",
        "text": description,
        "assets": [
            {
                "kind": "image",
                "url": value,
                "format": "jpg",
                "headers": {
                    "Referer": source,
                    "User-Agent": DESKTOP_USER_AGENT,
                },
            }
            for value in images
        ],
    }


def find_douyin_item(value: Any, expected_id: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        if str(value.get("aweme_id") or "") == expected_id:
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
        raise RuntimeError("抖音公开页面没有找到对应内容")
    title = str(item.get("desc") or "抖音内容").strip()
    headers = {
        "Referer": public_page,
        "User-Agent": MOBILE_USER_AGENT,
    }
    video = item.get("video")
    if isinstance(video, dict):
        urls = video.get("play_addr", {}).get("url_list", [])
        media_url = next(
            (
                value
                for value in urls
                if isinstance(value, str)
                and value.startswith(("http://", "https://"))
            ),
            None,
        )
        if media_url:
            raw_duration = float(video.get("duration") or 0)
            duration = raw_duration / 1000 if raw_duration > 18_000 else raw_duration
            return {
                "url": media_url,
                "title": title,
                "durationSeconds": duration,
                "format": "mp4",
                "headers": headers,
                "kind": "short_video" if duration <= 180 else "long_video",
                "platform": "douyin",
                "text": title,
                "assets": [
                    {
                        "kind": "video",
                        "url": media_url,
                        "format": "mp4",
                        "headers": headers,
                    }
                ],
            }
    image_assets = []
    for image in item.get("images") or []:
        if not isinstance(image, dict):
            continue
        urls = image.get("url_list") or image.get("download_url_list") or []
        image_url = next(
            (
                value
                for value in urls
                if isinstance(value, str)
                and value.startswith(("http://", "https://"))
            ),
            None,
        )
        if image_url:
            image_assets.append(
                {
                    "kind": "image",
                    "url": image_url,
                    "format": "jpg",
                    "headers": headers,
                }
            )
    if not image_assets:
        raise RuntimeError("抖音公开页面没有可处理的图片或视频地址")
    return {
        "title": title,
        "durationSeconds": 0,
        "kind": "image_post",
        "platform": "douyin",
        "text": title,
        "assets": image_assets,
    }


def resolve_with_ytdlp(args: argparse.Namespace) -> dict[str, Any]:
    import yt_dlp

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
    if args.content:
        if "kind" not in result:
            duration = float(result.get("durationSeconds") or 0)
            result = {
                **result,
                "kind": "short_video" if duration <= 180 else "long_video",
                "platform": "douyin"
                if "douyin" in args.source.lower()
                else "xiaohongshu",
                "text": str(result.get("title") or ""),
                "assets": [
                    {
                        "kind": "video",
                        "url": result["url"],
                        "format": result.get("format") or "mp4",
                        "headers": result.get("headers") or {},
                    }
                ],
            }
    elif "url" not in result:
        raise RuntimeError("当前音频转写链路不支持图文内容")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
