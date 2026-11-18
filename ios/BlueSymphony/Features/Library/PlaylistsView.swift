import SwiftUI

struct PlaylistsView: View {
    @Environment(SessionStore.self) private var session
    @State private var playlists: [Playlist] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var creating = false
    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 20) {
                ForEach(playlists) { p in
                    NavigationLink(value: p) {
                        VStack(alignment: .leading, spacing: 4) {
                            Artwork(url: p.coverURL)
                            Text(p.name).font(.subheadline).lineLimit(1)
                            if p.is_public == true { Text("Công khai").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .navigationTitle("Playlist")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel("Tạo playlist")
            }
        }
        .sheet(isPresented: $creating) { PlaylistEditor { playlists.insert($0, at: 0) } }
        .overlay {
            if !loaded { ProgressView() }
            else if playlists.isEmpty {
                ContentUnavailableView("Chưa có playlist", systemImage: "music.note.list", description: Text("Nhấn + để tạo playlist đầu tiên."))
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    private func load() async {
        do {
            playlists = try await session.guarded { try await PlaylistAPI.list() }
        } catch { if !isCancellation(error) { self.error = message(for: error) } }
        loaded = true
    }
}
