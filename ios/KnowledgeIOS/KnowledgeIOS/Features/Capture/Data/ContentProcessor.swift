import Foundation

actor ContentProcessor {
    private let authTokenProvider: any AuthTokenProviding
    private let videoClient: VideoBackendClient
    private let usesUITestFixture: Bool

    init(
        authTokenProvider: any AuthTokenProviding = AuthStore.shared,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) {
        self.authTokenProvider = authTokenProvider
        videoClient = VideoBackendClient(
            environment: environment
        )
        usesUITestFixture = environment["KNOWLEDGE_UI_TEST_FIXTURE"] == "1"
    }

    func process(
        url: URL,
        idempotencyKey: String,
        remoteTaskID: String?,
        onRemoteTaskCreated: @Sendable (String, String) async -> Void,
        onProgress: @Sendable (ProcessingStage, Double?) async -> Void
    ) async throws -> ProcessedContent {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            throw ContentProcessingError.invalidURL
        }

        guard Self.isSupportedVideo(url) else {
            throw ContentProcessingError.unsupportedPlatform
        }
        if usesUITestFixture {
            return await processUITestFixture(onProgress: onProgress)
        }
        return try await processVideo(
            url: url,
            idempotencyKey: idempotencyKey,
            remoteTaskID: remoteTaskID,
            onRemoteTaskCreated: onRemoteTaskCreated,
            onProgress: onProgress
        )
    }

    private func processUITestFixture(
        onProgress: @Sendable (ProcessingStage, Double?) async -> Void
    ) async -> ProcessedContent {
        await onProgress(.fetching, 18)
        try? await Task.sleep(for: .seconds(2))
        await onProgress(.extracting, 48)
        try? await Task.sleep(for: .seconds(2))
        await onProgress(.enriching, 76)
        return ProcessedContent(
            kind: .video,
            sourceName: "B 站",
            title: "AI 工具复刻官方宣传片",
            content: "用 Codex、Gemini Omni 等 AI 工具复刻宣传片，并完成分镜、生成和剪辑。",
            enrichment: ContentEnrichment(
                summary: "可掌握低成本 AI 工具复刻视频的实操方法，理解从分镜到剪辑的完整流程。",
                whyWorthWatching: "用较低成本跑通一条可复用的视频生产工作流。",
                keyPoints: [
                    "先分析原片结构并拆成可执行分镜",
                    "使用生成式工具逐段生成画面",
                    "最后统一剪辑、配音并校正节奏",
                ],
                tags: ["AI视频创作", "AI工具应用", "内容复刻案例"]
            )
        )
    }

    private func processVideo(
        url: URL,
        idempotencyKey: String,
        remoteTaskID: String?,
        onRemoteTaskCreated: @Sendable (String, String) async -> Void,
        onProgress: @Sendable (ProcessingStage, Double?) async -> Void
    ) async throws -> ProcessedContent {
        let accessToken = try await authTokenProvider.accessToken()
        await onProgress(.fetching, nil)
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
            accessToken: { [authTokenProvider] in
                try await authTokenProvider.accessToken()
            },
            onTask: { task in
                if task.stage == "copywriting" {
                    await onProgress(.enriching, task.progress)
                } else {
                    await onProgress(.extracting, task.progress)
                }
            }
        )
        let completedAccessToken = try await authTokenProvider.accessToken()
        let item = try await videoClient.item(
            id: completed.sourceItemId,
            accessToken: completedAccessToken
        )
        guard let copywriting = item.copywriting,
              let contentText = item.content?.text ?? item.transcript?.text else {
            throw ContentProcessingError.invalidBackendResult
        }
        return ProcessedContent(
            kind: item.content?.kind == "image_post" || item.type == "image_post"
                ? .imagePost
                : .video,
            sourceName: Self.displayName(for: item.platform),
            title: item.title,
            content: contentText,
            enrichment: ContentEnrichment(
                summary: copywriting.oneSentenceSummary,
                whyWorthWatching: copywriting.whyWorthWatching,
                keyPoints: copywriting.keyPoints,
                tags: item.tags.isEmpty ? copywriting.tags : item.tags
            )
        )
    }

    func deleteRemoteItem(id: String) async throws {
        let accessToken = try await authTokenProvider.accessToken()
        try await videoClient.deleteItem(id: id, accessToken: accessToken)
    }

    func updateRemoteItem(
        id: String,
        tags: [String]?,
        isFavorite: Bool?
    ) async throws {
        let accessToken = try await authTokenProvider.accessToken()
        try await videoClient.updateItem(
            id: id,
            tags: tags,
            isFavorite: isFavorite,
            accessToken: accessToken
        )
    }

    private static func displayName(for platform: String) -> String {
        switch platform.lowercased() {
        case "xiaohongshu":
            return "小红书"
        case "douyin":
            return "抖音"
        case "bilibili":
            return "B 站"
        default:
            return platform
        }
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
}

enum ContentProcessingError: LocalizedError {
    case invalidURL
    case unsupportedPlatform
    case invalidBackendResult

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "请输入有效的 http 或 https 链接"
        case .unsupportedPlatform:
            "当前仅支持 B 站、小红书和抖音公开视频链接"
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
        onTask: @Sendable (RemoteVideoTask) async -> Void
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
            await onTask(task)
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

    func deleteItem(id: String, accessToken: String) async throws {
        var request = authorizedRequest(
            path: "items/\(id)",
            accessToken: accessToken
        )
        request.httpMethod = "DELETE"
        try await sendWithoutResponse(request)
    }

    func updateItem(
        id: String,
        tags: [String]?,
        isFavorite: Bool?,
        accessToken: String
    ) async throws {
        var request = authorizedRequest(
            path: "items/\(id)",
            accessToken: accessToken
        )
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            UpdateRemoteItemBody(tags: tags, isFavorite: isFavorite)
        )
        try await sendWithoutResponse(request)
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

    private func sendWithoutResponse(_ request: URLRequest) async throws {
        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request)
        } catch {
            throw VideoBackendError.connectionFailed
        }
        guard let http = response as? HTTPURLResponse else {
            throw VideoBackendError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw VideoBackendError.server(
                "后端删除失败（HTTP \(http.statusCode)）"
            )
        }
    }
}

private struct CaptureBody: Encodable {
    let url: String
    let quality: String
    let language: String
}

private struct UpdateRemoteItemBody: Encodable {
    let tags: [String]?
    let isFavorite: Bool?
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
    let progress: Double?
    let contentKind: String?
    let analysisMode: String?
    let error: VideoTaskProblem?

    private enum CodingKeys: String, CodingKey {
        case id = "_id"
        case sourceItemId
        case status
        case stage
        case progress
        case contentKind
        case analysisMode
        case error
    }
}

private struct VideoTaskProblem: Decodable {
    let message: String
}

private struct RemoteVideoItem: Decodable {
    let type: String?
    let title: String
    let platform: String
    let tags: [String]
    let transcript: RemoteTranscript?
    let content: RemoteContent?
    let copywriting: RemoteCopywriting?
}

private struct RemoteTranscript: Decodable {
    let text: String
}

private struct RemoteContent: Decodable {
    let text: String
    let kind: String
}

private struct RemoteCopywriting: Decodable {
    let oneSentenceSummary: String
    let whyWorthWatching: String
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
