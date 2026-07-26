#!/usr/bin/env python3
"""Transcribe an already-normalized long audio file with local Whisper."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from videosummarize.extractor import get_audio_duration
from videosummarize.transcriber import transcribe_audio_chunked


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--chunk-seconds", type=int, default=600)
    parser.add_argument("--overlap-seconds", type=int, default=15)
    return parser.parse_args()


def split_audio(
    audio_path: Path,
    output_dir: Path,
    chunk_seconds: int,
    overlap_seconds: int,
) -> list[dict]:
    duration = get_audio_duration(audio_path)
    if duration <= chunk_seconds + overlap_seconds:
        return [{"path": audio_path, "offset": 0.0, "duration": duration}]

    step = chunk_seconds - overlap_seconds
    chunks: list[dict] = []
    start = 0.0
    index = 0
    while start < duration:
        chunk_duration = min(chunk_seconds, duration - start)
        if chunk_duration < 10 and chunks:
            break
        path = output_dir / f"local-chunk-{index:03d}.mp3"
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                str(start),
                "-t",
                str(chunk_duration),
                "-i",
                str(audio_path),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "48k",
                "-y",
                str(path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"本地 Whisper 音频分块失败: {result.stderr.strip()}")
        chunks.append(
            {
                "path": path,
                "offset": start,
                "duration": chunk_duration,
            }
        )
        start += step
        index += 1
    return chunks


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    chunks = split_audio(
        input_path,
        output_path.parent,
        args.chunk_seconds,
        args.overlap_seconds,
    )

    def on_chunk_done(done: int, total: int) -> None:
        print(
            json.dumps(
                {
                    "event": "transcription.local.chunk.completed",
                    "done": done,
                    "total": total,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

    result = transcribe_audio_chunked(
        chunks,
        model_size=args.model,
        language=args.language,
        max_workers=1,
        on_chunk_done=on_chunk_done,
    )
    output_path.write_text(
        json.dumps(result, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
