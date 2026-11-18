import SwiftUI

struct HistoryView: View {
    @Environment(Player.self) private var player
    @Environment(SessionStore.self) private var session
    @State private var items: [HistoryItem] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var confirmClear = false

    private var groups: [(day: Date, items: [HistoryItem])] {
        let cal = Calendar.current
        let dated = Dictionary(grouping: items) { cal.startOfDay(for: $0.playedDate ?? .distantPast) }
        return dated.keys.sorted(by: >).map { ($0, dated[$0]!) }
    }

    private var playable: [Track] { items.compactMap(\.track) }

    var body: some View {
        List {
            ForEach(groups, id: \.day) { group in
                Section(title(for: group.day)) {
                    ForEach(group.items) { item in
                        if let track = item.track {
                            Button { player.play(playable, startAt: playable.firstIndex { $0.id == track.id } ?? 0) } label: { TrackRow(track: track) }
                                .buttonStyle(.plain)
                                .swipeActions { Button("Xoá", systemImage: "trash", role: .destructive) { Task { await delete(item) } } }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Lịch sử nghe")
        .toolbar {
            if !items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Xoá tất cả", role: .destructive) { confirmClear = true }
                }
            }
        }
        .confirmationDialog("Xoá toàn bộ lịch sử nghe?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Xoá tất cả", role: .destructive) { Task { await clearAll() } }
        } message: { Text("Thao tác này không thể hoàn tác.") }
        .overlay {
            if !loaded { ProgressView() }
            else if items.isEmpty {
                ContentUnavailableView("Chưa có lịch sử", systemImage: "clock", description: Text("Các bài bạn nghe sẽ xuất hiện ở đây."))
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .errorAlert($error)
    }

    private func title(for day: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(day) { return "Hôm nay" }
        if cal.isDateInYesterday(day) { return "Hôm qua" }
        if day == .distantPast { return "Trước đó" }
        return day.formatted(.dateTime.locale(Locale(identifier: "vi_VN")).day().month(.wide).year())
    }

    private func load() async {
        struct Reply: Decodable { let items: Lossy<HistoryItem>? }
        do {
            let r: Reply = try await session.guarded { try await API.get("api/history/list", query: ["limit": "200"]) }
            items = r.items?.items ?? []
            session.learn(playable)
            error = nil
        } catch { if !isCancellation(error) { self.error = message(for: error) } }
        loaded = true
    }

    private func delete(_ item: HistoryItem) async {
        struct Body: Encodable { let historyId: String }
        do {
            try await session.guarded { try await API.send("POST", "api/history/delete", body: Body(historyId: item.id)) }
            items.removeAll { $0.id == item.id }
        } catch { self.error = message(for: error) }
    }

    private func clearAll() async {
        struct Body: Encodable { let clearAll = true }
        do {
            try await session.guarded { try await API.send("POST", "api/history/delete", body: Body()) }
            items = []
        } catch { self.error = message(for: error) }
    }
}
