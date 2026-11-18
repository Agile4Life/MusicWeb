import SwiftUI

/// "Tiếp theo": the live queue with shuffle/repeat, reordering and swipe-to-remove.
struct QueueView: View {
    @Environment(Player.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Button { player.toggleShuffle() } label: {
                            Label("Trộn bài", systemImage: "shuffle").frame(maxWidth: .infinity)
                        }
                        .tint(player.shuffleOn ? .accentColor : .secondary)
                        Button { player.cycleRepeat() } label: {
                            Label(repeatTitle, systemImage: player.repeatMode == .one ? "repeat.1" : "repeat").frame(maxWidth: .infinity)
                        }
                        .tint(player.repeatMode == .off ? .secondary : .accentColor)
                    }
                    .buttonStyle(.bordered)
                    .listRowSeparator(.hidden)
                }
                Section("Tiếp theo") {
                    ForEach(Array(player.queue.enumerated()), id: \.offset) { i, track in
                        Button { player.jump(to: i) } label: {
                            HStack {
                                TrackRow(track: track)
                                if i == player.index { Image(systemName: "speaker.wave.2.fill").foregroundStyle(.tint) }
                            }
                        }
                        .buttonStyle(.plain)
                        .deleteDisabled(i == player.index)
                    }
                    .onMove { player.move(from: $0, to: $1) }
                    .onDelete { offsets in offsets.sorted(by: >).forEach { player.remove(at: $0) } }
                    if player.isFetchingMore {
                        HStack { ProgressView(); Text("Đang tìm bài gợi ý…").foregroundStyle(.secondary) }
                    }
                }
            }
            .listStyle(.plain)
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Danh sách chờ")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } } }
        }
    }

    private var repeatTitle: String {
        switch player.repeatMode { case .off: "Lặp: tắt"; case .all: "Lặp tất cả"; case .one: "Lặp 1 bài" }
    }
}
