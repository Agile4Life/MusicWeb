import SwiftUI

struct HomeView: View {
    @Environment(Player.self) private var player
    @State private var trending: [Track] = []
    @State private var albums: [Album] = []
    @State private var failed = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if let hero = trending.first {
                    Button { player.play(trending, startAt: 0) } label: { HeroCard(track: hero) }
                        .buttonStyle(.plain)
                        .padding(.horizontal)
                }

                if !trending.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Thịnh hành")
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHGrid(rows: Array(repeating: GridItem(.fixed(56), spacing: 8), count: 4), spacing: 16) {
                                ForEach(Array(trending.enumerated()), id: \.element.id) { i, track in
                                    Button { player.play(trending, startAt: i) } label: {
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

                if failed && trending.isEmpty && albums.isEmpty {
                    ContentUnavailableView("Không tải được", systemImage: "wifi.exclamationmark",
                                           description: Text("Kéo xuống để thử lại."))
                }
            }
            .padding(.vertical)
        }
        .navigationTitle("Trang chủ")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountButton() } }
        .navigationDestination(for: Album.self) { AlbumView(album: $0) }
        .refreshable { await load() }
        .task { if trending.isEmpty { await load() } }
        .overlay { if trending.isEmpty && albums.isEmpty && !failed { ProgressView() } }
    }

    private func load() async {
        async let t = try? API.trending()
        async let a = try? API.newReleases()
        let (tr, al) = await (t, a)
        trending = tr ?? trending
        albums = al ?? albums
        failed = tr == nil && al == nil
    }
}

struct HeroCard: View {
    let track: Track

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Color.clear
                .overlay { AsyncImage(url: track.coverURL) { $0.resizable().scaledToFill() } placeholder: { Color.secondary.opacity(0.2) } }
                .overlay { LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom) }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text("ĐANG THỊNH HÀNH").font(.caption.bold()).foregroundStyle(.white.opacity(0.8))
                Text(track.title).font(.title.bold()).foregroundStyle(.white).lineLimit(2)
                Text(track.artistName).font(.headline).foregroundStyle(.white.opacity(0.85))
            }
            .padding(20)
        }
        .frame(height: 300)
    }
}

struct AlbumTile: View {
    let album: Album

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Artwork(url: album.coverURL)
            Text(album.name).font(.subheadline).lineLimit(1)
            Text(album.artist ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

struct NewReleasesView: View {
    @State private var albums: [Album] = []
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(albums) { album in
                    NavigationLink(value: album) { AlbumTile(album: album) }.buttonStyle(.plain)
                }
            }
            .padding()
        }
        .navigationTitle("Mới phát hành")
        .navigationDestination(for: Album.self) { AlbumView(album: $0) }
        .overlay { if albums.isEmpty { ProgressView() } }
        .refreshable { albums = (try? await API.newReleases()) ?? albums }
        .task { if albums.isEmpty { albums = (try? await API.newReleases()) ?? [] } }
    }
}
