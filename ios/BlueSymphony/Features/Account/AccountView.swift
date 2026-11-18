import SwiftUI

/// Sheet behind the avatar button: account, cache and app info (Apple Music's account sheet, in miniature).
struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var cacheCleared = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "1.0") (\(info?["CFBundleVersion"] as? String ?? "1"))"
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Tài khoản") {
                    if session.isSignedIn {
                        Label(session.email ?? "", systemImage: "person.crop.circle.fill")
                        Button("Đăng xuất", role: .destructive) { Task { await session.signOut(); dismiss() } }
                    } else {
                        NavigationLink { LoginView() } label: { Label("Đăng nhập", systemImage: "person.crop.circle") }
                    }
                }
                Section("Ứng dụng") {
                    Button("Xoá bộ nhớ đệm", systemImage: "trash") { API.clearCache(); cacheCleared = true }
                    LabeledContent("Phiên bản", value: version)
                }
            }
            .navigationTitle("Tài khoản")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } } }
            .alert("Đã xoá bộ nhớ đệm", isPresented: $cacheCleared) {}
        }
    }
}

/// Apple Music-style avatar button for navigation bars.
struct AccountButton: View {
    @Environment(SessionStore.self) private var session
    @State private var show = false

    var body: some View {
        Button { show = true } label: {
            Image(systemName: session.isSignedIn ? "person.crop.circle.fill" : "person.crop.circle")
        }
        .accessibilityLabel(session.isSignedIn ? "Tài khoản" : "Đăng nhập")
        .sheet(isPresented: $show) { AccountView() }
    }
}
