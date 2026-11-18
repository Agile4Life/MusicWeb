import Foundation

/// NhacCuaTui's current web API (graph.nhaccuatui.com), called straight from the phone.
/// The backend's NCT routes depend on music-api.vanhuy2004h.io.vn, which is down, so the app skips them.
/// shortcut: unofficial API (same calls nhaccuatui.com makes, as in the `nhaccuatui-client` npm package);
/// if NCT changes it, move this behind a backend route so web and app share one fix.
enum NCT {
    private static let base = URL(string: "https://graph.nhaccuatui.com/api")!
    /// Weekly "Top 50 Bài Hát Thịnh Hành"; the year segment rolls over, so fall back to last year's key.
    static var chartKeys: [String] {
        let year = Calendar.current.component(.year, from: .now)
        return ["1-5-d7-\(year)", "1-5-d7-\(year - 1)", "1-5-d360-\(year - 1)"]
    }

    struct Stream: Decodable { let stream: String?; let type: String?; let onlyVIP: Bool?; let status: Int? }

    struct Song: Decodable {
        let key: String
        let name: String?
        let artistName: String?
        let image: String?
        let duration: Double?
        let streamURL: [Stream]?

        /// Best free quality: 320 kbps, else 128 kbps. VIP-only (lossless) entries are skipped.
        var bestStream: URL? {
            let free = (streamURL ?? []).filter { $0.onlyVIP != true && $0.status == 1 && $0.stream?.isEmpty == false }
            let pick = free.first { $0.type == "320" } ?? free.first { $0.type == "128" } ?? free.first
            return pick?.stream.flatMap(URL.init(string:))
        }

        var track: Track {
            var t = Track(id: "nct-\(key)", title: name ?? "Không có tên", artist: artistName, duration: duration, cover_url: image)
            t.nhaccuatui_id = key
            t.source = "nhaccuatui"
            return t
        }
    }

    private struct Envelope<T: Decodable>: Decodable { let code: Int?; let data: T? }
    private struct Chart: Decodable { let title: String?; let name: String?; let items: [Song]? }
    private struct SearchAll: Decodable { let songs: [Song]? }

    private static func get<T: Decodable>(_ path: String, _ query: [String: String] = [:]) async throws -> T {
        var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        let ts = String(Int(Date().timeIntervalSince1970 * 1000))
        c.queryItems = (query.merging(["timestamp": ts]) { a, _ in a }).map { URLQueryItem(name: $0.key, value: $0.value) }
        var req = URLRequest(url: c.url!, timeoutInterval: 12)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("https://www.nhaccuatui.com/", forHTTPHeaderField: "Referer")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let env = try JSONDecoder().decode(Envelope<T>.self, from: data)
        guard env.code == 0, let payload = env.data else { throw URLError(.cannotParseResponse) }
        return payload
    }

    /// Current Top 50 chart: (title, tracks). Stream URLs that come with the chart are cached for playback.
    @MainActor
    static func chart() async throws -> (title: String, tracks: [Track]) {
        for key in chartKeys {
            guard let chart: Chart = try? await get("v1/playlist/charts/\(key)", ["key": key]),
                  let items = chart.items, !items.isEmpty else { continue }
            items.forEach(remember)
            return (chart.title ?? chart.name ?? "Top 50 NhacCuaTui", items.map(\.track))
        }
        throw URLError(.resourceUnavailable)
    }

    @MainActor
    static func search(_ keyword: String) async throws -> [Track] {
        let r: SearchAll = try await get("v3/search/all", ["keyword": keyword, "correct": "false"])
        let songs = r.songs ?? []
        songs.forEach(remember)
        return songs.map(\.track)
    }

    /// Playable mp3 for a song key. Uses the URL that came with a chart/search when still fresh,
    /// otherwise asks song/detail (signed links expire; `e=` is the unix expiry).
    @MainActor
    static func streamURL(key: String, fresh: Bool = false) async throws -> URL? {
        if !fresh, let hit = streams[key], hit.expires > .now.addingTimeInterval(120) { return hit.url }
        let song: Song = try await get("v1/song/detail/\(key)", ["key": key, "isDailyMix": "false"])
        remember(song)
        return song.bestStream
    }

    /// Finds the same song on NCT for a metadata-only track (Spotify trending, albums): same title,
    /// overlapping artist, duration within 10 s when both are known. Returns its NCT key.
    @MainActor
    static func match(_ track: Track) async -> String? {
        let title = fold(track.title)
        guard !title.isEmpty else { return nil }
        let artist = fold(track.primaryArtist ?? track.artist ?? "")
        guard let found = try? await get("v3/search/all", ["keyword": "\(track.title) \(track.primaryArtist ?? "")", "correct": "false"]) as SearchAll
        else { return nil }
        let hit = (found.songs ?? []).first { s in
            let t = fold(s.name ?? ""), a = fold(s.artistName ?? "")
            let titleOK = t == title || t.hasPrefix(title + " ") || title.hasPrefix(t + " ")
            let artistOK = artist.isEmpty || a.contains(artist) || artist.contains(a)
            let durationOK = (track.duration ?? 0) <= 0 || (s.duration ?? 0) <= 0 || abs((track.duration ?? 0) - (s.duration ?? 0)) <= 10
            return titleOK && artistOK && durationOK
        }
        if let hit { remember(hit) }
        return hit?.key
    }

    /// Lowercased, accent-free, punctuation-free text for comparing titles across catalogs.
    static func fold(_ s: String) -> String {
        let base = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "vi"))
            .replacingOccurrences(of: "đ", with: "d")
            .replacingOccurrences(of: #"\(.*?\)|\[.*?\]"#, with: " ", options: .regularExpression)
        return base.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }.joined(separator: " ")
    }

    @MainActor private static var streams: [String: (url: URL, expires: Date)] = [:]

    @MainActor private static func remember(_ song: Song) {
        guard let url = song.bestStream else { return }
        let e = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "e" }?.value
        let expires = e.flatMap(Double.init).map { Date(timeIntervalSince1970: $0) } ?? .now.addingTimeInterval(3600)
        streams[song.key] = (url, expires)
    }
}
