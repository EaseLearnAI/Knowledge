# Memo iOS

这是 `prototype-v2/app.html` 的 iOS 可安装版本。App 直接打包并加载当前原型源文件，因此页面结构、视觉样式、动画和交互路由与原型保持同源。

## 打开

```bash
cd ios/KnowledgeIOS
xcodegen generate
open KnowledgeIOS.xcodeproj
```

默认 Scheme：`KnowledgeIOS`。

## 原型状态直达

运行或 UI 测试时可设置环境变量 `KNOWLEDGE_SCREEN`，值为 `01-home` 到 `12-ai-empty` 中的任一完整页面 ID。未设置时默认进入 `01-home`。
