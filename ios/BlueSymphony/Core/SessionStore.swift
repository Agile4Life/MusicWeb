import Foundation
import Observation

/// Who is signed in, plus the favorites cache. The real session is the NextAuth cookie; this mirrors it for the UI.
@MainActor
@Observable
final class SessionStore {
    private(set) var email: String?
    /// Database ids (UUIDs) of the user's favorite tracks.
    private(set) var favoriteIDs: Set<String> = []
    /// Auth user id from the NextAuth session (a Supabase UUID when the token carries one).
    private(set) var sessionUserID: String?
    var isSignedIn: Bool { email != nil }
    var displayName: String { email?.split(separator: "@").first.map(String.init) ?? "" }

    /// External track id ("spotify-…", "sc-…") -> database id, learned from lists the server returned
    /// or from tracks this app persisted. shortcut: never pruned, fine for a personal library size.
    @ObservationIgnored private var knownDBIDs: [String: String] =
        UserDefaults.standard.dictionary(forKey: "knownDBIDs") as? [String: String] ?? [:]

    /// Restores the session on launch (cookies persist in HTTPCookieStorage).
    func refresh() async {
        (email, sessionUserID) = await AuthService.sessionInfo()
        if isSignedIn { await refreshFavorites() } else { favoriteIDs = [] }
    }

    func signIn(account: String, password: String) async throws {
        try await run { try await AuthService.signIn(account: account, password: password) }
    }

    func register(username: String, password: String, realEmail: String) async throws {
        try await run { try await AuthService.register(username: username, password: password, realEmail: realEmail) }
    }

    func signOut() async {
        await AuthService.signOut()
        email = nil
        sessionUserID = nil
        favoriteIDs = []
    }

    /// Call when a private route answers 401 (cookie expired).
    func handleUnauthorized() { email = nil; sessionUserID = nil; favoriteIDs = [] }

    /// The server stamps rows with `getValidUserId({ email })` (lib/accessControl.ts): a UUID-shaped hash of the
    /// email. Reproduced here so the app can tell its own playlists from other people's public ones.
    var serverUserID: String? {
        guard let email = email?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
        var hex = email.utf16.map { String($0, radix: 16) }.joined()
        while hex.count < 30 { hex += "0123456789abcdef" }
        let h = Array(hex.prefix(30))
        func s(_ a: Int, _ b: Int) -> String { String(h[a..<b]) }
        return "\(s(0, 8))-\(s(8, 12))-4\(s(12, 15))-a\(s(15, 18))-\(s(18, 30))"
    }

    /// shortcut: ownership is inferred from user_id; a playlist stamped with an older id scheme reads as someone else's.
    func owns(_ playlist: Playlist) -> Bool {
        guard let id = playlist.user_id?.lowercased() else { return true }
        return id == serverUserID || id == sessionUserID?.lowercased()
    }

    /// Runs a private request; a 401 signs the user out locally before rethrowing.
    func guarded<T>(_ work: () async throws -> T) async throws -> T {
        do { return try await work() } catch APIError.unauthorized { handleUnauthorized(); throw APIError.unauthorized }
    }

    // MARK: - Favorites

    func refreshFavorites() async {
        struct Status: Decodable { let trackIds: [String]? }
        struct List: Decodable { let tracks: Lossy<Track>? }
        if let s: Status = try? await API.get("api/favorites/status") { favoriteIDs = Set(s.trackIds ?? []) }
        if let l: List = try? await API.get("api/favorites/list", query: ["limit": "200"]) { learn(l.tracks?.items ?? []) }
    }

    func isFavorite(_ track: Track) -> Bool { dbID(for: track).map(favoriteIDs.contains) ?? false }

    func dbID(for track: Track) -> String? { track.isPersisted ? track.id : knownDBIDs[track.id] }

    /// Remembers which database row an external id maps to (call with tracks that came from the `tracks` table).
    func learn(_ tracks: [Track]) {
        var changed = false
        for t in tracks where t.isPersisted {
            for key in Self.externalKeys(t) where knownDBIDs[key] != t.id { knownDBIDs[key] = t.id; changed = true }
        }
        if changed { UserDefaults.standard.set(knownDBIDs, forKey: "knownDBIDs") }
    }

