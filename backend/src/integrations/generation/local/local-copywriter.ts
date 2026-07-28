import type {
  Copywriter,
  CopywritingResult,
  ProgressReporter,
  TranscriptResult,
} from "../../../modules/processing/domain/video.types.js";

function cleanSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map(cleanSentence)
    .filter((value) => value.length >= 8);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deriveTags(text: string): string[] {
  const rules: Array<[RegExp, string]> = [
    [/AI|人工智能|模型/i, "AI"],
    [/产品|用户|需求|体验/i, "产品"],
    [/学习|知识|记忆|课程/i, "学习"],
    [/创业|商业|公司|增长/i, "商业"],
    [/技术|代码|开发|架构/i, "技术"],
    [/访谈|播客|对话/i, "播客"],
  ];
  const tags = rules.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag);
  return (tags.length > 0 ? tags : ["待分类"]).slice(0, 3);
}

function chapterTitle(text: string, index: number): string {
  const short = cleanSentence(text).replace(/[。！？!?].*$/, "").slice(0, 22);
  return short || `章节 ${index + 1}`;
}

export class LocalCopywriter implements Copywriter {
  async generate(
    transcript: TranscriptResult,
    report: ProgressReporter,
  ): Promise<CopywritingResult> {
    await report("copywriting.started", "开始生成结构化承接文案", {
      provider: "local-deterministic",
    });
    const allSentences = sentences(transcript.text);
    const keyPoints = unique(allSentences).slice(0, 7);
    const summary =
      keyPoints[0] ??
      (transcript.text.trim()
        ? transcript.text.trim().slice(0, 120)
        : "该音视频没有识别到可用语音内容。");
    const whyWorthWatching =
      keyPoints[1] ??
      "系统已保存带时间戳的转录，可从关键观点快速判断是否值得继续精看。";

    const chapterSize = Math.max(1, Math.ceil(transcript.segments.length / 5));
    const chapters = [];
    for (let index = 0; index < transcript.segments.length; index += chapterSize) {
      const group = transcript.segments.slice(index, index + chapterSize);
      const first = group[0];
      const last = group.at(-1);
      if (!first || !last) continue;
      const chapterText = group.map((segment) => segment.text).join(" ");
      chapters.push({
        title: chapterTitle(chapterText, chapters.length),
        startMs: first.startMs,
        endMs: last.endMs,
        summary: sentences(chapterText)[0] ?? cleanSentence(chapterText).slice(0, 160),
      });
    }

    const actionItems = keyPoints
      .filter((point) => /应该|需要|可以|建议|行动|先/.test(point))
      .slice(0, 5);
    const tags = deriveTags(transcript.text);
    const markdown = [
      `# ${transcript.title}`,
      "",
      "## 一句话总结",
      summary,
      "",
      "## 为什么值得看",
      whyWorthWatching,
      "",
      "## 关键观点",
      ...keyPoints.map((point) => `- ${point}`),
      "",
      "## 章节",
      ...chapters.map(
        (chapter) =>
          `- **${formatTime(chapter.startMs)} ${chapter.title}**：${chapter.summary}`,
      ),
      "",
      "## 可执行动作",
      ...(actionItems.length > 0
        ? actionItems.map((item) => `- [ ] ${item}`)
        : ["- [ ] 根据关键观点选择一个动作继续验证"]),
      "",
      `标签：${tags.map((tag) => `#${tag}`).join(" ")}`,
    ].join("\n");

    const result: CopywritingResult = {
      oneSentenceSummary: summary,
      whyWorthWatching,
      keyPoints,
      chapters,
      actionItems,
      tags,
      markdown,
      provider: "local-deterministic",
    };
    await report("copywriting.completed", "结构化承接文案已生成", {
      keyPoints: keyPoints.length,
      chapters: chapters.length,
      tags,
    });
    return result;
  }
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
