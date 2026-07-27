import Foundation
import Security

struct AuthUser: Codable, Sendable {
    let id: String
    let email: String?
    let phone: String?
    let accountType: String?
    let nickname: String
    let createdAt: String

    var primaryIdentifier: String {
        email ?? phone ?? nickname
    }
}

struct AuthSnapshot: Codable, Sendable {
    let isAuthenticated: Bool
    let user: AuthUser?
}

private struct AuthSession: Codable, Sendable {
    let user: AuthUser
    let accessToken: String
    let refreshToken: String
    let tokenType: String

    var snapshot: AuthSnapshot {
        AuthSnapshot(isAuthenticated: true, user: user)
    }
}

private struct BackendEnvelope<Value: Decodable>: Decodable {
    let success: Bool
    let data: Value?
    let error: BackendProblem?
}

private struct BackendProblem: Decodable, Sendable {
    let code: String
    let message: String
}

private enum AuthMode: String {
    case live
    case mock
    case bypass
}

actor AuthStore {
    static let shared = AuthStore()

    private let credentials = KeychainCredentialStore()
    private let client: BackendAPIClient
    private let mode: AuthMode
    private let installationID: UUID
    private var session: AuthSession?

    init() {
        let environment = ProcessInfo.processInfo.environment
        mode = AuthMode(rawValue: environment["KNOWLEDGE_AUTH_MODE"] ?? "live") ?? .live
        client = BackendAPIClient(environment: environment)
        installationID = Self.loadInstallationID()
        session = try? credentials.load()
    }

    func restoreSession() async -> AuthSnapshot {
        if mode == .bypass {
            return Self.testSession.snapshot
        }
        guard var current = session else {
            guard mode == .live else {
                return AuthSnapshot(isAuthenticated: false, user: nil)
            }
            do {
                let guest = try await client.guest(installationID: installationID)
                try credentials.save(guest)
                session = guest
                return guest.snapshot
            } catch {
                return AuthSnapshot(isAuthenticated: false, user: nil)
            }
        }
        if mode == .mock {
            return current.snapshot
        }

        do {
            current = try await validate(current)
            try credentials.save(current)
            session = current
            return current.snapshot
        } catch let error as BackendAPIError where error.isUnauthorized {
            do {
                current = try await client.refresh(token: current.refreshToken)
                try credentials.save(current)
                session = current
                return current.snapshot
            } catch {
                clearSession()
                return AuthSnapshot(isAuthenticated: false, user: nil)
            }
        } catch {
            // 本地优先：网络临时不可用时保留已验证过的本机会话。
            return current.snapshot
        }
    }

    func register(
        identifier: String,
        password: String,
        nickname: String?
    ) async throws -> AuthSnapshot {
        let normalizedIdentifier = try Self.validated(identifier: identifier)
        try Self.validate(password: password)
        let trimmedNickname = nickname?.trimmingCharacters(in: .whitespacesAndNewlines)
        let newSession: AuthSession
        if mode == .mock || mode == .bypass {
            newSession = Self.mockSession(
                identifier: normalizedIdentifier,
                nickname: trimmedNickname?.isEmpty == false ? trimmedNickname! : nil
            )
        } else {
            newSession = try await client.register(
                identifier: normalizedIdentifier,
                password: password,
                nickname: trimmedNickname?.isEmpty == false ? trimmedNickname : nil
            )
        }
        try credentials.save(newSession)
        session = newSession
        return newSession.snapshot
    }

    func login(identifier: String, password: String) async throws -> AuthSnapshot {
        let normalizedIdentifier = try Self.validated(identifier: identifier)
        guard !password.isEmpty else { throw AuthValidationError.emptyPassword }
        let newSession: AuthSession
        if mode == .mock || mode == .bypass {
            newSession = Self.mockSession(identifier: normalizedIdentifier, nickname: nil)
        } else {
            newSession = try await client.login(
                identifier: normalizedIdentifier,
                password: password
            )
        }
        try credentials.save(newSession)
        session = newSession
        return newSession.snapshot
    }

    func logout() async {
        let refreshToken = session?.refreshToken
        clearSession()
        guard mode == .live, let refreshToken else { return }
        try? await client.logout(refreshToken: refreshToken)
    }

    func resetSession() {
        clearSession()
    }

    func requireAuthentication() throws {
        if mode == .bypass { return }
        guard session != nil else { throw AuthValidationError.authenticationRequired }
    }

    func accessToken() async throws -> String {
        if mode == .bypass {
            return Self.testSession.accessToken
        }
        if session == nil {
            _ = await restoreSession()
        }
        guard var current = session else {
            throw AuthValidationError.authenticationRequired
        }
        if mode == .live,
           let expiration = Self.expiration(of: current.accessToken),
           expiration.timeIntervalSinceNow <= 60 {
            do {
                current = try await client.refresh(token: current.refreshToken)
                try credentials.save(current)
                session = current
            } catch {
                clearSession()
                throw error
            }
        }
        return current.accessToken
    }

    private func validate(_ current: AuthSession) async throws -> AuthSession {
        let user = try await client.currentUser(accessToken: current.accessToken)
        return AuthSession(
            user: user,
            accessToken: current.accessToken,
            refreshToken: current.refreshToken,
            tokenType: current.tokenType
        )
    }

    private func clearSession() {
        session = nil
        credentials.clear()
    }

    private static func validated(identifier: String) throws -> String {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("@") {
            let email = trimmed.lowercased()
            let pattern = #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#
            guard email.count <= 254,
                  email.range(of: pattern, options: .regularExpression) != nil else {
                throw AuthValidationError.invalidIdentifier
            }
            return email
        }

        var phone = trimmed.replacingOccurrences(
            of: #"[\s\-().]"#,
            with: "",
            options: .regularExpression
        )
        if phone.hasPrefix("0086") {
            phone = "+86" + String(phone.dropFirst(4))
        } else if phone.range(
            of: #"^86\d{11}$"#,
            options: .regularExpression
        ) != nil {
            phone = "+\(phone)"
        } else if phone.range(
            of: #"^1[3-9]\d{9}$"#,
            options: .regularExpression
        ) != nil {
            phone = "+86\(phone)"
        }
        guard phone.range(
            of: #"^\+[1-9]\d{7,14}$"#,
            options: .regularExpression
        ) != nil else {
            throw AuthValidationError.invalidIdentifier
        }
        return phone
    }

    private static func validate(password: String) throws {
        guard password.count >= 8 else { throw AuthValidationError.weakPassword }
        guard password.rangeOfCharacter(from: .letters) != nil,
              password.rangeOfCharacter(from: .decimalDigits) != nil else {
            throw AuthValidationError.weakPassword
        }
    }

    private static func loadInstallationID() -> UUID {
        let key = "ai.easelearn.knowledge.installation-id"
        if let value = UserDefaults.standard.string(forKey: key),
           let id = UUID(uuidString: value) {
            return id
        }
        let id = UUID()
        UserDefaults.standard.set(id.uuidString, forKey: key)
        return id
    }

    private static func expiration(of token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var encoded = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let payload = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
              let expiration = payload["exp"] as? TimeInterval else {
            return nil
        }
        return Date(timeIntervalSince1970: expiration)
    }

    private static func mockSession(identifier: String, nickname: String?) -> AuthSession {
        let isEmail = identifier.contains("@")
        return AuthSession(
            user: AuthUser(
                id: UUID().uuidString,
                email: isEmail ? identifier : nil,
                phone: isEmail ? nil : identifier,
                accountType: "registered",
                nickname: nickname
                    ?? (isEmail
                        ? identifier.split(separator: "@").first.map(String.init)
                        : "用户\(identifier.suffix(4))")
                    ?? "Memo 用户",
                createdAt: ISO8601DateFormatter().string(from: Date())
            ),
            accessToken: "mock-access-token",
            refreshToken: String(repeating: "m", count: 48),
            tokenType: "Bearer"
        )
    }

    private static let testSession = mockSession(
        identifier: "ui-tests@memo.local",
        nickname: "UI 测试"
    )
}

