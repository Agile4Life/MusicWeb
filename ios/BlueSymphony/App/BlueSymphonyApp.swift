import SwiftUI

@main
struct BlueSymphonyApp: App {
    @State private var player = Player()
    @State private var session = SessionStore()
    @State private var router = Router()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(player)
                .environment(session)
                .environment(router)
                .tint(.pink)
                .task {
                    player.session = session
                    await session.refresh()
                }
        }
    }
}

struct RootView: View {
    @Environment(Player.self) private var player
    @Environment(Router.self) private var router
    @State private var showNowPlaying = false
    @State private var presentedArtist: ArtistRoute?

    var body: some View {
        @Bindable var player = player
        TabView {
            Tab("Trang chủ", systemImage: "house.fill") {
                NavigationStack { HomeView() }
            }
            Tab("Mới", systemImage: "square.grid.2x2.fill") {
                NavigationStack { NewReleasesView() }
            }
            Tab("Thư viện", systemImage: "music.note.square.stack.fill") {
                NavigationStack { LibraryView() }
            }
            Tab(role: .search) {
                NavigationStack { SearchView() }
            }
        }
        // iPhone: bottom tab bar; iPad/Mac: Apple Music-style sidebar.
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory {
            MiniPlayer { showNowPlaying = true }
        }
        .fullScreenCover(isPresented: $showNowPlaying) {
            NowPlayingView()
        }
        .sheet(item: $presentedArtist) { ArtistSheet(route: $0) }
        .onChange(of: router.artist) { _, route in
            guard let route else { return }
            router.artist = nil
            Task {
                // An artist sheet can't appear over the full-screen player; close it first.
                if showNowPlaying { showNowPlaying = false; try? await Task.sleep(for: .milliseconds(600)) }
                presentedArtist = route
            }
        }
        .alert(player.errorMessage ?? "", isPresented: Binding(
            get: { player.errorMessage != nil },
            set: { if !$0 { player.errorMessage = nil } }
        )) {}
    }
}
