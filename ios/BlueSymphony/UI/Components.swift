import SwiftUI

struct Artwork: View {
    let url: URL?
    var cornerRadius: CGFloat = 8

    var body: some View {
        // Square placeholder first, so non-square covers (YouTube thumbnails) are cropped instead of overflowing.
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        ZStack {
                            Rectangle().fill(.quaternary)
                            Image(systemName: "music.note").font(.title2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

struct TrackRow: View {
    @Environment(Player.self) private var player
    let track: Track
    var showArtwork = true

    var body: some View {
        HStack(spacing: 12) {
            if showArtwork {
                Artwork(url: track.coverURL, cornerRadius: 6).frame(width: 48, height: 48)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .lineLimit(1)
                    .foregroundStyle(player.current?.id == track.id ? Color.accentColor : .primary)
                Text(track.artistName).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if player.current?.id == track.id && player.isPlaying {
                Image(systemName: "waveform").symbolEffect(.variableColor.iterative).foregroundStyle(.tint)
            }
        }
        .contentShape(Rectangle())
        .trackMenu(track)
    }
}

struct SectionHeader: View {
    let title: String
    var body: some View {
        HStack(spacing: 4) {
            Text(title).font(.title2.bold())
            Image(systemName: "chevron.right").font(.title3.bold()).foregroundStyle(.secondary)
        }
        .padding(.horizontal)
    }
}

func formatTime(_ s: Double) -> String {
    guard s.isFinite, s >= 0 else { return "0:00" }
    let t = Int(s)
    return String(format: "%d:%02d", t / 60, t % 60)
}

/// True when a request was cancelled because its view's task ended; not worth telling the user.
func isCancellation(_ error: Error) -> Bool {
    error is CancellationError || (error as? URLError)?.code == .cancelled
}

/// Vietnamese text for any error a view might catch.
func message(for error: Error) -> String {
    if error is URLError { return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại." }
    if let e = error as? LocalizedError, let d = e.errorDescription { return d }
    return "Đã xảy ra lỗi. Vui lòng thử lại."
}

extension View {
    /// Shows `text` in an alert titled "Lỗi" and clears it on dismiss.
    func errorAlert(_ text: Binding<String?>) -> some View {
        alert("Lỗi", isPresented: Binding(get: { text.wrappedValue != nil }, set: { if !$0 { text.wrappedValue = nil } })) {
            Button("Đóng", role: .cancel) {}
        } message: { Text(text.wrappedValue ?? "") }
    }
}

struct PlayShuffleBar: View {
    @Environment(Player.self) private var player
    let tracks: [Track]

    var body: some View {
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
}

/// Shown in place of private content when nobody is signed in.
struct SignInPrompt: View {
    let title: String
    @State private var show = false

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "person.crop.circle.badge.questionmark")
        } description: {
            Text("Đăng nhập để dùng thư viện của bạn trên mọi thiết bị.")
        } actions: {
            Button("Đăng nhập") { show = true }.buttonStyle(.borderedProminent)
        }
        .sheet(isPresented: $show) { AccountView() }
    }
}

struct AlbumTile: View {
    let album: Album

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Artwork(url: album.coverURL)
            Text(album.name).font(.subheadline).lineLimit(1)
            Text(album.artist ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

/// Square cover + title/artist for horizontal shelves; tapping plays the whole shelf from this track.
struct TrackTile: View {
    @Environment(Player.self) private var player
    let tracks: [Track]
    let index: Int

    var body: some View {
        let track = tracks[index]
        Button { player.play(tracks, startAt: index) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Artwork(url: track.coverURL)
                Text(track.title).font(.subheadline).lineLimit(1)
                Text(track.artistName).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(width: 150)
            .trackMenu(track)
        }
        .buttonStyle(.plain)
    }
}

struct TrackShelf: View {
    let title: String
    let tracks: [Track]

    var body: some View {
        if !tracks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(title: title)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(tracks.indices, id: \.self) { TrackTile(tracks: tracks, index: $0) }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal)
                }
                .scrollTargetBehavior(.viewAligned)
            }
        }
    }
}
