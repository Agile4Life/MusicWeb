import SwiftUI

struct NewReleasesView: View {
    @State private var albums: [Album] = []
    @State private var failed = false
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
        .overlay {
            if albums.isEmpty {
                if failed {
                    ContentUnavailableView("Không tải được", systemImage: "wifi.exclamationmark", description: Text("Kéo xuống để thử lại."))
                } else { ProgressView() }
            }
        }
        .refreshable { await load() }
        .task { if albums.isEmpty { await load() } }
    }

    private func load() async {
        do { albums = try await API.newReleases(); failed = false } catch { failed = !isCancellation(error) }
    }
}
