import SwiftUI

/// Apple Music-style lyrics: the current line is highlighted and kept centered; tap a line to seek.
struct LyricsView: View {
    @Environment(Player.self) private var player
    let track: Track
    @State private var lyrics: Lyrics?
    @State private var loading = true

    var body: some View {
        Group {
            if let lyrics, !lyrics.lines.isEmpty {
                let active = lyrics.activeIndex(at: player.currentTime)
                ScrollViewReader { proxy in
                    ScrollView(showsIndicators: false) {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(lyrics.lines) { line in
                                let isActive = line.id == active
                                Text(line.text.isEmpty ? "♪" : line.text)
                                    .font(.title2.bold())
                                    .opacity(lyrics.isSynced ? (isActive ? 1 : 0.35) : 0.9)
                                    .scaleEffect(isActive ? 1.03 : 1, anchor: .leading)
                                    .animation(.easeOut(duration: 0.25), value: isActive)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                    .onTapGesture { if let t = line.time { player.seek(to: t) } }
                                    .id(line.id)
                            }
                        }
                        .padding(.vertical, 120)
                    }
                    .onChange(of: active) { _, new in
                        if let new { withAnimation(.easeInOut(duration: 0.4)) { proxy.scrollTo(new, anchor: .center) } }
                    }
                }
            } else if loading {
                ProgressView().tint(.white)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "quote.bubble").font(.largeTitle)
                    Text("Không có lời bài hát").font(.headline)
                }
                .opacity(0.6)
            }
        }
        .task(id: track.id) {
            loading = true
            lyrics = nil
            lyrics = await LyricsService.fetch(for: track)
            loading = false
        }
    }
}
