import { describe, expect, it } from "vitest";
import {
  extractHttpUrls,
  extractSupportedVideoUrl,
} from "../src/features/video/video-url.js";

const bilibiliUrl =
  "https://www.bilibili.com/video/BV1GWNQ6jE2x/?share_source=copy_web&vd_source=f6059df809e9959aa18ac40468f06d58";

describe("分享文本链接提取", () => {
  it("保留直接提交的受支持链接", () => {
    expect(extractSupportedVideoUrl(bilibiliUrl)).toBe(bilibiliUrl);
  });

  it("从标题和链接组成的 B站分享文案中提取链接", () => {
    const sharedText =
      `【地狱梗刷屏、学术打假、CEO发疯——2026上半年，社会在反抗什么？】 ${bilibiliUrl}`;
    expect(extractSupportedVideoUrl(sharedText)).toBe(bilibiliUrl);
  });

  it("移除分享链接末尾的中英文标点", () => {
    expect(
      extractSupportedVideoUrl(`推荐这个视频：${bilibiliUrl}。`),
    ).toBe(bilibiliUrl);
    expect(
      extractSupportedVideoUrl(
        "复制打开抖音：https://v.douyin.com/example/)，",
      ),
    ).toBe("https://v.douyin.com/example/");
  });

  it("跳过前面的无关链接并选择第一个受支持平台链接", () => {
    const sharedText =
      `活动页 https://example.com/campaign\n视频地址 ${bilibiliUrl}`;
    expect(extractSupportedVideoUrl(sharedText)).toBe(bilibiliUrl);
  });

  it("对没有 URL 的文案安全返回空结果", () => {
    expect(extractHttpUrls("这是一段没有链接的分享文案")).toEqual([]);
    expect(extractSupportedVideoUrl("这是一段没有链接的分享文案")).toBeNull();
  });
});
