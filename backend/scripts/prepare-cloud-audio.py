#!/usr/bin/env python3
"""Download or read media and produce a compact MP3 for cloud ASR."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import yt_dlp
from yt_dlp.utils import DownloadError
from videosummarize.downloader import download_video
from videosummarize.extractor import get_audio_duration


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--title")
    parser.add_argument("--cookies-browser")
    parser.add_argument("--cookies-file")
    return parser.parse_args()


def is_bilibili_url(source: str) -> bool:
    return any(host in source.lower() for host in ("bilibili.com", "b23.tv"))


def local_chrome_profile_exists() -> bool:
    home = Path.home()
    return any(
        path.exists()
        for path in (
            home / "Library/Application Support/Google/Chrome",
            home / ".config/google-chrome",
            home / ".config/chromium",
        )
    )


def remove_partial_downloads(output_dir: Path) -> None:
    for path in output_dir.glob("source.*"):
        if path.is_file():
            path.unlink(missing_ok=True)


def download_bilibili_audio(
    source: str,
    output_dir: Path,
    cookies_browser: str | None,
    cookies_file: str | None,
) -> tuple[Path, str]:
    def download(browser: str | None) -> tuple[Path, str]:
        options: dict[str, object] = {
            "outtmpl": str(output_dir / "source.%(ext)s"),
            "format": "bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "noplaylist": True,
            "retries": 10,
            "fragment_retries": 10,
            "socket_timeout": 30,
        }
        if browser:
            options["cookiesfrombrowser"] = (browser,)
        if cookies_file:
            options["cookiefile"] = cookies_file

        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(source, download=True)
            media_path = Path(ydl.prepare_filename(info)).resolve()
            if not media_path.exists():
                candidates = sorted(
                    output_dir.glob("source.*"),
                    key=lambda path: path.stat().st_mtime,
                    reverse=True,
                )
                if not candidates:
                    raise RuntimeError("B站音频下载完成后没有找到媒体文件")
                media_path = candidates[0].resolve()
            return media_path, str(info.get("title") or "视频内容")

    try:
        return download(cookies_browser)
    except DownloadError as error:
        should_try_local_chrome = (
            "HTTP Error 412" in str(error)
            and not cookies_browser
            and not cookies_file
            and local_chrome_profile_exists()
        )
        if not should_try_local_chrome:
            raise
        remove_partial_downloads(output_dir)
        print(
            "BILIBILI_COOKIE_FALLBACK: HTTP 412，正在使用本机 Chrome 登录 Cookie 重试",
            file=sys.stderr,
        )
        return download("chrome")


def extract_mp3(media_path: Path, output_dir: Path) -> Path:
    audio_path = output_dir / "audio.mp3"
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(media_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            "-y",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg 音频提取失败: {result.stderr.strip()}")
    return audio_path


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    source_path = Path(args.source)
    downloaded_path: Path | None = None

    if source_path.exists():
        media_path = source_path.resolve()
        title = args.title or source_path.stem
    elif is_bilibili_url(args.source):
        media_path, title = download_bilibili_audio(
            args.source,
            output_dir,
            args.cookies_browser,
            args.cookies_file,
        )
        downloaded_path = media_path
    else:
        result = download_video(
            args.source,
            output_dir,
            cookies_browser=args.cookies_browser,
            verbose=False,
        )
        media_path = Path(result["video_path"]).resolve()
        downloaded_path = media_path
        title = str(result.get("title") or args.title or "视频内容")

    try:
        audio_path = extract_mp3(media_path, output_dir)
        duration = get_audio_duration(audio_path)
        print(
            json.dumps(
                {
                    "audioPath": str(audio_path),
                    "title": title,
                    "durationSeconds": duration,
                    "sizeBytes": audio_path.stat().st_size,
                },
                ensure_ascii=False,
            )
        )
    finally:
        if downloaded_path and downloaded_path.exists():
            downloaded_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except DownloadError as error:
        print(f"MEDIA_DOWNLOAD_ERROR: {error}", file=sys.stderr)
        raise SystemExit(2) from None
