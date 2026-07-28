import Foundation

enum SharedVideoURLParser {
    private static let supportedHosts = [
        "bilibili.com",
        "b23.tv",
        "douyin.com",
        "iesdouyin.com",
        "xiaohongshu.com",
        "xhslink.com",
    ]

    static func extract(from rawValue: String) -> URL? {
        guard let detector = try? NSDataDetector(
            types: NSTextCheckingResult.CheckingType.link.rawValue
        ) else {
            return nil
        }
        let range = NSRange(rawValue.startIndex..., in: rawValue)
        return detector
            .matches(in: rawValue, options: [], range: range)
            .compactMap(\.url)
            .first(where: isSupported)
    }

    private static func isSupported(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme) else {
            return false
        }
        let host = url.host()?.lowercased() ?? ""
        return supportedHosts.contains {
            host == $0 || host.hasSuffix(".\($0)")
        }
    }
}
