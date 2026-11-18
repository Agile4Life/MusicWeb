import SwiftUI

struct ArtistView: View {
    @Environment(Player.self) private var player
    let name: String
    @State private var info: ArtistInfo?
    @State private var tracks: [Track] = []
    @State private var loading = true
    @State private var failed = false

    var body: some View {
        List {
            VStack(spacing: 10) {
                AsyncImage(url: info?.pictureURL) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { ZStack { Rectangle().fill(.quaternary); Image(systemName: "person.fill").font(.largeTitle).foregroundStyle(.secondary) } }
                }
                .frame(width: 200, height: 200)
                .clipShape(Circle())
                .shadow(radius: 12, y: 6)
                Text(info?.name.isEmpty == false ? info!.name : name).font(.title.bold()).multilineTextAlignment(.center)
                if let fans = info?.nb_fan, fans > 0 {
                    Text("\(fans.formatted(.number.notation(.compactName))) người nghe").font(.subheadline).foregroundStyle(.secondary)
                }
                PlayShuffleBar(tracks: tracks)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)

            if !tracks.isEmpty {
                Section {
                    ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                        Button { player.play(tracks, startAt: i) } label: { TrackRow(track: track) }.buttonStyle(.plain)
                    }
                } header: { Text("Bài hát hàng đầu").font(.title3.bold()).foregroundStyle(.primary).textCase(nil) }
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .overlay {
            if loading { ProgressView() }
            else if failed && tracks.isEmpty {
                ContentUnavailableView("Không tải được nghệ sĩ", systemImage: "person.crop.circle.badge.exclamationmark", description: Text("Thử lại sau."))
            }
        }
        .refreshable { await load() }
        .task(id: name) { await load() }
    }

    private func load() async {
        struct Reply: Decodable { let artist: ArtistInfo?; let topTracks: Lossy<Track>? }
        do {
            let r: Reply = try await API.get("api/artist", query: ["name": name])
            info = r.artist
            tracks = r.topTracks?.items ?? []
            failed = false
        } catch { failed = !isCancellation(error) }
        loading = false
    }
}
