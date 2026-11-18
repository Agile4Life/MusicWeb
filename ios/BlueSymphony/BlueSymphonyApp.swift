import SwiftUI

@main
struct BlueSymphonyApp: App {
    @State private var player = Player()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(player)
                .tint(.pink)
        }
    }
}

struct RootView: View {
    @Environment(Player.self) private var player
    @State private var showNowPlaying = false
    @State private var searchText = ""

    var body: some View {
        @Bindable var player = player
        TabView {
            Tab("Trang chủ", systemImage: "house.fill") {
                NavigationStack { HomeView() }
            }
            Tab("Mới", systemImage: "square.grid.2x2.fill") {
                NavigationStack { NewReleasesView() }
            }
            Tab(role: .search) {
                NavigationStack { SearchView(query: searchText) }
            }
        }
        .searchable(text: $searchText, prompt: "Bài hát, nghệ sĩ")
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            MiniPlayer { showNowPlaying = true }
        }
        .fullScreenCover(isPresented: $showNowPlaying) {
            NowPlayingView()
        }
        .alert(player.errorMessage ?? "", isPresented: Binding(
            get: { player.errorMessage != nil },
            set: { if !$0 { player.errorMessage = nil } }
        )) {}
    }
}
