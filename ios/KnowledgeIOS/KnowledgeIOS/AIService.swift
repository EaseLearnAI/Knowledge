import Foundation
import NaturalLanguage
#if canImport(FoundationModels)
import FoundationModels
#endif

actor AIService {
    static let shared = AIService()

    func modelStatus() -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return "apple-intelligence"
            case .unavailable(.deviceNotEligible):
                return "local-extractive-device-ineligible"
            case .unavailable(.appleIntelligenceNotEnabled):
                return "local-extractive-ai-disabled"
            case .unavailable(.modelNotReady):
                return "local-extractive-model-not-ready"
            case .unavailable:
                return "local-extractive-model-unavailable"
            }
        }
        #endif
        return "local-extractive"
    }

    func enrich(title: String, content: String) async -> ContentEnrichment {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *),
           SystemLanguageModel.default.isAvailable,
           let generated = try? await generateEnrichment(
               title: title,
               content: content
           ) {
            return generated
        }
        #endif
        return extractiveEnrichment(title: title, content: content)
    }

    func answer(
        question: String,
        items: [KnowledgeItem]
    ) async -> (String, [ChatCitation]) {
        let relevantItems = rank(items: items, for: question).prefix(5)
        let citations = relevantItems.enumerated().map { index, item in
            ChatCitation(
                itemID: item.id,
                number: index + 1,
                title: item.title,
                quote: bestQuote(from: item, for: question),
                sourceName: item.sourceName
            )
        }

        guard !citations.isEmpty else {
            return (
                "你的收藏里暂时没有找到与这个问题直接相关的内容。可以先收藏几条相关资料，再来问我。",
                []
            )
        }

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *),
           SystemLanguageModel.default.isAvailable,
           let generated = try? await generateAnswer(
               question: question,
               citations: citations
           ) {
            return (generated, citations)
        }
        #endif

        let evidence = citations.map {
            "\($0.number). \($0.quote) [\($0.number)]"
        }.joined(separator: "\n\n")
        return (
            "我在你的收藏中找到了 \(citations.count) 条直接相关的内容：\n\n" +
                evidence +
                "\n\n以上回答只整理了你已收藏的原文，没有补充无法追溯的外部信息。",
            citations
        )
    }

    private func extractiveEnrichment(
        title: String,
        content: String
    ) -> ContentEnrichment {
        let sentences = sentenceTokens(in: content)
            .filter { $0.count >= 16 }
        let keyPoints = Array(sentences.prefix(4))
        let summary = keyPoints.first
            ?? String(content.prefix(180))
        return ContentEnrichment(
            summary: summary,
            whyWorthWatching: nil,
            keyPoints: keyPoints.isEmpty ? [summary] : keyPoints,
            tags: inferTags(from: "\(title) \(content)")
        )
    }

    private func sentenceTokens(in text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text
        var sentences: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) {
            range, _ in
            let sentence = text[range]
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !sentence.isEmpty {
                sentences.append(sentence)
            }
            return true
        }
        return sentences
    }

    private func inferTags(from text: String) -> [String] {
        let categories: [(String, [String])] = [
            ("AI 知识", ["ai", "agent", "模型", "人工智能", "llm", "gpt"]),
            ("产品", ["产品", "用户", "pmf", "增长", "体验", "需求"]),
            ("商业", ["商业", "市场", "收入", "公司", "创业", "资本"]),
            ("设计", ["设计", "界面", "交互", "视觉", "品牌"]),
            ("知识管理", ["知识", "笔记", "学习", "阅读", "记忆"]),
            ("效率", ["效率", "工作流", "自动化", "工具", "方法"]),
        ]
        let lowered = text.lowercased()
        let matches = categories
            .map { category, keywords in
                (
                    category,
                    keywords.reduce(0) {
                        $0 + (lowered.contains($1.lowercased()) ? 1 : 0)
                    }
                )
            }
            .filter { $0.1 > 0 }
            .sorted { $0.1 > $1.1 }
            .prefix(4)
            .map(\.0)
        return matches.isEmpty ? ["待分类"] : matches
    }

    private func rank(
        items: [KnowledgeItem],
        for question: String
    ) -> [KnowledgeItem] {
        let terms = question
            .lowercased()
            .split { $0.isWhitespace || $0.isPunctuation }
            .map(String.init)
            .filter { $0.count >= 2 }
        return items
            .filter { $0.status == .ready }
            .map { item -> (KnowledgeItem, Int) in
                let score = terms.reduce(into: 0) { score, term in
                    if item.title.lowercased().contains(term) { score += 8 }
                    if item.tags.joined().lowercased().contains(term) {
                        score += 5
                    }
                    if item.summary.lowercased().contains(term) { score += 3 }
                    if item.content.lowercased().contains(term) { score += 1 }
                }
                return (item, score)
            }
            .filter { $0.1 > 0 || items.count <= 5 }
            .sorted {
                if $0.1 == $1.1 {
                    $0.0.createdAt > $1.0.createdAt
                } else {
                    $0.1 > $1.1
                }
            }
            .map(\.0)
    }

    private func bestQuote(
        from item: KnowledgeItem,
        for question: String
    ) -> String {
        let terms = question
            .lowercased()
            .split { $0.isWhitespace || $0.isPunctuation }
            .map(String.init)
            .filter { $0.count >= 2 }
        let sentences = sentenceTokens(in: item.content)
        let ranked = sentences.max { lhs, rhs in
            terms.filter { lhs.lowercased().contains($0) }.count <
                terms.filter { rhs.lowercased().contains($0) }.count
        }
        return String((ranked ?? item.summary).prefix(220))
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private func generateEnrichment(
        title: String,
        content: String
    ) async throws -> ContentEnrichment {
        let session = LanguageModelSession(
            instructions: """
            你是个人知识库整理助手。只能依据提供的正文，不得补充外部事实。
            输出简洁中文，摘要不超过 100 字；关键观点每条不超过 60 字；
            标签使用 2 到 4 个短语。
            """
        )
        let response = try await session.respond(
            to: """
            标题：\(title)

            正文：
            \(String(content.prefix(9_000)))

            请严格按三段输出：
            摘要：...
            关键观点：观点一｜观点二｜观点三
            标签：标签一｜标签二｜标签三
            """
        )
        return parseEnrichment(
            response.content,
            fallbackTitle: title,
            fallbackContent: content
        )
    }

    @available(iOS 26.0, *)
    private func generateAnswer(
        question: String,
        citations: [ChatCitation]
    ) async throws -> String {
        let session = LanguageModelSession(
            instructions: """
            你是个人收藏知识助手。只能使用提供的来源回答。
            每个事实后标注对应的 [数字]；没有证据时明确说不知道。
            使用简洁中文，不要编造来源。
            """
        )
        let sources = citations.map {
            "[\($0.number)] \($0.title)\n\($0.quote)"
        }.joined(separator: "\n\n")
        let response = try await session.respond(
            to: "问题：\(question)\n\n来源：\n\(sources)"
        )
        return response.content
    }
    #endif

    private func parseEnrichment(
        _ output: String,
        fallbackTitle: String,
        fallbackContent: String
    ) -> ContentEnrichment {
        let fallback = extractiveEnrichment(
            title: fallbackTitle,
            content: fallbackContent
        )
        let lines = output.split(separator: "\n").map(String.init)
        let summary = value(after: "摘要：", in: lines) ?? fallback.summary
        let points = splitList(
            value(after: "关键观点：", in: lines)
        )
        let tags = splitList(value(after: "标签：", in: lines))
        return ContentEnrichment(
            summary: summary,
            whyWorthWatching: nil,
            keyPoints: points.isEmpty ? fallback.keyPoints : points,
            tags: tags.isEmpty ? fallback.tags : tags
        )
    }

    private func value(after prefix: String, in lines: [String]) -> String? {
        lines.first(where: { $0.hasPrefix(prefix) })
            .map { String($0.dropFirst(prefix.count)) }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .flatMap { $0.isEmpty ? nil : $0 }
    }

    private func splitList(_ value: String?) -> [String] {
        guard let value else { return [] }
        return value
            .components(separatedBy: CharacterSet(charactersIn: "｜|、"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}
