import SwiftUI

struct MiniPlayer: View {
    @Environment(Player.self) private var player
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Artwork(url: player.current?.coverURL, cornerRadius: 6).frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.current?.title ?? "Chưa phát").font(.subheadline.weight(.medium)).lineLimit(1)
                if let artist = player.current?.artistName {
                    Text(artist).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            Group {
                if player.isLoading {
                    ProgressView()
                } else {
                    Button { player.togglePlay() } label: {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    }
                }
            }
            .frame(width: 32)
            Button { player.next() } label: { Image(systemName: "forward.fill") }
        }
        .font(.title3)
        .foregroundStyle(.primary)
        .padding(.horizontal, 12)
        .contentShape(Rectangle())
        .onTapGesture { if player.current != nil { onOpen() } }
        .disabled(player.current == nil)
    }
}
