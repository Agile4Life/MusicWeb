import SwiftUI

struct AlbumView: View {
    @Environment(Player.self) private var player
    let album: Album
    @State private var tracks: [Track] = []
    @State private var loading = true

    var body: some View {
        List {
            VStack(spacing: 12) {
                Artwork(url: album.coverURL, cornerRadius: 12)
                    .frame(width: 260)
                    .shadow(radius: 16, y: 8)
                Text(album.name).font(.title2.bold()).multilineTextAlignment(.center)
                Text(album.artist ?? "").font(.title3).foregroundStyle(.tint)
                if let meta = subtitle { Text(meta).font(.caption).foregroundStyle(.secondary) }
                HStack(spacing: 12) {
                    Button { player.play(tracks, startAt: 0) } label: {
                        Label("Phát", systemImage: "play.fill").frame(maxWidth: .infinity)
                    }
                    Button { player.play(tracks.shuffled(), startAt: 0) } label: {
                        Label("Trộn bài", systemImage: "shuffle").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(tracks.isEmpty)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)
            .padding(.bottom, 8)

            ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                Button { player.play(tracks, startAt: i) } label: {
                    HStack(spacing: 14) {
                        Text("\(i + 1)").foregroundStyle(.secondary).frame(width: 22)
                        TrackRow(track: track, showArtwork: false)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if loading && tracks.isEmpty { ProgressView() } }
        .task {
            tracks = (try? await API.album(album.id).tracks) ?? []
            loading = false
        }
    }

    private var subtitle: String? {
        let parts = [album.album_type?.uppercased(), album.release_date.flatMap { $0.isEmpty ? nil : String($0.prefix(4)) }]
            .compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
