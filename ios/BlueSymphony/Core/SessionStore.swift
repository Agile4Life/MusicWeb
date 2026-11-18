import Foundation
import Observation

/// Who is signed in. The real session is the NextAuth cookie; this just mirrors it for the UI.
@MainActor
@Observable
final class SessionStore {
    private(set) var email: String?
    var isSignedIn: Bool { email != nil }
    var displayName: String { email?.split(separator: "@").first.map(String.init) ?? "" }

    /// Restores the session on launch (cookies persist in HTTPCookieStorage).
    func refresh() async {
        email = await AuthService.sessionEmail()
    }

    func signIn(account: String, password: String) async throws {
        try await run { try await AuthService.signIn(account: account, password: password) }
    }

    func register(username: String, password: String, realEmail: String) async throws {
        try await run { try await AuthService.register(username: username, password: password, realEmail: realEmail) }
    }

    func signOut() async {
        await AuthService.signOut()
        email = nil
    }

    /// Call when a private route answers 401 (cookie expired).
    func handleUnauthorized() { email = nil }

    private func run(_ work: () async throws -> Void) async throws {
        do {
            try await work()
        } catch let e as AuthError {
            throw e
        } catch let e as APIError {
            throw AuthError(e.localizedDescription)
        } catch {
            throw AuthError("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.")
        }
        email = await AuthService.sessionEmail()
    }
}
