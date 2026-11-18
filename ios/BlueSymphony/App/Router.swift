import SwiftUI

/// Lets any screen (track menus, now playing) ask the root to show an artist page.
@MainActor
@Observable
final class Router {
    var artist: ArtistRoute?
    func show(artist name: String) { artist = ArtistRoute(name: name) }
}

extension EnvironmentValues {
    /// Overridden inside the artist sheet so "go to artist" pushes instead of presenting another sheet.
    @Entry var openArtist: ((String) -> Void)?
}

/// Sheet content: an artist page with its own navigation stack (albums, further artists).
struct ArtistSheet: View {
    @Environment(\.dismiss) private var dismiss
    let route: ArtistRoute
    @State private var path: [ArtistRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ArtistView(name: route.name)
                .navigationDestination(for: ArtistRoute.self) { ArtistView(name: $0.name) }
                .navigationDestination(for: Album.self) { AlbumView(album: $0) }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } } }
        }
        .environment(\.openArtist) { path.append(ArtistRoute(name: $0)) }
    }
}
