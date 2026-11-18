import Foundation

struct LyricLine: Identifiable, Hashable {
    let id: Int
    let time: Double?
    let text: String
}

struct Lyrics: Equatable {
    var lines: [LyricLine]
    var isSynced: Bool { lines.contains { $0.time != nil } }

    /// Parses LRC (`[mm:ss.xx] text`, several stamps per line allowed). Text without stamps becomes plain lines.
    init(parsing raw: String) {
        let stamp = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/
        var out: [(Double?, String)] = []
        for line in raw.components(separatedBy: .newlines) {
            let matches = line.matches(of: stamp)
            let text = line.replacing(stamp, with: "").trimmingCharacters(in: .whitespaces)
            if matches.isEmpty {
                // Skip LRC metadata tags such as [ar:Artist].
                if line.hasPrefix("["), line.contains(":"), line.hasSuffix("]") { continue }
                out.append((nil, text))
            } else {
                for m in matches {
                    let secs = Double(m.2.replacingOccurrences(of: ":", with: ".")) ?? 0
                    out.append((Double(m.1)! * 60 + secs, text))
                }
            }
        }
        let synced = out.contains { $0.0 != nil }
        if synced { out = out.filter { $0.0 != nil }.sorted { $0.0! < $1.0! } }
        lines = out.enumerated().map { LyricLine(id: $0.offset, time: $0.element.0, text: $0.element.1) }
    }

    /// Index of the line being sung at `t` seconds.
    func activeIndex(at t: Double) -> Int? {
        guard isSynced else { return nil }
        return lines.lastIndex { ($0.time ?? .infinity) <= t + 0.25 }
    }
}

enum LyricsService {
    private struct Custom: Decodable { let found: Bool?; let rawLyrics: String? }
    private struct LRCLib: Decodable { let syncedLyrics: String?; let plainLyrics: String? }

    /// Admin-edited lyrics from the site first, then LRCLIB (lib/lrclib.ts does the same order).
    static func fetch(for track: Track) async -> Lyrics? {
        var q = ["title": track.title]
        if let a = track.artist { q["artist"] = a }
        if let a = track.album { q["album"] = a }
        if let d = track.duration, d > 0 { q["duration"] = String(Int(d.rounded())) }
        if track.isPersisted { q["id"] = track.id }
        if let s = track.spotify_id { q["spotify_id"] = s }
        if let y = track.youtube_id { q["youtube_id"] = y }
        if let c: Custom = try? await API.get("api/lyrics/custom", query: q), c.found == true,
           let raw = c.rawLyrics, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return Lyrics(parsing: raw)
        }
        guard let r = await lrclib(track), let text = [r.syncedLyrics, r.plainLyrics].compactMap({ $0 }).first(where: { !$0.isEmpty }) else { return nil }
        return Lyrics(parsing: text)
    }

    private static func lrclib(_ track: Track) async -> LRCLib? {
        let title = track.title.replacing(/[\(\[].*?[\)\]]/, with: "").trimmingCharacters(in: .whitespaces)
        let artist = (track.artist ?? "").split(whereSeparator: { ",&".contains($0) }).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        func call(_ path: String, _ items: [URLQueryItem]) async -> Data? {
            var c = URLComponents(string: "https://lrclib.net/api/\(path)")!
            c.queryItems = items
            guard let (data, resp) = try? await URLSession.shared.data(for: URLRequest(url: c.url!, timeoutInterval: 10)),
                  (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return data
        }
        var get = [URLQueryItem(name: "track_name", value: title), URLQueryItem(name: "artist_name", value: artist)]
        if let a = track.album, !a.isEmpty { get.append(.init(name: "album_name", value: a)) }
        if let d = track.duration, d > 0 { get.append(.init(name: "duration", value: String(Int(d.rounded())))) }
        if let data = await call("get", get), let r = try? JSONDecoder().decode(LRCLib.self, from: data) { return r }
        // Album/duration mismatches 404 the exact lookup; fall back to the first search hit.
        let search = [URLQueryItem(name: "track_name", value: title), URLQueryItem(name: "artist_name", value: artist)]
        guard let data = await call("search", search), let hits = try? JSONDecoder().decode([LRCLib].self, from: data) else { return nil }
        return hits.first { $0.syncedLyrics?.isEmpty == false } ?? hits.first
    }
}
