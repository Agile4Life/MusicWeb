import Foundation

/// Apex host 308-redirects to www; call www directly.
let apiBase = URL(string: "https://www.bluesymphony.site")!

private struct TracksResponse: Decodable { let tracks: Lossy<Track>? }

private struct ResolveResponse: Decodable {
    var miss: Bool?
    var source: String?
    var resolvedId: String?
    var streamUrl: String?
}

enum APIError: LocalizedError {
    case unauthorized
    case server(String?)

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Vui lòng đăng nhập."
        case .server(let m): m ?? "Máy chủ gặp lỗi, vui lòng thử lại."
        }
    }
}

enum API {
    /// Sends a request to the site (cookies from URLSession.shared carry the NextAuth session).
    /// 401 -> `APIError.unauthorized`; other non-2xx -> `APIError.server` with the route's `error`/`message` text.
    @discardableResult
    static func send(_ method: String, _ path: String, query: [String: String] = [:], body: (any Encodable)? = nil) async throws -> Data {
        var comps = URLComponents(url: apiBase.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: comps.url!, timeoutInterval: 15)
        req.httpMethod = method
        if let body {
            req.httpBody = try JSONEncoder().encode(body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if !(200..<300).contains(http.statusCode) {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? (obj?["message"] as? String))
        }
        return data
    }

    static func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try JSONDecoder().decode(T.self, from: await send("GET", path, query: query))
    }

    static func post<T: Decodable>(_ path: String, body: any Encodable) async throws -> T {
        try JSONDecoder().decode(T.self, from: await send("POST", path, body: body))
    }

    static func trending() async throws -> [Track] {
        let r: TracksResponse = try await get("api/trending")
        return r.tracks?.items ?? []
    }

    static func newReleases() async throws -> [Album] {
        try await get("api/albums/new-releases")
    }

    static func album(_ id: String) async throws -> Album {
        try await get("api/albums/\(id)")
    }

    static func search(_ q: String) async throws -> [Track] {
        let r: TracksResponse = try await get("api/spotify/search", query: ["q": q])
        return r.tracks?.items ?? []
    }

    @MainActor private static var resolved: [String: (url: URL?, expires: Date)] = [:]

    /// Turns a track's metadata into a playable audio URL, mirroring the web
    /// clientResolutionService: same params, 5 min cache (1 min for misses), invalidate=1 on playback error.
    @MainActor
    static func streamURL(for track: Track, invalidate: Bool = false) async throws -> URL? {
        if let yt = track.youtube_id, !yt.isEmpty, !invalidate { return youtubeStream(yt) }
        if !invalidate, let hit = resolved[track.id], hit.expires > .now { return hit.url }

        var q = ["title": track.title]
        if let a = track.artist, !a.isEmpty { q["artist"] = a }
        if let d = track.duration, d > 0 { q["duration"] = String(Int(d.rounded())) }
        if let al = track.album, !al.isEmpty { q["album"] = al }
        if invalidate { q["invalidate"] = "1" }
        let r: ResolveResponse = try await get("api/resolve-stream", query: q)
        let url = url(from: r)
        resolved[track.id] = (url, .now.addingTimeInterval(url == nil ? 60 : 300))
        return url
    }

    /// Fire-and-forget: resolve and touch the first bytes so the stream worker caches the file
    /// before the user gets there (its first hit on a cold cache often 502s).
    @MainActor
    static func prewarm(_ track: Track) {
        Task {
            guard let url = try? await streamURL(for: track) else { return }
            var req = URLRequest(url: url, timeoutInterval: 20)
            req.setValue("bytes=0-1", forHTTPHeaderField: "Range")
            _ = try? await URLSession.shared.data(for: req)
        }
    }

    private static func url(from r: ResolveResponse) -> URL? {
        if r.miss == true { return nil }
        if let s = r.streamUrl, !s.isEmpty {
            return s.hasPrefix("http") ? URL(string: s) : URL(string: s, relativeTo: apiBase)?.absoluteURL
        }
        if r.source == "youtube", let id = r.resolvedId { return youtubeStream(id) }
        return nil
    }

    private static func youtubeStream(_ id: String) -> URL {
        // The site 307-redirects to its stream worker; AVPlayer follows it.
        var c = URLComponents(url: apiBase.appendingPathComponent("api/yt-stream"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "id", value: id)]
        return c.url!
    }
}
