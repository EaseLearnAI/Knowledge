from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "scripts" / "resolve-cloud-media.py"
SPEC = importlib.util.spec_from_file_location("resolve_cloud_media", SCRIPT)
assert SPEC and SPEC.loader
resolver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(resolver)


class PublicPlatformResolverTests(unittest.TestCase):
    def test_xiaohongshu_reads_public_open_graph_video(self) -> None:
        page = """
        <html><head>
          <meta property="og:title" content="公开笔记 - 小红书">
          <meta property="og:videotime" content="05:23">
          <meta property="og:video" content="https://sns-video.example/video.mp4">
        </head></html>
        """
        with patch.object(resolver, "fetch_html", return_value=page):
            result = resolver.resolve_xiaohongshu(
                "https://www.xiaohongshu.com/explore/note-id?xsec_token=test"
            )
        self.assertIsNotNone(result)
        assert result
        self.assertEqual(result["title"], "公开笔记")
        self.assertEqual(result["durationSeconds"], 323.0)
        self.assertEqual(result["format"], "mp4")
        self.assertEqual(result["kind"], "long_video")
        self.assertEqual(result["platform"], "xiaohongshu")

    def test_xiaohongshu_reads_public_image_post(self) -> None:
        page = """
        <html><head>
          <meta property="og:title" content="公开图文 - 小红书">
          <meta property="og:description" content="这是一篇公开图文正文">
          <meta property="og:image" content="https://sns-img.example/one.jpg">
          <meta property="og:image" content="https://sns-img.example/two.jpg">
        </head></html>
        """
        with patch.object(resolver, "fetch_html", return_value=page):
            result = resolver.resolve_xiaohongshu(
                "https://www.xiaohongshu.com/explore/note-id?xsec_token=test"
            )
        self.assertIsNotNone(result)
        assert result
        self.assertEqual(result["kind"], "image_post")
        self.assertEqual(result["title"], "公开图文")
        self.assertEqual(result["text"], "这是一篇公开图文正文")
        self.assertEqual(len(result["assets"]), 2)
        self.assertEqual(result["assets"][0]["kind"], "image")

    def test_douyin_normalizes_modal_id_and_millisecond_duration(self) -> None:
        item = {
            "aweme_id": "7658152723547753771",
            "desc": "公开抖音视频",
            "video": {
                "duration": 287441,
                "play_addr": {
                    "url_list": ["https://aweme.example/playwm/video-id"]
                },
            },
        }
        state = {
            "loaderData": {
                "video_(id)/page": {"videoInfoRes": {"item_list": [item]}}
            }
        }
        page = (
            "<script>window._ROUTER_DATA = "
            + json.dumps(state, ensure_ascii=False)
            + "</script>"
        )
        with patch.object(resolver, "fetch_html", return_value=page) as fetch:
            result = resolver.resolve_douyin(
                "https://www.douyin.com/jingxuan?modal_id=7658152723547753771"
            )
        self.assertIsNotNone(result)
        assert result
        self.assertEqual(result["title"], "公开抖音视频")
        self.assertEqual(result["durationSeconds"], 287.441)
        self.assertEqual(result["format"], "mp4")
        self.assertEqual(
            fetch.call_args.args[0],
            "https://www.iesdouyin.com/share/video/7658152723547753771/",
        )

    def test_douyin_reads_public_image_post(self) -> None:
        item = {
            "aweme_id": "7658152723547753772",
            "desc": "公开抖音图文",
            "images": [
                {"url_list": ["https://p3.example/one.jpeg"]},
                {"url_list": ["https://p3.example/two.jpeg"]},
            ],
        }
        state = {
            "loaderData": {
                "note_(id)/page": {"item_list": [item]}
            }
        }
        page = (
            "<script>window._ROUTER_DATA = "
            + json.dumps(state, ensure_ascii=False)
            + "</script>"
        )
        with patch.object(resolver, "fetch_html", return_value=page):
            result = resolver.resolve_douyin(
                "https://www.douyin.com/jingxuan?modal_id=7658152723547753772"
            )
        self.assertIsNotNone(result)
        assert result
        self.assertEqual(result["kind"], "image_post")
        self.assertEqual(result["title"], "公开抖音图文")
        self.assertEqual(len(result["assets"]), 2)


if __name__ == "__main__":
    unittest.main()
