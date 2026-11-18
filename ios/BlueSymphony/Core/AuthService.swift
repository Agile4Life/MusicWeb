import Foundation

struct AuthError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

/// Mirrors the web login (components/auth/AuthForm.tsx): Supabase password grant, then a NextAuth
/// "credentials" session. The session cookie lands in HTTPCookieStorage.shared, which URLSession.shared uses.
enum AuthService {
    /// Plain usernames are `<username>@musicweb.com` accounts, like on the web.
    static func authEmail(_ account: String) -> String {
        let t = account.trimmingCharacters(in: .whitespaces).lowercased()
        return t.contains("@") ? t : "\(t)@musicweb.com"
    }

    static func signIn(account: String, password: String) async throws {
        let email = authEmail(account)
        let token = try await supabaseToken(email: email, password: password)
        try await createSession(email: email, accessToken: token)
    }

    static func register(username: String, password: String, realEmail: String) async throws {
        struct Body: Encodable { let username, password: String; let realEmail: String? }
        struct Reply: Decodable { let ok: Bool?; let authEmail: String?; let error: String? }
        let name = username.trimmingCharacters(in: .whitespaces)
        let mail = realEmail.trimmingCharacters(in: .whitespaces)
        let data: Data
        do {
            data = try await API.send("POST", "api/register", body: Body(username: name, password: password, realEmail: mail.isEmpty ? nil : mail))
        } catch let APIError.server(message) {
            throw AuthError(message ?? "Đăng ký thất bại. Vui lòng thử lại!")
        }
        guard let reply = try? JSONDecoder().decode(Reply.self, from: data), reply.ok == true, let email = reply.authEmail else {
            throw AuthError("Đăng ký thất bại. Vui lòng thử lại!")
        }
        let token = try await supabaseToken(email: email, password: password)
        try await createSession(email: email, accessToken: token)
    }

    /// Email of the current NextAuth session, nil when signed out.
    static func sessionEmail() async -> String? {
        struct Session: Decodable { struct User: Decodable { let email: String? }; let user: User? }
        guard let s: Session = try? await API.get("api/auth/session") else { return nil }
        return s.user?.email
    }

    static func signOut() async {
        if let csrf = try? await csrfToken() {
            _ = try? await form("api/auth/signout", ["csrfToken": csrf, "json": "true"])
        }
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: apiBase) ?? [] { storage.deleteCookie(cookie) }
    }

    // MARK: - Steps

    private static func supabaseToken(email: String, password: String, retryConfirm: Bool = true) async throws -> String {
        guard let base = Config.supabaseURL, let key = Config.supabaseKey else {
            throw AuthError("Ứng dụng chưa cấu hình đăng nhập (chưa cấu hình Supabase).")
        }
        struct Reply: Decodable {
            let access_token: String?
            let error_code: String?
            let msg: String?
            let error_description: String?
            let message: String?
        }
        var req = URLRequest(url: base.appendingPathComponent("auth/v1/token").appending(queryItems: [.init(name: "grant_type", value: "password")]), timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, _) = try await URLSession.shared.data(for: req)
        let r = try? JSONDecoder().decode(Reply.self, from: data)
        if let token = r?.access_token { return token }

        let text = [r?.error_code, r?.msg, r?.error_description, r?.message].compactMap { $0 }.joined(separator: " ").lowercased()
        if text.contains("not confirmed"), retryConfirm {
            struct Approve: Encodable { let email: String }
            _ = try? await API.send("POST", "api/approve-email", body: Approve(email: email))
            return try await supabaseToken(email: email, password: password, retryConfirm: false)
        }
        throw AuthError(translate(text))
    }

    private static func createSession(email: String, accessToken: String) async throws {
        let csrf = try await csrfToken()
        let data = try await form("api/auth/callback/credentials",
                                  ["csrfToken": csrf, "email": email, "accessToken": accessToken, "json": "true"])
        let url = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["url"] as? String ?? ""
        guard !url.contains("error="), await sessionEmail() != nil else {
            throw AuthError("Không tạo được phiên đăng nhập. Vui lòng thử lại.")
        }
    }

    private static func csrfToken() async throws -> String {
        struct Reply: Decodable { let csrfToken: String }
        let r: Reply = try await API.get("api/auth/csrf")
        return r.csrfToken
    }

    /// POST application/x-www-form-urlencoded, as NextAuth expects.
    private static func form(_ path: String, _ fields: [String: String]) async throws -> Data {
        var req = URLRequest(url: apiBase.appendingPathComponent(path), timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        req.httpBody = fields.map { k, v in "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        return try await URLSession.shared.data(for: req).0
    }

    private static func translate(_ text: String) -> String {
        if text.contains("invalid login credentials") || text.contains("invalid_credentials") { return "Tên tài khoản hoặc mật khẩu không chính xác." }
        if text.contains("password should be at least") { return "Mật khẩu phải có ít nhất 6 ký tự." }
        if text.contains("rate limit") { return "Quá nhiều lần thử. Vui lòng thử lại sau." }
        if text.contains("invalid email") { return "Định dạng email không hợp lệ." }
        return "Đăng nhập thất bại. Vui lòng thử lại."
    }
}
