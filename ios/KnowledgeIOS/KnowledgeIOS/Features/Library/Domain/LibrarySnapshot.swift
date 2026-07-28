import Foundation

struct AppPreferences: Codable, Sendable {
    var hasCompletedOnboarding = false
}

struct LibrarySnapshot: Codable, Sendable {
    let items: [KnowledgeItem]
    let preferences: AppPreferences
}
