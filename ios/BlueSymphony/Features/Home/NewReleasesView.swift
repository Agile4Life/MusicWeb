import SwiftUI

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