    func setFavorite(_ track: Track, _ value: Bool) async throws {
        let id: String
        if value { id = try await persistedID(for: track) } else if let known = dbID(for: track) { id = known } else { return }
        struct Body: Encodable { let trackId: String; let nextValue: Bool }
        let before = favoriteIDs
        if value { favoriteIDs.insert(id) } else { favoriteIDs.remove(id) }
        do {
            _ = try await guarded { try await API.send("POST", "api/favorites/toggle", body: Body(trackId: id, nextValue: value)) }
        } catch {
            favoriteIDs = before
            throw error
        }
    }

    func toggleFavorite(_ track: Track) async throws { try await setFavorite(track, !isFavorite(track)) }

    /// Favorites need a `tracks` row id. Search results (Spotify/SoundCloud) are not rows yet, so the first
    /// favorite creates one through the server (`/api/tracks/create`) — never straight against Supabase.
    private func persistedID(for track: Track) async throws -> String {
        if let id = dbID(for: track) { return id }
        // A track that was played was already deduped into `tracks` by history/record; reuse that row if we can see it.
        struct Hist: Decodable { let items: Lossy<HistoryItem>? }
        if let h: Hist = try? await API.get("api/history/list", query: ["limit": "60"]) {
            learn((h.items?.items ?? []).compactMap(\.track))
            if let id = dbID(for: track) { return id }
        }
        // Last resort: no row seen yet, ask the server to create one. shortcut: tracks/create does not dedupe
        // against rows we could not see, so a duplicate `tracks` row is possible.
        struct Body: Encodable {
            let title: String; let file_path: String
            let artist, album, cover_url, source, youtube_id, spotify_id, nhaccuatui_id: String?
            let duration: Double?
        }
        struct Reply: Decodable { struct T: Decodable { let id: String }; let track: T? }
        let t = track
        let body = Body(title: t.title, file_path: Self.filePath(t), artist: t.artist, album: t.album, cover_url: t.cover_url,
                        source: t.source, youtube_id: t.youtube_id, spotify_id: t.spotify_id, nhaccuatui_id: t.nhaccuatui_id,
                        duration: t.duration)
        let reply: Reply = try await guarded {
            try JSONDecoder().decode(Reply.self, from: await API.send("POST", "api/tracks/create", body: body))
        }
        guard let id = reply.track?.id else { throw APIError.server("Không lưu được bài hát.") }
        knownDBIDs[track.id] = id
        UserDefaults.standard.set(knownDBIDs, forKey: "knownDBIDs")
        return id
    }

    private static func filePath(_ t: Track) -> String {
        if let p = t.file_path, !p.isEmpty { return p }
        if let id = t.spotify_id { return "spotify:\(id)" }
        if let id = t.youtube_id { return "https://www.youtube.com/watch?v=\(id)" }
        if let id = t.nhaccuatui_id { return "nct:\(id)" }
        if let id = t.soundcloud_id { return "soundcloud:\(id)" }
        return t.soundcloud_permalink_url ?? "ext:\(t.id)"
    }

    private static func externalKeys(_ t: Track) -> [String] {
        var keys: [String] = []
        if let id = t.spotify_id { keys.append("spotify-\(id)") }
        if let id = t.youtube_id { keys.append("yt-\(id)") }
        if let id = t.nhaccuatui_id { keys.append("nct-\(id)") }
        if let p = t.file_path, p.hasPrefix("soundcloud:") { keys.append("sc-\(p.dropFirst("soundcloud:".count))") }
        return keys
    }

    private func run(_ work: () async throws -> Void) async throws {
        do {
            try await work()
        } catch let e as AuthError {
            throw e
        } catch let e as APIError {
            throw AuthError(e.localizedDescription)
        } catch {
            throw AuthError("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.")
        }
        (email, sessionUserID) = await AuthService.sessionInfo()
        await refreshFavorites()
    }
}
