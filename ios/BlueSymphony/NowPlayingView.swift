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

struct NowPlayingView: View {
    @Environment(Player.self) private var player
    @Environment(\.dismiss) private var dismiss
    @State private var scrub: Double?

    var body: some View {
        ZStack {
            background
            VStack(spacing: 0) {
                Capsule().fill(.white.opacity(0.4)).frame(width: 40, height: 5).padding(.top, 8)
                Spacer(minLength: 24)

                Artwork(url: player.current?.coverURL, cornerRadius: 14)
                    .shadow(color: .black.opacity(0.4), radius: 24, y: 12)
                    .scaleEffect(player.isPlaying ? 1 : 0.82)
                    .animation(.spring(response: 0.45, dampingFraction: 0.7), value: player.isPlaying)
                    .padding(.horizontal, 28)

                Spacer(minLength: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(player.current?.title ?? "").font(.title2.bold()).lineLimit(1)
                    Text(player.current?.artistName ?? "").font(.title3).opacity(0.7).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                progress.padding(.top, 20)
                controls.padding(.vertical, 28)
                Spacer(minLength: 12)
            }
            .padding(.horizontal, 28)
            .foregroundStyle(.white)
        }
        .gesture(DragGesture().onEnded { if $0.translation.height > 120 { dismiss() } })
    }

    private var background: some View {
        ZStack {
            Color.black
            Artwork(url: player.current?.coverURL, cornerRadius: 0)
                .scaleEffect(2.2)
                .blur(radius: 70)
                .opacity(0.9)
            Color.black.opacity(0.25)
        }
        .ignoresSafeArea()
    }

    private var progress: some View {
        let total = max(player.duration, 1)
        return VStack(spacing: 4) {
            Slider(value: Binding(
                get: { scrub ?? min(player.currentTime, total) },
                set: { scrub = $0 }
            ), in: 0...total) { editing in
                if !editing, let s = scrub { player.seek(to: s); scrub = nil }
            }
            .tint(.white)
            HStack {
                Text(formatTime(scrub ?? player.currentTime))
                Spacer()
                Text("-" + formatTime(total - (scrub ?? player.currentTime)))
            }
            .font(.caption.monospacedDigit())
            .opacity(0.6)
        }
    }

    private var controls: some View {
        HStack {
            Button { player.previous() } label: { Image(systemName: "backward.fill") }
            Spacer()
            Button { player.togglePlay() } label: {
                ZStack {
                    if player.isLoading {
                        ProgressView().tint(.white).controlSize(.large)
                    } else {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
                .font(.system(size: 52))
                .frame(width: 64, height: 64)
            }
            Spacer()
            Button { player.next() } label: { Image(systemName: "forward.fill") }
        }
        .font(.system(size: 34))
        .padding(.horizontal, 24)
        .buttonStyle(.plain)
    }
}
