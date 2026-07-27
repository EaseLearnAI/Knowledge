import Foundation

actor ContentProcessor {
    private let authStore: AuthStore
    private let videoClient: VideoBackendClient
    private let session: URLSession

    init(
        authStore: AuthStore = .shared
    ) {
        self.authStore = authStore
        videoClient = VideoBackendClient(
            environment: ProcessInfo.processInfo.environment
        )
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 40
        configuration.httpMaximumConnectionsPerHost = 2
        session = URLSession(configuration: configuration)
    }

    func process(
        url: URL,
        idempotencyKey: String,
        remoteTaskID: String?,
        onRemoteTaskCreated: @Sendable (String, String) async -> Void,
        onProgress: @Sendable (ProcessingStage) async -> Void
    ) async throws -> ProcessedContent {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            throw ContentProcessingError.invalidURL
        }

        guard Self.isSupportedVideo(url) else {
            throw ContentProcessingError.unsupportedPlatform
        }
        return try await processVideo(
            url: url,
            idempotencyKey: idempotencyKey,
            remoteTaskID: remoteTaskID,
            onRemoteTaskCreated: onRemoteTaskCreated,
            onProgress: onProgress
        )
    }

    private func processVideo(
        url: URL,
        idempotencyKey: String,
        remoteTaskID: String?,
        onRemoteTaskCreated: @Sendable (String, String) async -> Void,
        onProgress: @Sendable (ProcessingStage) async -> Void
    ) async throws -> ProcessedContent {
        let accessToken = try await authStore.accessToken()
        await onProgress(.fetching)
        let task: RemoteVideoTask
        if let remoteTaskID {
            task = try await videoClient.task(
                id: remoteTaskID,
                accessToken: accessToken
            )
        } else {
            task = try await videoClient.createCapture(
                url: url,
                idempotencyKey: idempotencyKey,
                accessToken: accessToken
            )
            await onRemoteTaskCreated(task.id, task.sourceItemId)
        }
        let completed = try await videoClient.waitForTask(
            task,
            accessToken: { [authStore] in
                try await authStore.accessToken()
            },
            onStage: { stage in
                if stage == "copywriting" {
                    await onProgress(.enriching)
                } else {
                    await onProgress(.extracting)
                }
            }
        )
        let completedAccessToken = try await authStore.accessToken()
        let item = try await videoClient.item(
            id: completed.sourceItemId,
            accessToken: completedAccessToken
        )
        guard let transcript = item.transcript,
              let copywriting = item.copywriting else {
            throw ContentProcessingError.invalidBackendResult
        }
        return ProcessedContent(
            kind: .video,
            sourceName: item.platform,
            title: item.title,
            content: transcript.text,
            enrichment: ContentEnrichment(
                summary: copywriting.oneSentenceSummary,
                keyPoints: copywriting.keyPoints,
                tags: item.tags.isEmpty ? copywriting.tags : item.tags
            )
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
        if host.contains("bilibili") || host.contains("douyin") ||
            host.contains("xiaohongshu") || host.contains("xhslink") {
            return .video
        }
        if host.contains("podcast") || host.contains("xiaoyuzhou") ||
            host.contains("spotify") {
            return .podcast
        }
        return .article
    }

    private static func isSupportedVideo(_ url: URL) -> Bool {
        let host = url.host()?.lowercased() ?? ""
        return [
            "bilibili.com",
            "b23.tv",
            "douyin.com",
            "iesdouyin.com",
            "xiaohongshu.com",
            "xhslink.com",
        ].contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    private static func sourceName(for url: URL) -> String {
        let host = url.host()?.lowercased() ?? ""
        if host.contains("bilibili") { return "B 站" }
        if host.contains("xiaohongshu") { return "小红书" }
        if host.contains("douyin") { return "抖音" }
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
    case unsupportedPlatform
    case invalidResponse
    case httpStatus(Int)
    case contentTooLarge
    case unsupportedEncoding
    case noReadableContent
    case invalidBackendResult

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "请输入有效的 http 或 https 链接"
        case .unsupportedPlatform:
            "当前仅支持 B 站、小红书和抖音公开视频链接"
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
        case .invalidBackendResult:
            "后端任务已完成，但没有返回可用的转录和总结"
        }
    }
}

