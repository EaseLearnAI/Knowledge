#!/usr/bin/env python3
"""Small JSON-only bridge to the official Volcengine TOS Python SDK.

Credentials are read exclusively from environment variables so they never
appear in the process command line or application logs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import tos


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"missing environment variable: {name}")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("upload", "presign", "delete"))
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--file")
    parser.add_argument("--expires", type=int, default=14_400)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    client = tos.TosClientV2(
        required_env("TOS_ACCESS_KEY"),
        required_env("TOS_SECRET_KEY"),
        required_env("TOS_ENDPOINT"),
        required_env("TOS_REGION"),
    )

    if args.operation == "upload":
        if not args.file:
            raise RuntimeError("--file is required for upload")
        response = client.put_object_from_file(args.bucket, args.key, args.file)
        print(json.dumps({"ok": True, "etag": getattr(response, "etag", None)}))
        return

    if args.operation == "presign":
        response = client.pre_signed_url(
            tos.HttpMethodType.Http_Method_Get,
            args.bucket,
            args.key,
            expires=args.expires,
        )
        print(json.dumps({"ok": True, "url": response.signed_url}))
        return

    client.delete_object(args.bucket, args.key)
    print(json.dumps({"ok": True}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # SDK errors include request IDs in their message.
        print(
            json.dumps(
                {"ok": False, "error": str(error), "type": type(error).__name__}
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
