import Foundation

extension KeyedDecodingContainer {
    /// Reads a string, tolerating numbers; a bad or missing field becomes nil instead of failing the whole screen.
    func lossyString(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d == d.rounded() ? String(Int(d)) : String(d) }
        return nil
    }

    func lossyDouble(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }
}

struct Track: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var artist: String?
    var album: String?
    var duration: Double?
    var cover_url: String?
    var youtube_id: String?
    var spotify_id: String?
    var nhaccuatui_id: String?
    var soundcloud_id: String?
    var soundcloud_permalink_url: String?
    var file_path: String?
    var source: String?
    var disc_number: Double?
    var track_number: Double?

    var artistName: String { artist?.isEmpty == false ? artist! : "Nghệ sĩ chưa xác định" }
    var coverURL: URL? { cover_url.flatMap(URL.init(string:)) }
    /// First credited artist ("A, B & C" -> "A"), for artist pages.
    var primaryArtist: String? {
        artist?.split(whereSeparator: { ",&".contains($0) }).first.map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : $0 }
    }
    /// Rows from the `tracks` table have UUID ids; Spotify/SoundCloud/YouTube search results carry synthetic ones.
    var isPersisted: Bool { UUID(uuidString: id) != nil }

    init(id: String, title: String, artist: String? = nil, album: String? = nil, duration: Double? = nil, cover_url: String? = nil) {
        self.id = id; self.title = title; self.artist = artist; self.album = album
        self.duration = duration; self.cover_url = cover_url
    }

    enum CodingKeys: String, CodingKey {
        case id, title, artist, album, duration, cover_url, youtube_id, spotify_id, nhaccuatui_id
        case soundcloud_id, soundcloud_permalink_url, file_path, source, disc_number, track_number
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lossyString(.id), !id.isEmpty else {
            throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: decoder.codingPath, debugDescription: "id"))
        }
        self.id = id
        title = c.lossyString(.title) ?? "Không có tên"
        artist = c.lossyString(.artist)
        album = c.lossyString(.album)
        duration = c.lossyDouble(.duration)
        cover_url = c.lossyString(.cover_url)
        youtube_id = c.lossyString(.youtube_id)
        spotify_id = c.lossyString(.spotify_id)
        nhaccuatui_id = c.lossyString(.nhaccuatui_id)
        soundcloud_id = c.lossyString(.soundcloud_id)
        soundcloud_permalink_url = c.lossyString(.soundcloud_permalink_url)
        file_path = c.lossyString(.file_path)
        source = c.lossyString(.source)
        disc_number = c.lossyDouble(.disc_number)
        track_number = c.lossyDouble(.track_number)
    }
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

struct Playlist: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String?
    var cover_url: String?
    var is_public: Bool?
    var user_id: String?

    var coverURL: URL? { cover_url.flatMap(URL.init(string:)) }

    enum CodingKeys: String, CodingKey { case id, name, description, cover_url, is_public, user_id }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lossyString(.id) else {
            throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: decoder.codingPath, debugDescription: "id"))
        }
        self.id = id
        name = c.lossyString(.name) ?? "Playlist"
        description = c.lossyString(.description)
        cover_url = c.lossyString(.cover_url)
        is_public = try? c.decodeIfPresent(Bool.self, forKey: .is_public)
        user_id = c.lossyString(.user_id)
    }
}

/// One row of listening history: the history row id is what delete needs, `track` is null when the row is orphaned.
struct HistoryItem: Decodable, Identifiable, Hashable {
    let id: String
    var played_at: String?
    var track: Track?

    enum CodingKeys: String, CodingKey { case id, played_at, track }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.lossyString(.id) else {
            throw DecodingError.keyNotFound(CodingKeys.id, .init(codingPath: decoder.codingPath, debugDescription: "id"))
        }
        self.id = id
        played_at = c.lossyString(.played_at)
        track = try? c.decodeIfPresent(Track.self, forKey: .track)
    }

    var playedDate: Date? {
        guard let s = played_at else { return nil }
        return ISO8601DateFormatter.withFraction.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}

extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// Decodes an array, dropping elements that fail instead of failing the whole response.
struct Lossy<T: Decodable>: Decodable {
    let items: [T]
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(AnyDecodable.self) }
        }
        items = out
    }
}

struct AnyDecodable: Decodable { init(from decoder: Decoder) throws {} }

/// `history/top` row: a track with how many times it was played.
struct TopItem: Decodable, Identifiable, Hashable {
    let track: Track
    var playCount: Int
    var id: String { track.id }

    enum CodingKeys: String, CodingKey { case track, playCount }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        track = try c.decode(Track.self, forKey: .track)
        playCount = Int(c.lossyDouble(.playCount) ?? 1)
    }
}

struct ArtistInfo: Decodable, Hashable {
    var name: String
    var picture_xl: String?
    var picture_big: String?
    var nb_fan: Double?

    enum CodingKeys: String, CodingKey { case name, picture_xl, picture_big, nb_fan }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lossyString(.name) ?? ""
        picture_xl = c.lossyString(.picture_xl)
        picture_big = c.lossyString(.picture_big)
        nb_fan = c.lossyDouble(.nb_fan)
    }

    var pictureURL: URL? { (picture_xl ?? picture_big).flatMap(URL.init(string:)) }
}

/// Navigation value that opens an artist page.
struct ArtistRoute: Hashable, Identifiable {
    let name: String
    var id: String { name }
}
