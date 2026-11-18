import SwiftUI

enum LibraryRoute: Hashable { case playlists, favorites, history, top }

struct LibraryView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        Group {
            if session.isSignedIn {
                List {
                    row("Playlist", "music.note.list", .playlists)
                    row("Bài hát yêu thích", "heart.fill", .favorites)
                    row("Lịch sử nghe", "clock.fill", .history)
                    row("Top của bạn", "chart.bar.fill", .top)
                }
                .listStyle(.plain)
            } else {
                SignInPrompt(title: "Thư viện")
            }
        }
        .navigationTitle("Thư viện")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { AccountButton() } }
        .navigationDestination(for: LibraryRoute.self) { route in
            switch route {
            case .playlists: PlaylistsView()
            case .favorites: FavoritesView()
            case .history: HistoryView()
            case .top: TopTracksView()
            }
        }
        .navigationDestination(for: Playlist.self) { PlaylistDetailView(playlist: $0) }
        .navigationDestination(for: Album.self) { AlbumView(album: $0) }
    }

    private func row(_ title: String, _ icon: String, _ route: LibraryRoute) -> some View {
        NavigationLink(value: route) {
            Label { Text(title).font(.title3) } icon: { Image(systemName: icon).foregroundStyle(.tint) }
                .padding(.vertical, 6)
        }
    }
}
