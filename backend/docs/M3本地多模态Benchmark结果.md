# M3 本地多模态 Benchmark 结果

> 验证时间：2026-07-27  
> 分支：`codex/m3-multimodal-backend`  
> 模型：`MiniMax-M3`  
> 运行模式：`TOS_ENABLED=false`，本地 Base64 Data URL

## 结论

本地运行不依赖 TOS。图片和短视频可以在本机完成下载、FFmpeg 转码、Base64
编码和 M3 调用。6 个真实模型 Case 全部通过；平台解析、路由、失败回退、安全
限制和兼容字段由自动化测试覆盖。

## 明确得分标准

每个真实模型 Case 同时满足以下条件才算通过：

1. `provider = minimax-m3-multimodal`；
2. `analysisMode = minimax_m3_multimodal`；
3. 可检索正文不少于 20 个字符；
4. 至少返回 1 个关键点；
5. 返回 1 到 3 个标签；
6. 本地媒体 Case 必须使用 `transport = data_url`；
7. 视频 Case 必须成功完成本地下载和 FFmpeg 转码；
8. 不允许把 API Key 或完整 Base64 内容写入日志。

## 真实模型 Case

| Case | 输入与链路 | 耗时 | 正文 | 要点 | 标签 | 结果 |
|---|---|---:|---:|---:|---:|---|
| REAL-01 | 远程图片 URL → M3 | 14.886s | 174 字符 | 6 | 3 | PASS |
| REAL-02 | 图片下载 → 本地 Data URL → M3 | 22.580s | 250 字符 | 7 | 3 | PASS |
| REAL-03 | 公共短视频 → 本地转码 → Data URL → M3 | 13.023s | 373 字符 | 6 | 3 | PASS |
| REAL-04 | 真实 B站 66 秒视频 → DASH 音视频合并 → Data URL → M3 | 40.814s | 830 字符 | 7 | 3 | PASS |
| REAL-05 | 两张图片 → 本地 Data URL → M3 | 28.619s | 525 字符 | 7 | 3 | PASS |
| REAL-06 | HTTP Capture → 队列 → 本地 Data URL → M3 → MongoDB 回读 | 20.960s | 592 字符 | 6 | 3 | PASS |

REAL-04 使用的公开链接：
`https://www.bilibili.com/video/BV1i7411X7jE/`

M3 返回的一句话总结：

> 本视频是一个1分钟教程，教大家如何使用在线解析工具下载B站视频，包括复制链接、粘贴解析、选择清晰度并下载的完整流程。

完整 HTTP Case 最终状态为 `completed / 100%`，任务记录
`contentKind=short_video`、`analysisMode=minimax_m3_multimodal`，内容与旧
`transcript` 兼容字段均成功入库。

公共短视频 Case 的总结：

> Big Buck Bunny 中胖大白兔与蝴蝶互动，并在草地中发现红花面露惊喜的开场片段，用于验证多模态视频理解。

## 自动化 Case 集合

| Case | 验证目标 | 测试位置 | 结果 |
|---|---|---|---|
| AUTO-01 | 无 TOS 时图片转换为 Data URL | `model-media-stager.test.ts` | PASS |
| AUTO-02 | 无 TOS 时视频转换为 Data URL | `model-media-stager.test.ts` | PASS |
| AUTO-03 | B站 DASH 音视频合并为单个 MP4 | `model-media-stager.test.ts` | PASS |
| AUTO-04 | 媒体地址指向内网时拒绝下载 | `model-media-stager.test.ts` | PASS |
| AUTO-05 | 图文直接走 M3，不调用 ASR | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-06 | 180 秒短视频直接走 M3 | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-07 | 181 秒长视频保留 ASR | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-08 | 短视频 M3 技术失败自动回退 ASR | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-09 | 图文 M3 失败不错误回退音频链路 | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-10 | 模型返回过多列表项时安全截断 | `minimax-multimodal-processor.test.ts` | PASS |
| AUTO-11 | 小红书公开视频解析 | `test_resolve_cloud_media.py` | PASS |
| AUTO-12 | 小红书图文多图解析 | `test_resolve_cloud_media.py` | PASS |
| AUTO-13 | 抖音公开视频解析 | `test_resolve_cloud_media.py` | PASS |
| AUTO-14 | 抖音图文多图解析 | `test_resolve_cloud_media.py` | PASS |
| AUTO-15 | `content` / `analysis` 兼容字段持久化 | `api.integration.test.ts` | PASS |

## 复现方式

```bash
cd backend
npm run typecheck
npm test
npm run test:python
npm run benchmark:m3
```

可单独运行真实 Case：

```bash
M3_BENCHMARK_CASES=REAL-01 npm run benchmark:m3
M3_BENCHMARK_CASES=REAL-02 npm run benchmark:m3
M3_BENCHMARK_CASES=REAL-03 npm run benchmark:m3
M3_BENCHMARK_CASES=REAL-04 npm run benchmark:m3
M3_BENCHMARK_CASES=REAL-05 npm run benchmark:m3
M3_BENCHMARK_CASES=REAL-06 npm run benchmark:m3
```

## 当前边界

- 本地模式会把媒体作为 Base64 放进请求体，适合开发和验收，不适合高并发生产。
- 生产环境仍建议使用临时对象存储，原因是内存、请求体大小和 Worker 并发，不是
  M3 本身强制要求 TOS。
- 小红书和抖音的公开页面结构、签名和登录策略可能变化，需要持续保留真实平台
  样本回归。当前这两个平台的内容分类与图文解析由固定网页夹具验证，尚缺用户
  提供的长期稳定真实链接。