private struct BackendAPIClient: Sendable {
    private let baseURL: URL
    private let session: URLSession

    init(environment: [String: String]) {
        let configured = environment["KNOWLEDGE_API_BASE"]
            ?? Bundle.main.object(forInfoDictionaryKey: "MEMO_API_BASE_URL") as? String
            ?? "http://127.0.0.1:3100/api/v1"
        baseURL = URL(string: configured) ?? URL(string: "http://127.0.0.1:3100/api/v1")!
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    func register(
        identifier: String,
        password: String,
        nickname: String?
    ) async throws -> AuthSession {
        try await post(
            path: "auth/register",
            body: RegisterBody(
                identifier: identifier,
                password: password,
                nickname: nickname
            )
        )
    }

    func login(identifier: String, password: String) async throws -> AuthSession {
        try await post(
            path: "auth/login",
            body: LoginBody(identifier: identifier, password: password)
        )
    }

    func guest(installationID: UUID) async throws -> AuthSession {
        try await post(
            path: "auth/guest",
            body: GuestBody(installationId: installationID.uuidString)
        )
    }

    func refresh(token: String) async throws -> AuthSession {
        try await post(path: "auth/refresh", body: RefreshBody(refreshToken: token))
    }

    func logout(refreshToken: String) async throws {
        let _: EmptyResponse = try await post(
            path: "auth/logout",
            body: RefreshBody(refreshToken: refreshToken),
            allowsEmptyResponse: true
        )
    }

    func currentUser(accessToken: String) async throws -> AuthUser {
        var request = URLRequest(url: url(path: "auth/me"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return try await send(request)
    }

    private func post<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body,
        allowsEmptyResponse: Bool = false
    ) async throws -> Response {
        var request = URLRequest(url: url(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, allowsEmptyResponse: allowsEmptyResponse)
    }

    private func send<Response: Decodable>(
        _ request: URLRequest,
        allowsEmptyResponse: Bool = false
    ) async throws -> Response {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BackendAPIError.connectionFailed
        }
        guard let http = response as? HTTPURLResponse else {
            throw BackendAPIError.invalidResponse
        }
        if allowsEmptyResponse, http.statusCode == 204,
           let empty = EmptyResponse() as? Response {
            return empty
        }
        guard !data.isEmpty else { throw BackendAPIError.invalidResponse }
        let envelope: BackendEnvelope<Response>
        do {
            envelope = try JSONDecoder().decode(BackendEnvelope<Response>.self, from: data)
        } catch {
            throw BackendAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode), let value = envelope.data else {
            throw BackendAPIError.server(
                statusCode: http.statusCode,
                code: envelope.error?.code ?? "REQUEST_FAILED",
                message: envelope.error?.message ?? "请求失败，请稍后重试"
            )
        }
        return value
    }

    private func url(path: String) -> URL {
        baseURL.appending(path: path)
    }
}

private struct RegisterBody: Encodable {
    let identifier: String
    let password: String
    let nickname: String?
}

private struct LoginBody: Encodable {
    let identifier: String
    let password: String
}

private struct RefreshBody: Encodable {
    let refreshToken: String
}

private struct GuestBody: Encodable {
    let installationId: String
}

private struct EmptyResponse: Codable {
    init() {}
}

private struct KeychainCredentialStore: Sendable {
    private let service = "ai.easelearn.knowledge.auth"
    private let account = "session"

    func save(_ session: AuthSession) throws {
        let data = try JSONEncoder().encode(session)
        clear()
        let status = SecItemAdd(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                kSecValueData as String: data,
            ] as CFDictionary,
            nil
        )
        guard status == errSecSuccess else {
            throw AuthValidationError.secureStorageFailed
        }
    }

    func load() throws -> AuthSession? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ] as CFDictionary,
            &result
        )
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw AuthValidationError.secureStorageFailed
        }
        return try JSONDecoder().decode(AuthSession.self, from: data)
    }

    func clear() {
        SecItemDelete(
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ] as CFDictionary
        )
    }
}

private enum BackendAPIError: LocalizedError {
    case connectionFailed
    case invalidResponse
    case server(statusCode: Int, code: String, message: String)

    var isUnauthorized: Bool {
        if case .server(let statusCode, _, _) = self { return statusCode == 401 }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .connectionFailed:
            "无法连接登录服务，请确认后端已启动"
        case .invalidResponse:
            "登录服务返回了无法识别的数据"
        case .server(_, _, let message):
            message
        }
    }
}

private enum AuthValidationError: LocalizedError {
    case invalidIdentifier
    case emptyPassword
    case weakPassword
    case secureStorageFailed
    case authenticationRequired

    var errorDescription: String? {
        switch self {
        case .invalidIdentifier:
            "请输入有效的手机号或邮箱"
        case .emptyPassword:
            "请输入密码"
        case .weakPassword:
            "密码至少 8 位，且必须同时包含字母和数字"
        case .secureStorageFailed:
            "无法安全保存登录状态"
        case .authenticationRequired:
            "请先完成注册或登录"
        }
    }
}
