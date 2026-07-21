import Foundation

actor ContentProcessor {
    private let aiService: AIService
    private let session: URLSession

    init(aiService: AIService = .shared) {
        self.aiService = aiService
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 40
        configuration.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: configuration)
    }

    func process(
        url: URL,
        onProgress: @Sendable (ProcessingStage) async -> Void
    ) async throws -> ProcessedContent {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            throw ContentProcessingError.invalidURL
        }

        await onProgress(.fetching)
        let fetched = try await fetch(url: url)
        await onProgress(.extracting)
        let metadata = HTMLMetadata(html: fetched.html, url: fetched.finalURL)
        let title = metadata.title ?? fetched.finalURL.host() ?? url.absoluteString
        let content = metadata.readableText

        guard content.count >= 40 || metadata.description?.isEmpty == false else {
            throw ContentProcessingError.noReadableContent
        }

        let combinedContent = [
            metadata.description,
            content,
        ]
        .compactMap { $0 }
        .joined(separator: "\n\n")
        .truncated(to: 18_000)

        await onProgress(.enriching)
        let enrichment = await aiService.enrich(
            title: title,
            content: combinedContent
        )
        return ProcessedContent(
            kind: Self.kind(for: fetched.finalURL),
            sourceName: Self.sourceName(for: fetched.finalURL),
            title: title,
            content: combinedContent,
            enrichment: enrichment
        )
    }

    private func fetch(url: URL) async throws -> (html: String, finalURL: URL) {
        var request = URLRequest(url: url)
        request.setValue(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
                "AppleWebKit/605.1.15 Mobile/15E148 Memo/1.0",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue(
            "text/html,application/xhtml+xml",
            forHTTPHeaderField: "Accept"
        )

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ContentProcessingError.invalidResponse
        }
        guard (200..<400).contains(httpResponse.statusCode) else {
            throw ContentProcessingError.httpStatus(httpResponse.statusCode)
        }
        guard data.count <= 8_000_000 else {
            throw ContentProcessingError.contentTooLarge
        }

        let encoding = Self.encoding(from: httpResponse)
        guard let html = String(data: data, encoding: encoding)
            ?? String(data: data, encoding: .utf8) else {
            throw ContentProcessingError.unsupportedEncoding
        }
        return (html, httpResponse.url ?? url)
    }

    private static func encoding(from response: HTTPURLResponse) -> String.Encoding {
        guard let name = response.textEncodingName else { return .utf8 }
        let encoding = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard encoding != kCFStringEncodingInvalidId else { return .utf8 }
        return String.Encoding(
            rawValue: CFStringConvertEncodingToNSStringEncoding(encoding)
        )
    }

    private static func kind(for url: URL) -> KnowledgeItemKind {
        let host = url.host()?.lowercased() ?? ""
        if host.contains("youtube") || host.contains("youtu.be") ||
            host.contains("bilibili") {
            return .video
        }
        if host.contains("podcast") || host.contains("xiaoyuzhou") ||
            host.contains("spotify") {
            return .podcast
        }
        return .article
    }

    private static func sourceName(for url: URL) -> String {
        let host = url.host()?.lowercased() ?? ""
        if host.contains("youtube") || host.contains("youtu.be") {
            return "YouTube"
        }
        if host.contains("bilibili") { return "B 站" }
        if host.contains("xiaohongshu") { return "小红书" }
        if host.contains("xiaoyuzhou") { return "小宇宙" }
        if host.contains("spotify") { return "Spotify" }
        return url.host() ?? "网页"
    }
}

private struct HTMLMetadata {
    let html: String
    let url: URL

