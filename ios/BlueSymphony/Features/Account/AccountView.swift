import SwiftUI

/// Sheet behind the avatar button: sign-in form when signed out, account info when signed in.
struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if session.isSignedIn {
                    List {
                        Section {
                            Label(session.email ?? "", systemImage: "person.crop.circle.fill")
                        }
                        Section {
                            Button("Đăng xuất", role: .destructive) {
                                Task { await session.signOut(); dismiss() }
                            }
                        }
                    }
                    .navigationTitle("Tài khoản")
                } else {
                    LoginView()
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Xong") { dismiss() } } }
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
