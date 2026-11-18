import AVKit
import MediaPlayer
import SwiftUI

struct NowPlayingView: View {
    @Environment(Player.self) private var player
    @Environment(\.dismiss) private var dismiss
    @Environment(Router.self) private var router
    @State private var scrub: Double?
    @State private var showLyrics = false
    @State private var showQueue = false

    var body: some View {
        ZStack {
            background
            VStack(spacing: 0) {
                Capsule().fill(.white.opacity(0.4)).frame(width: 40, height: 5).padding(.top, 8)

                if showLyrics, let track = player.current {
                    LyricsView(track: track).padding(.top, 12)
                } else {
                    Spacer(minLength: 24)
                    Artwork(url: player.current?.coverURL, cornerRadius: 14)
                        .shadow(color: .black.opacity(0.4), radius: 24, y: 12)
                        .scaleEffect(player.isPlaying ? 1 : 0.82)
                        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: player.isPlaying)
                        .padding(.horizontal, 28)
                    Spacer(minLength: 24)
                }

                if let track = player.current {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title).font(.title2.bold()).lineLimit(1)
                            Button { if let a = track.primaryArtist { router.show(artist: a) } } label: {
                                Text(track.artistName).font(.title3).opacity(0.7).lineLimit(1)
                            }
                            .buttonStyle(.plain)
                        }
                        Spacer()
                        FavoriteButton(track: track).font(.title2)
                    }
                    .padding(.top, 12)
                }

                progress.padding(.top, 16)
                controls.padding(.vertical, 20)
                #if !targetEnvironment(macCatalyst)
                VolumeSlider().frame(height: 24)
                #endif
                bottomBar.padding(.top, 16)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 28)
            .foregroundStyle(.white)
        }
        .gesture(DragGesture().onEnded { if $0.translation.height > 120 { dismiss() } })
        .sheet(isPresented: $showQueue) { QueueView() }
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
            .accessibilityLabel("Vị trí phát")
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
                .accessibilityLabel("Bài trước")
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
            .accessibilityLabel(player.isPlaying ? "Tạm dừng" : "Phát")
            Spacer()
            Button { player.next() } label: { Image(systemName: "forward.fill") }
                .accessibilityLabel("Bài tiếp theo")
        }
        .font(.system(size: 34))
        .padding(.horizontal, 24)
        .buttonStyle(.plain)
    }

    private var bottomBar: some View {
        HStack {
            Button { showLyrics.toggle() } label: {
                Image(systemName: showLyrics ? "quote.bubble.fill" : "quote.bubble")
            }
            .accessibilityLabel("Lời bài hát")
            Spacer()
            AirPlayButton().frame(width: 32, height: 32)
            Spacer()
            Button { showQueue = true } label: { Image(systemName: "list.bullet") }
                .accessibilityLabel("Danh sách chờ")
        }
        .font(.title2)
        .padding(.horizontal, 24)
        .buttonStyle(.plain)
    }
}

private struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let v = AVRoutePickerView()
        v.tintColor = .white
        v.activeTintColor = .systemPink
        return v
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

#if !targetEnvironment(macCatalyst)
/// System output volume (the slider the hardware buttons move). Not available on Mac.
private struct VolumeSlider: UIViewRepresentable {
    func makeUIView(context: Context) -> MPVolumeView {
        let v = MPVolumeView(frame: .zero)
        v.tintColor = .white
        return v
    }
    func updateUIView(_ uiView: MPVolumeView, context: Context) {}
}
#endif