    var title: String? {
        meta(property: "og:title")
            ?? meta(name: "twitter:title")
            ?? firstMatch(pattern: #"<title[^>]*>([\s\S]*?)</title>"#)
                .map(Self.decodeEntities)
                .map(Self.normalize)
    }

    var description: String? {
        meta(property: "og:description")
            ?? meta(name: "description")
            ?? meta(name: "twitter:description")
    }

    var readableText: String {
        var text = html
        text = text.replacing(
            pattern: #"<script\b[^>]*>[\s\S]*?</script>"#,
            with: " "
        )
        text = text.replacing(
            pattern: #"<style\b[^>]*>[\s\S]*?</style>"#,
            with: " "
        )
        text = text.replacing(
            pattern: #"<(nav|footer|header|aside)\b[^>]*>[\s\S]*?</\1>"#,
            with: " "
        )
        text = text.replacing(
            pattern: #"<(br|p|div|section|article|h[1-6]|li)\b[^>]*>"#,
            with: "\n"
        )
        text = text.replacing(pattern: #"<[^>]+>"#, with: " ")
        text = Self.decodeEntities(text)
        return text
            .split(separator: "\n")
            .map { Self.normalize(String($0)) }
            .filter { $0.count >= 2 }
            .joined(separator: "\n")
            .truncated(to: 24_000)
    }

    private func meta(property: String) -> String? {
        meta(attribute: "property", value: property)
    }

    private func meta(name: String) -> String? {
        meta(attribute: "name", value: name)
    }

    private func meta(attribute: String, value: String) -> String? {
        let escaped = NSRegularExpression.escapedPattern(for: value)
        let patterns = [
            #"<meta[^>]*\#(attribute)\s*=\s*["']\#(escaped)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>"#,
            #"<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*\#(attribute)\s*=\s*["']\#(escaped)["'][^>]*>"#,
        ]
        return patterns.lazy
            .compactMap(firstMatch)
            .map(Self.decodeEntities)
            .map(Self.normalize)
            .first { !$0.isEmpty }
    }

    private func firstMatch(pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else {
            return nil
        }
        let range = NSRange(html.startIndex..., in: html)
        guard let match = regex.firstMatch(in: html, range: range),
              let captureRange = Range(match.range(at: 1), in: html) else {
            return nil
        }
        return String(html[captureRange])
    }

    private static func decodeEntities(_ text: String) -> String {
        var decoded = text
        let replacements = [
            "&nbsp;": " ",
            "&amp;": "&",
            "&quot;": "\"",
            "&#39;": "'",
            "&lt;": "<",
            "&gt;": ">",
            "&hellip;": "…",
            "&mdash;": "—",
        ]
        for (entity, value) in replacements {
            decoded = decoded.replacingOccurrences(of: entity, with: value)
        }
        decoded = decoded.replacing(
            pattern: #"&#(\d+);"#,
            transform: { match in
                guard let value = Int(match), let scalar = UnicodeScalar(value) else {
                    return ""
                }
                return String(Character(scalar))
            }
        )
        return decoded
    }

    private static func normalize(_ text: String) -> String {
        text
            .replacing(pattern: #"\s+"#, with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

enum ContentProcessingError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)
    case contentTooLarge
    case unsupportedEncoding
    case noReadableContent

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "请输入有效的 http 或 https 链接"
        case .invalidResponse:
            "网站没有返回有效内容"
        case .httpStatus(let status):
            "网站请求失败（HTTP \(status)）"
        case .contentTooLarge:
            "网页内容过大，暂时无法处理"
        case .unsupportedEncoding:
            "暂时无法识别这个网页的文字编码"
        case .noReadableContent:
            "没有提取到可阅读正文，这个来源可能需要登录"
        }
    }
}

private extension String {
    func truncated(to maximumLength: Int) -> String {
        count <= maximumLength ? self : String(prefix(maximumLength))
    }

    func replacing(pattern: String, with replacement: String) -> String {
        guard let regex = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else {
            return self
        }
        let range = NSRange(startIndex..., in: self)
        return regex.stringByReplacingMatches(
            in: self,
            range: range,
            withTemplate: replacement
        )
    }

    func replacing(
        pattern: String,
        transform: (String) -> String
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return self
        }
        var result = self
        let matches = regex.matches(
            in: self,
            range: NSRange(startIndex..., in: self)
        )
        for match in matches.reversed() {
            guard let fullRange = Range(match.range(at: 0), in: result),
                  let valueRange = Range(match.range(at: 1), in: result) else {
                continue
            }
            result.replaceSubrange(
                fullRange,
                with: transform(String(result[valueRange]))
            )
        }
        return result
    }
}
