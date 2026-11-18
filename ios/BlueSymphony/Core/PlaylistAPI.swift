import Foundation

/// Playlist routes: app/api/playlists/**. Every call goes through `SessionStore.guarded` at the call site.
enum PlaylistAPI {
    private struct Many: Decodable { let playlists: Lossy<Playlist>? }
    private struct One: Decodable { let playlist: Playlist? }
    private struct Detail: Decodable { let playlist: Playlist?; let tracks: Lossy<Track>? }
    private struct Fields: Encodable { var name: String?; var description: String?; var isPublic: Bool? }
    struct AddReply: Decodable { var success: Bool?; var message: String? }

    static func list() async throws -> [Playlist] {
        let r: Many = try await API.get("api/playlists")
        return r.playlists?.items ?? []
    }

    static func detail(_ id: String) async throws -> (Playlist?, [Track]) {
        let r: Detail = try await API.get("api/playlists/\(id)")
        return (r.playlist, r.tracks?.items ?? [])
    }

    static func create(name: String, description: String, isPublic: Bool) async throws -> Playlist {
        let r: One = try await API.post("api/playlists", body: Fields(name: name, description: description.isEmpty ? nil : description, isPublic: isPublic))
        guard let p = r.playlist else { throw APIError.server("Không tạo được playlist.") }
        return p
    }

    static func update(_ id: String, name: String, description: String, isPublic: Bool) async throws -> Playlist {
        let data = try await API.send("PATCH", "api/playlists/\(id)", body: Fields(name: name, description: description, isPublic: isPublic))
        guard let p = try JSONDecoder().decode(One.self, from: data).playlist else { throw APIError.server("Không cập nhật được playlist.") }
        return p
    }

    static func delete(_ id: String) async throws {
        try await API.send("DELETE", "api/playlists/\(id)")
    }

    /// Returns the server's message ("Đã thêm…" / "…đã có trong playlist!").
    static func add(_ track: Track, to id: String) async throws -> String {
        struct Body: Encodable { let track: Track }
        let r: AddReply = try await API.post("api/playlists/\(id)/tracks", body: Body(track: track))
        return r.message ?? "Đã thêm bài hát vào playlist!"
    }

    static func remove(trackID: String, from id: String) async throws {
        try await API.send("DELETE", "api/playlists/\(id)/tracks", query: ["trackId": trackID])
    }
}
