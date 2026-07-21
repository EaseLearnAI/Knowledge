#!/usr/bin/env python3
"""新建的本地上传桥接器，不修改 videosummarize 原有源码。"""

import argparse
import json
from pathlib import Path

from videosummarize.extractor import extract_audio
from videosummarize.transcriber import transcribe_audio


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--title", default="本地上传音视频")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"request.local.input={input_path}", flush=True)
    print("stage.extract_audio.started", flush=True)
    audio_path = extract_audio(input_path, output_path.parent)
    print(f"stage.extract_audio.completed path={audio_path}", flush=True)
    print(f"stage.transcribe.started model={args.model} language={args.language}", flush=True)
    result = transcribe_audio(audio_path, args.model, args.language)
    print(
        f"stage.transcribe.completed characters={len(result['text'])} "
        f"segments={len(result['segments'])}",
        flush=True,
    )

    payload = {
        "title": args.title,
        "source": str(input_path),
        "text": result["text"],
        "segments": result["segments"],
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"response.transcript={output_path}", flush=True)


if __name__ == "__main__":
    main()
