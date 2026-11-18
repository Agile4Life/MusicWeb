import SwiftUI

struct FavoritesView: View {
    @Environment(Player.self) private var player
    @Environment(SessionStore.self) private var session
    @State private var tracks: [Track] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        List {
            if !tracks.isEmpty {
                PlayShuffleBar(tracks: tracks).listRowSeparator(.hidden)
            }
            ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                Button { player.play(tracks, startAt: i) } label: { TrackRow(track: track) }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("Bỏ thích", systemImage: "heart.slash", role: .destructive) { Task { await unfavorite(track) } }
                    }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Bài hát yêu thích")
        .overlay {
            if !loaded { ProgressView() }
            else if tracks.isEmpty {
                ContentUnavailableView("Chưa có bài hát yêu thích", systemImage: "heart",
                                       description: Text("Nhấn vào trái tim ở trình phát để thêm bài hát."))
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    private func load() async {
        struct Reply: Decodable { let tracks: Lossy<Track>? }
        do {
            let r: Reply = try await session.guarded { try await API.get("api/favorites/list", query: ["limit": "200"]) }
            tracks = r.tracks?.items ?? []
            session.learn(tracks)
        } catch { if !isCancellation(error) { self.error = message(for: error) } }
        loaded = true
    }

    private func unfavorite(_ track: Track) async {
        do {
            try await session.setFavorite(track, false)
            tracks.removeAll { $0.id == track.id }
        } catch { self.error = message(for: error) }
    }
}
