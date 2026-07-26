#!/usr/bin/env python3
"""Resolve a public social-video URL to a short-lived direct audio URL."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yt_dlp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    if source_path.exists():
        raise RuntimeError("火山录音识别需要公网可访问的音频 URL，不支持本地文件")

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "format": "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best",
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(args.source, download=False)

    if not isinstance(info, dict):
        raise RuntimeError("链接解析服务没有返回媒体信息")
    if info.get("_type") in {"playlist", "multi_video"}:
        entries = [entry for entry in info.get("entries", []) if isinstance(entry, dict)]
        if not entries:
            raise RuntimeError("链接中没有可处理的媒体")
        info = entries[0]

    media_url = info.get("url")
    if not isinstance(media_url, str) or not media_url.startswith(("http://", "https://")):
        raise RuntimeError("没有解析到可供云端 ASR 读取的音频地址")

    extension = str(info.get("ext") or "m4a").lower()
    if extension not in {"mp3", "m4a", "wav", "ogg", "webm", "aac", "flac"}:
        extension = "m4a"
    print(
        json.dumps(
            {
                "url": media_url,
                "title": str(info.get("title") or "视频内容"),
                "durationSeconds": float(info.get("duration") or 0),
                "format": extension,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