private struct VideoBackendClient: Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(environment: [String: String]) {
        let configured = environment["KNOWLEDGE_API_BASE"]
            ?? Bundle.main.object(forInfoDictionaryKey: "MEMO_API_BASE_URL") as? String
            ?? "http://127.0.0.1:3100/api/v1"
        baseURL = URL(string: configured)
            ?? URL(string: "http://127.0.0.1:3100/api/v1")!
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    func createCapture(
        url: URL,
        idempotencyKey: String,
        accessToken: String
    ) async throws -> RemoteVideoTask {
        var request = authorizedRequest(path: "captures", accessToken: accessToken)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(
            CaptureBody(url: url.absoluteString, quality: "balanced", language: "auto")
        )
        return try await send(request)
    }

    func task(id: String, accessToken: String) async throws -> RemoteVideoTask {
        try await send(
            authorizedRequest(path: "tasks/\(id)", accessToken: accessToken)
        )
    }

    func waitForTask(
        _ initialTask: RemoteVideoTask,
        accessToken: @Sendable () async throws -> String,
        onStage: @Sendable (String) async -> Void
    ) async throws -> RemoteVideoTask {
        var task = initialTask
        let deadline = Date().addingTimeInterval(3 * 60 * 60 + 10 * 60)
        while task.status != "completed" {
            if task.status == "failed" {
                throw VideoBackendError.taskFailed(
                    task.error?.message ?? "视频解析失败"
                )
            }
            guard Date() < deadline else {
                throw VideoBackendError.taskTimedOut
            }
            await onStage(task.stage)
            try await Task.sleep(for: .seconds(2))
            let request = authorizedRequest(
                path: "tasks/\(task.id)",
                accessToken: try await accessToken()
            )
            task = try await send(request)
        }
        return task
    }

    func item(id: String, accessToken: String) async throws -> RemoteVideoItem {
        try await send(
            authorizedRequest(path: "items/\(id)", accessToken: accessToken)
        )
    }

    private func authorizedRequest(path: String, accessToken: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func send<Value: Decodable>(_ request: URLRequest) async throws -> Value {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw VideoBackendError.connectionFailed
        }
        guard let http = response as? HTTPURLResponse else {
            throw VideoBackendError.invalidResponse
        }
        let envelope: VideoEnvelope<Value>
        do {
            envelope = try JSONDecoder().decode(VideoEnvelope<Value>.self, from: data)
        } catch {
            throw VideoBackendError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode), let value = envelope.data else {
            throw VideoBackendError.server(
                envelope.error?.message ?? "后端请求失败（HTTP \(http.statusCode)）"
            )
        }
        return value
    }
}

private struct CaptureBody: Encodable {
    let url: String
    let quality: String
    let language: String
}

private struct VideoEnvelope<Value: Decodable>: Decodable {
    let data: Value?
    let error: VideoProblem?
}

private struct VideoProblem: Decodable {
    let message: String
}

private struct RemoteVideoTask: Decodable {
    let id: String
    let sourceItemId: String
    let status: String
    let stage: String
    let error: VideoTaskProblem?

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case sourceItemId
        case status
        case stage
        case error
    }
}

private struct VideoTaskProblem: Decodable {
    let message: String
}

private struct RemoteVideoItem: Decodable {
    let title: String
    let platform: String
    let tags: [String]
    let transcript: RemoteTranscript?
    let copywriting: RemoteCopywriting?
}

private struct RemoteTranscript: Decodable {
    let text: String
}

private struct RemoteCopywriting: Decodable {
    let oneSentenceSummary: String
    let keyPoints: [String]
    let tags: [String]
}

enum VideoBackendError: LocalizedError, Equatable {
    case connectionFailed
    case invalidResponse
    case server(String)
    case taskFailed(String)
    case taskTimedOut

    var errorDescription: String? {
        switch self {
        case .connectionFailed:
            "无法连接视频解析后端，请确认服务已启动"
        case .invalidResponse:
            "视频解析后端返回了无法识别的数据"
        case .server(let message), .taskFailed(let message):
            message
        case .taskTimedOut:
            "视频解析超过 3 小时 10 分钟，请稍后重试"
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
