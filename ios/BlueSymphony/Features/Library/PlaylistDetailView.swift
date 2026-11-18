import SwiftUI

struct PlaylistDetailView: View {
    @Environment(Player.self) private var player
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State var playlist: Playlist
    @State private var tracks: [Track] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var editing = false
    @State private var confirmDelete = false

    private var mine: Bool { session.owns(playlist) }

    var body: some View {
        List {
            VStack(spacing: 12) {
                Artwork(url: playlist.coverURL ?? tracks.first?.coverURL, cornerRadius: 12).frame(width: 220).shadow(radius: 12, y: 6)
                Text(playlist.name).font(.title2.bold()).multilineTextAlignment(.center)
                if let d = playlist.description, !d.isEmpty { Text(d).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center) }
                PlayShuffleBar(tracks: tracks)
            }
            .frame(maxWidth: .infinity)
            .listRowSeparator(.hidden)

            ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                Button { player.play(tracks, startAt: i) } label: { TrackRow(track: track) }
                    .buttonStyle(.plain)
                    .swipeActions { if mine { Button("Xoá", systemImage: "trash", role: .destructive) { Task { await remove(track) } } } }
            }
        }
        .listStyle(.plain)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if mine { ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Sửa playlist", systemImage: "pencil") { editing = true }
                    Button("Xoá playlist", systemImage: "trash", role: .destructive) { confirmDelete = true }
                } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("Tuỳ chọn")
            } }
        }
        .sheet(isPresented: $editing) { PlaylistEditor(playlist: playlist) { playlist = $0 } }
        .confirmationDialog("Xoá playlist “\(playlist.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Xoá playlist", role: .destructive) { Task { await deletePlaylist() } }
        }
        .overlay {
            if !loaded { ProgressView() }
            else if tracks.isEmpty && error == nil {
                ContentUnavailableView("Playlist trống", systemImage: "music.note", description: Text("Thêm bài hát từ menu “…” của từng bài."))
                    .padding(.top, 260)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    private func load() async {
        do {
            let (p, t) = try await session.guarded { try await PlaylistAPI.detail(playlist.id) }
            if let p { playlist = p }
            tracks = t
            session.learn(t)
        } catch { if !isCancellation(error) { self.error = message(for: error) } }
        loaded = true
    }

    private func remove(_ track: Track) async {
        do {
            try await session.guarded { try await PlaylistAPI.remove(trackID: track.id, from: playlist.id) }
            tracks.removeAll { $0.id == track.id }
        } catch { self.error = message(for: error) }
    }

    private func deletePlaylist() async {
        do {
            try await session.guarded { try await PlaylistAPI.delete(playlist.id) }
            dismiss()
        } catch { self.error = message(for: error) }
    }
}
