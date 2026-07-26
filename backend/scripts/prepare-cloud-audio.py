#!/usr/bin/env python3
"""Download or read media and produce a compact MP3 for cloud ASR."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from videosummarize.downloader import download_video
from videosummarize.extractor import get_audio_duration


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--title")
    parser.add_argument("--cookies-browser")
    return parser.parse_args()


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
    main()
