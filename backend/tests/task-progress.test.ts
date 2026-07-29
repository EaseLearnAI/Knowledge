import { describe, expect, it } from "vitest";
import {
  progressForTaskEvent,
  publicTaskError,
} from "../src/modules/processing/application/task-progress.js";

describe("任务真实里程碑进度", () => {
  it("将内容识别、多模态分析和完成事件映射为单调阶段进度", () => {
    expect(
      progressForTaskEvent("content.resolve.completed", "平台内容识别完成"),
    ).toEqual({
      stage: "resolved",
      progress: 20,
      statusMessage: "平台内容识别完成",
    });
    expect(
      progressForTaskEvent("analysis.minimax.started", "已发起多模态理解"),
    ).toEqual({
      stage: "analyzing",
      progress: 55,
      statusMessage: "已发起多模态理解",
    });
    expect(progressForTaskEvent("task.completed", "全部完成")?.progress).toBe(100);
  });

  it("按实际完成的长文本分段计算总结里程碑", () => {
    expect(
      progressForTaskEvent(
        "copywriting.ark.map.chunk.completed",
        "第 2 段完成",
        { chunk: 2, chunks: 4 },
      ),
    ).toEqual({
      stage: "summarizing",
      progress: 86,
      statusMessage: "第 2 段完成",
    });
  });

  it("不把 stdout 等非里程碑日志伪装成进度", () => {
    expect(progressForTaskEvent("video.cli.stdout", "download 42%")).toBeUndefined();
  });

  it("隐藏小红书下载器技术错误并提供可重试提示", () => {
    expect(
      publicTaskError(
        "VIDEO_DOWNLOAD_FAILED",
        "No video formats found!",
        "https://www.xiaohongshu.com/explore/example",
      ),
    ).toBe(
      "暂时无法读取这条小红书内容。请确认笔记仍可访问，刷新分享链接后点击重试。",
    );
  });
});
