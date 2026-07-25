# Memo · App Store 发布资料

## 基本信息

- App 名称：Memo
- 副标题：提取、分析并收藏内容
- Bundle ID：`ai.easelearn.knowledge`
- 版本：`1.0.0`（Build `1`）
- 主类别：效率
- 次类别：教育
- 年龄分级建议：4+
- 价格：免费
- 隐私政策 URL：<https://memo-privacy-support.dreamyyds.chatgpt.site>
- App 支持 URL：<https://memo-privacy-support.dreamyyds.chatgpt.site>

## 宣传文本

把值得记住的网页扔进来。Memo 自动提取正文、生成摘要和 Tag，让你随时找得到。

## 完整描述

Memo 是一个本地优先的内容提取、分析与收藏 App。

粘贴一条网页链接，Memo 会自动完成：

- 提取标题、正文与来源信息
- 生成一句话摘要和关键观点
- 自动推荐 Tag，也支持手动调整
- 全文搜索标题、摘要、正文和 Tag

完成产品引导并使用手机号或邮箱注册、登录后，你的收藏、摘要、Tag 与搜索索引仍默认保存在设备上。Memo 不接入广告、跨 App 追踪或第三方分析 SDK。若设备支持并启用了 Apple Intelligence，Memo 可使用 Apple 的端侧模型进行内容分析；否则使用本地可追溯的文本提取算法。

## 关键词

知识管理,稍后阅读,网页收藏,AI摘要,全文搜索,笔记,第二大脑,Tag,本地优先

## App Review 备注

- App 首次启动先展示三步产品引导，随后要求使用手机号或邮箱注册、登录；登录令牌保存在系统 Keychain。
- 主要流程：产品引导 → 手机号或邮箱注册/登录 → 点击添加 → 粘贴任意公开 HTTPS 网页 → 等待处理完成 → 查看摘要、关键观点、Tag 或搜索。
- 测试链接可使用：`https://example.com`
- 无付费墙、订阅或应用内购买。
- 无广告、追踪或第三方分析 SDK。
- 加密出口合规：仅使用 Apple 系统提供的标准 HTTPS 网络能力，`ITSAppUsesNonExemptEncryption = NO`。

## App Privacy 建议填写

接入生产认证服务后，应按实际上线的数据链路申报账号信息；不能继续选择 **Data Not Collected（不收集数据）**。

说明：

- 手机号或邮箱、昵称和密码哈希由认证服务处理；App 不保存明文密码。
- 登录令牌保存在系统 Keychain，提取内容、摘要和 Tag 仍保存在用户设备。
- 用户主动收藏网页时，设备会直接请求来源网站；Memo 没有自有内容服务器。
- 不包含广告、分析、追踪或第三方数据 SDK。

## 上架前仍需由账号所有者填写

- Apple Developer Team / 签名证书
- App Store Connect 中的开发者联系信息
- 销售地区和价格
- 内容版权声明
- 最终截图排序与本地化
