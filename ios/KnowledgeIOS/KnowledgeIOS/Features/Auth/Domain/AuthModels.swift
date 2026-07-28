import Foundation

struct AuthUser: Codable, Sendable {
    let id: String
    let email: String?
    let phone: String?
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
