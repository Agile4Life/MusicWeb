import SwiftUI

private struct Shelf: Sendable { let tag: String; let title: String; let tracks: [Track] }

struct HomeView: View {
    @Environment(Player.self) private var player
    @State private var nct: [Track] = []
    @State private var nctTitle = "Top 50 NhacCuaTui"
    @State private var trending: [Track] = []
    @State private var albums: [Album] = []
    @State private var failed = false
    @State private var loaded = false
    @State private var recent: [Track] = []
    @State private var favorites: [Track] = []
    @State private var soundcloud: [Shelf] = []
    @Environment(SessionStore.self) private var session
    // NhacCuaTui is the main catalog; SoundCloud fills Vietnamese genre shelves underneath.
    private static let tags = [("v-pop", "V-Pop trên SoundCloud"), ("rap viet", "Rap Việt"),
                               ("lofi viet", "Lofi Việt"), ("remix viet", "Remix Việt")]

    /// Hero: NCT #1, else the first SoundCloud pick, else global trending.
    private var heroQueue: [Track] { !nct.isEmpty ? nct : soundcloud.first?.tracks ?? trending }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if let hero = heroQueue.first {
                    Button { player.play(heroQueue, startAt: 0) } label: {
                        HeroCard(track: hero, badge: nct.isEmpty ? "ĐANG THỊNH HÀNH" : "#1 NHACCUATUI")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Phát \(hero.title) của \(hero.artistName)")
                    .padding(.horizontal)
                }

                TrackGrid(title: nctTitle, tracks: nct)

                if session.isSignedIn {
                    TrackShelf(title: "Nghe gần đây", tracks: recent)
                    TrackShelf(title: "Yêu thích", tracks: favorites)
                }

                ForEach(soundcloud, id: \.tag) { TrackShelf(title: $0.title, tracks: $0.tracks) }

                TrackGrid(title: "Thịnh hành quốc tế", tracks: trending)

                if !albums.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Mới phát hành")
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: 14) {
                                ForEach(albums.prefix(20)) { album in
                                    NavigationLink(value: album) { AlbumTile(album: album).frame(width: 160) }
                                        .buttonStyle(.plain)
                                }
                            }
                            .scrollTargetLayout()
                            .padding(.horizontal)
                        }
                        .scrollTargetBehavior(.viewAligned)
                    }
                }

                if failed && nct.isEmpty && soundcloud.isEmpty && trending.isEmpty {
                    ContentUnavailableView("Không tải được", systemImage: "wifi.exclamationmark",
                                           description: Text("Kéo xuống để thử lại."))
                }
            }
            .padding(.vertical)
        }
        .navigationTitle("Trang chủ")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountButton() } }
        .navigationDestination(for: Album.self) { AlbumView(album: $0) }
        .refreshable { await load(); await loadPrivate() }
        .task { if !loaded { await load() } }
        .task(id: session.isSignedIn) { await loadPrivate() }
        .overlay { if !loaded { ProgressView() } }
    }

    private func load() async {
        async let chart = try? NCT.chart()
        async let t = try? API.trending()
        async let a = try? API.newReleases()
        async let sc: Void = loadSoundCloud()
        let (c, tr, al, _) = await (chart, t, a, sc)
        if let c { nct = c.tracks; nctTitle = c.title }
        trending = tr ?? trending
        albums = al ?? albums
        failed = c == nil && tr == nil && al == nil
        loaded = true
    }

    private func loadSoundCloud() async {
        var shelves: [Shelf] = []
        await withTaskGroup(of: Shelf?.self) { group in
            for (tag, title) in Self.tags {
                group.addTask { (try? await API.soundCloudExplore(tag: tag)).map { Shelf(tag: tag, title: title, tracks: $0) } }
            }
            for await shelf in group { if let shelf, !shelf.tracks.isEmpty { shelves.append(shelf) } }
        }
        let order = Self.tags.map(\.0)
        soundcloud = shelves.sorted { order.firstIndex(of: $0.tag)! < order.firstIndex(of: $1.tag)! }
    }

    /// "Nghe gần đây" (user/init-data) and "Yêu thích" shelves; only when signed in.
    private func loadPrivate() async {
        guard session.isSignedIn else { recent = []; favorites = []; return }
        struct Init: Decodable { struct H: Decodable { let items: Lossy<HistoryItem>? }; let history: H? }
        struct Fav: Decodable { let tracks: Lossy<Track>? }
        if let i: Init = try? await session.guarded({ try await API.get("api/user/init-data", query: ["history_limit": "40"]) }) {
            var seen = Set<String>()
            recent = (i.history?.items?.items ?? []).compactMap(\.track).filter { seen.insert($0.id).inserted }.prefix(15).map { $0 }
            session.learn(recent)
        }
        if let f: Fav = try? await session.guarded({ try await API.get("api/favorites/list", query: ["limit": "15"]) }) {
            favorites = f.tracks?.items ?? []
        }
    }
}

struct HeroCard: View {
    let track: Track
    var badge = "ĐANG THỊNH HÀNH"

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.clear
                .overlay { AsyncImage(url: track.coverURL) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.2) } }
                .overlay { LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom) }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(badge).font(.caption.bold()).foregroundStyle(.white.opacity(0.8))
                Text(track.title).font(.title.bold()).foregroundStyle(.white).lineLimit(2)
                Text(track.artistName).font(.headline).foregroundStyle(.white.opacity(0.85))
            }
            .padding(20)
        }
        .frame(height: 300)
    }
}


/// Apple Music-style 4-row horizontal grid of tracks; hidden when empty (e.g. NCT unreachable).
struct TrackGrid: View {
    @Environment(Player.self) private var player
    let title: String
    let tracks: [Track]

    var body: some View {
        if !tracks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: title)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHGrid(rows: Array(repeating: GridItem(.fixed(56), spacing: 8), count: 4), spacing: 16) {
                        ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                            Button { player.play(tracks, startAt: i) } label: {
                                TrackRow(track: track).frame(width: 300)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal)
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
    }
}
