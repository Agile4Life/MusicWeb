import SwiftUI

extension View {
    /// Long-press menu shared by every track row.
    func trackMenu(_ track: Track) -> some View { modifier(TrackMenu(track: track)) }
}

private struct TrackMenu: ViewModifier {
    @Environment(Player.self) private var player
    @Environment(SessionStore.self) private var session
    let track: Track
    @State private var pickPlaylist = false
    @State private var error: String?

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button("Phát tiếp theo", systemImage: "text.insert") { player.playNext(track) }
                Button("Thêm vào hàng chờ", systemImage: "text.append") { player.enqueue(track) }
                if session.isSignedIn {
                    Button("Thêm vào playlist…", systemImage: "music.note.list") { pickPlaylist = true }
                    let fav = session.isFavorite(track)
                    Button(fav ? "Bỏ yêu thích" : "Yêu thích", systemImage: fav ? "heart.slash" : "heart") {
                        Task { do { try await session.toggleFavorite(track) } catch { self.error = message(for: error) } }
                    }
                }
            }
            .sheet(isPresented: $pickPlaylist) { PlaylistPicker(track: track) }
            .errorAlert($error)
    }
}

/// Sheet listing playlists; tapping one adds the track and shows the server's message.
private struct PlaylistPicker: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let track: Track
    @State private var playlists: [Playlist] = []
    @State private var loaded = false
    @State private var note: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List(playlists) { p in
                Button { Task { await add(to: p) } } label: {
                    HStack(spacing: 12) {
                        Artwork(url: p.coverURL, cornerRadius: 6).frame(width: 48, height: 48)
                        Text(p.name)
                    }
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
            .overlay {
                if !loaded { ProgressView() }
                else if playlists.isEmpty { ContentUnavailableView("Chưa có playlist", systemImage: "music.note.list", description: Text("Tạo playlist trong tab Thư viện.")) }
            }
            .navigationTitle("Thêm vào playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() } } }
            .task {
                playlists = (try? await session.guarded { try await PlaylistAPI.list() }) ?? []
                loaded = true
            }
            .alert(note ?? "", isPresented: Binding(get: { note != nil }, set: { if !$0 { note = nil; dismiss() } })) {}
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }

    private func add(to p: Playlist) async {
        do { note = try await session.guarded { try await PlaylistAPI.add(track, to: p.id) } }
        catch { self.error = message(for: error) }
    }
}

/// Heart for the current track; signed-out taps ask the user to sign in.
struct FavoriteButton: View {
    @Environment(SessionStore.self) private var session
    let track: Track
    @State private var error: String?

    var body: some View {
        let fav = session.isFavorite(track)
        Button {
            guard session.isSignedIn else { error = "Đăng nhập để thêm bài hát yêu thích."; return }
            Task { do { try await session.toggleFavorite(track) } catch { self.error = message(for: error) } }
        } label: {
            Image(systemName: fav ? "heart.fill" : "heart").foregroundStyle(fav ? Color.pink : .white)
        }
        .accessibilityLabel(fav ? "Bỏ yêu thích" : "Yêu thích")
        .errorAlert($error)
    }
}
