import Foundation

/// Public Supabase client values, injected at build time from the gitignored Config/Secrets.xcconfig.
enum Config {
    static let supabaseURL: URL? = value("SupabaseURL").flatMap(URL.init(string:))
    static let supabaseKey: String? = value("SupabaseAnonKey")
    static var isConfigured: Bool { supabaseURL != nil && supabaseKey != nil }

    private static func value(_ key: String) -> String? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: key) as? String, !s.isEmpty, !s.hasPrefix("$(") else { return nil }
        return s
    }
}
