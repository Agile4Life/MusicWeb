import SwiftUI

struct Artwork: View {
    let url: URL?
    var cornerRadius: CGFloat = 8

    var body: some View {
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
        .aspectRatio(1, contentMode: .fit)
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
