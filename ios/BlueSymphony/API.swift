import Foundation

/// Apex host 308-redirects to www; call www directly.
let apiBase = URL(string: "https://www.bluesymphony.site")!

struct Track: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    var artist: String?
    var album: String?
    var duration: Double?
    var cover_url: String?
    var youtube_id: String?

    var artistName: String { artist?.isEmpty == false ? artist! : "Nghệ sĩ chưa xác định" }
    var coverURL: URL? { cover_url.flatMap(URL.init(string:)) }
}

struct Album: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    var artist: String?
    var cover_url: String?
    var release_date: String?
    var album_type: String?
    var tracks: [Track]?

    var coverURL: URL? { cover_url.flatMap(URL.init(string:)) }
}

private struct TracksResponse: Decodable { let tracks: [Track]? }

private struct ResolveResponse: Decodable {
    var miss: Bool?
    var source: String?
    var resolvedId: String?
    var streamUrl: String?
}

enum API {
    static func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var comps = URLComponents(url: apiBase.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        let (data, response) = try await URLSession.shared.data(for: URLRequest(url: comps.url!, timeoutInterval: 15))
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func trending() async throws -> [Track] {
        let r: TracksResponse = try await get("api/trending")
        return r.tracks ?? []
    }

    static func newReleases() async throws -> [Album] {
        try await get("api/albums/new-releases")
    }

    static func album(_ id: String) async throws -> Album {
        try await get("api/albums/\(id)")
    }

    static func search(_ q: String) async throws -> [Track] {
        let r: TracksResponse = try await get("api/spotify/search", query: ["q": q])
        return r.tracks ?? []
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
