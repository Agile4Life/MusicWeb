import SwiftUI

struct TopTracksView: View {
    @Environment(Player.self) private var player
    @Environment(SessionStore.self) private var session
    @State private var timeframe = "30days"
    @State private var items: [TopItem] = []
    @State private var total = 0
    @State private var loaded = false
    @State private var error: String?

    private let frames = [("7days", "7 ngày"), ("30days", "30 ngày"), ("all", "Tất cả")]

    var body: some View {
        List {
            Section {
                Picker("Khoảng thời gian", selection: $timeframe) {
                    ForEach(frames, id: \.0) { Text($0.1).tag($0.0) }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
                if total > 0 { Text("\(total) lượt nghe").font(.footnote).foregroundStyle(.secondary).listRowSeparator(.hidden) }
            }
            let tracks = items.map(\.track)
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                Button { player.play(tracks, startAt: i) } label: {
                    HStack(spacing: 12) {
                        Text("\(i + 1)").font(.headline).foregroundStyle(.secondary).frame(width: 26)
                        TrackRow(track: item.track)
                        Text("\(item.playCount)×").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationTitle("Top của bạn")
        .overlay {
            if !loaded { ProgressView() }
            else if items.isEmpty {
                ContentUnavailableView("Chưa có dữ liệu", systemImage: "chart.bar", description: Text("Nghe thêm nhạc để thấy bài hát yêu thích nhất."))
            }
        }
        .refreshable { await load() }
        .task(id: timeframe) { await load() }
        .errorAlert($error)
    }

    private func load() async {
        struct Reply: Decodable { let items: Lossy<TopItem>?; let totalPlays: Int? }
        do {
            let r: Reply = try await session.guarded { try await API.get("api/history/top", query: ["timeframe": timeframe, "limit": "50"]) }
            items = r.items?.items ?? []
            total = r.totalPlays ?? 0
            session.learn(items.map(\.track))
            error = nil
        } catch { if !isCancellation(error) { self.error = message(for: error) } }
        loaded = true
    }
}
