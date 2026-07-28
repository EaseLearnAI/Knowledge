import Foundation

protocol AuthTokenProviding: Sendable {
    func accessToken() async throws -> String
}

protocol AuthRepository: AuthTokenProviding {
    func restoreSession() async -> AuthSnapshot
    func register(
        identifier: String,
        password: String,
        nickname: String?
    ) async throws -> AuthSnapshot
    func login(identifier: String, password: String) async throws -> AuthSnapshot
    func logout() async
    func changePassword(
        currentPassword: String,
        newPassword: String
    ) async throws -> AuthSnapshot
    func deleteAccount(currentPassword: String) async throws
    func resetSession() async
    func requireAuthentication() async throws
}

extension AuthStore: AuthRepository {}
