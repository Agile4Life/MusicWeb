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
