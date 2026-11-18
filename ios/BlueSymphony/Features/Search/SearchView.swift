import SwiftUI

struct SearchView: View {
    @Environment(Player.self) private var player
    let query: String
    @State private var results: [Track] = []
    @State private var searching = false

    var body: some View {
        List(Array(results.enumerated()), id: \.element.id) { i, track in
            Button { player.play(results, startAt: i) } label: { TrackRow(track: track) }
                .buttonStyle(.plain)
        }
        .listStyle(.plain)
        .navigationTitle("Tìm kiếm")
        .overlay {
            if searching {
                ProgressView()
            } else if query.trimmingCharacters(in: .whitespaces).isEmpty {
                ContentUnavailableView("Tìm nhạc", systemImage: "magnifyingglass",
                                       description: Text("Nhập tên bài hát hoặc nghệ sĩ."))
            } else if results.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { results = []; return }
            try? await Task.sleep(for: .milliseconds(350)) // debounce typing
            guard !Task.isCancelled else { return }
            searching = true
            let r = try? await API.search(q)
            if !Task.isCancelled { results = r ?? []; searching = false }
        }
    }
}
