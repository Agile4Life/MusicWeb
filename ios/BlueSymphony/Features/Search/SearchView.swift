import SwiftUI

enum SearchScope: String, CaseIterable, Identifiable {
    case nct, soundcloud, songs, albums
    var id: String { rawValue }
    var title: String {
        switch self { case .nct: "NhacCuaTui"; case .soundcloud: "SoundCloud"; case .songs: "Quốc tế"; case .albums: "Album" }
    }
}

struct SearchView: View {
    @Environment(Player.self) private var player
    @State private var query = ""
    @State private var scope = SearchScope.nct
    @AppStorage("recentSearches") private var recentRaw = ""
    @State private var tracks: [Track] = []
    @State private var albums: [Album] = []
    @State private var searching = false
    @State private var failed = false

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var recents: [String] { recentRaw.split(separator: "\n").map(String.init) }
    private var isEmpty: Bool { scope == .albums ? albums.isEmpty : tracks.isEmpty }

    var body: some View {
        List {
            if trimmed.isEmpty {
                if !recents.isEmpty {
                    Section {
                        ForEach(recents, id: \.self) { term in
                            Button { query = term } label: { Label(term, systemImage: "clock.arrow.circlepath") }.buttonStyle(.plain)
                        }
                    } header: {
                        HStack {
                            Text("Tìm kiếm gần đây").font(.title3.bold()).foregroundStyle(.primary).textCase(nil)
                            Spacer()
                            Button("Xoá") { recentRaw = "" }.font(.subheadline)
                        }
                    }
                }
            } else if scope == .albums {
                ForEach(albums) { album in
                    NavigationLink(value: album) {
                        HStack(spacing: 12) {
                            Artwork(url: album.coverURL, cornerRadius: 6).frame(width: 56, height: 56)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(album.name).lineLimit(1)
                                Text(album.artist ?? "").font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
            } else {
                ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                    Button { remember(); player.play(tracks, startAt: i) } label: { TrackRow(track: track) }.buttonStyle(.plain)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Tìm kiếm")
        .searchable(text: $query, prompt: "Bài hát, nghệ sĩ")
        .searchScopes($scope) {
            ForEach(SearchScope.allCases) { Text($0.title).tag($0) }
        }
        .navigationDestination(for: Album.self) { AlbumView(album: $0) }
        .onSubmit(of: .search) { remember() }
        .overlay {
            if searching {
                ProgressView()
            } else if trimmed.isEmpty {
                if recents.isEmpty {
                    ContentUnavailableView("Tìm nhạc", systemImage: "magnifyingglass", description: Text("Nhập tên bài hát hoặc nghệ sĩ."))
                }
            } else if failed {
                ContentUnavailableView("Không tìm được", systemImage: "wifi.exclamationmark", description: Text("Kiểm tra mạng rồi thử lại."))
            } else if isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .task(id: "\(scope.rawValue)|\(trimmed)") { await search() }
    }

    private func remember() {
        guard !trimmed.isEmpty else { return }
        recentRaw = ([trimmed] + recents.filter { $0 != trimmed }).prefix(10).joined(separator: "\n")
    }

    private func search() async {
        guard !trimmed.isEmpty else { tracks = []; albums = []; failed = false; return }
        try? await Task.sleep(for: .milliseconds(350)) // debounce typing
        guard !Task.isCancelled else { return }
        searching = true
        defer { if !Task.isCancelled { searching = false } }
        do {
            switch scope {
            case .nct: tracks = try await NCT.search(trimmed)
            case .songs: tracks = try await API.search(trimmed)
            case .soundcloud: tracks = try await API.soundCloudSearch(trimmed)
            case .albums: albums = try await API.searchAlbums(trimmed)
            }
            failed = false
        } catch {
            if !isCancellation(error) { tracks = []; albums = []; failed = true }
        }
    }
}
