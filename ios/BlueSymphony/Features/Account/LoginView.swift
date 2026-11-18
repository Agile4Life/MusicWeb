import SwiftUI

struct LoginView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var account = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            if !Config.isConfigured {
                Section { Label("Ứng dụng chưa cấu hình đăng nhập.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            }
            Section("Tài khoản") {
                TextField("Tên tài khoản hoặc email", text: $account)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Mật khẩu", text: $password).textContentType(.password)
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack { Spacer(); if busy { ProgressView() } else { Text("Đăng nhập").bold() }; Spacer() }
                }
                .disabled(busy || account.isEmpty || password.count < 6 || !Config.isConfigured)
                NavigationLink("Tạo tài khoản mới") { RegisterView() }
            }
        }
        .navigationTitle("Đăng nhập")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func submit() async {
        busy = true
        error = nil
        do {
            try await session.signIn(account: account, password: password)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

struct RegisterView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var realEmail = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var error: String?
    @State private var needsApproval = false

    private var valid: Bool {
        username.range(of: "^[a-zA-Z0-9_]{3,30}$", options: .regularExpression) != nil && password.count >= 6 && password == confirm
    }

    var body: some View {
        Form {
            Section {
                TextField("Tên tài khoản", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Mật khẩu (≥ 6 ký tự)", text: $password).textContentType(.newPassword)
                SecureField("Nhập lại mật khẩu", text: $confirm).textContentType(.newPassword)
                TextField("Gmail liên kết (không bắt buộc)", text: $realEmail)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                Text(needsApproval ? "Tài khoản mới cần quản trị viên duyệt trước khi dùng."
                                   : "Tên tài khoản gồm chữ, số, gạch dưới (3–30 ký tự). Tài khoản được kích hoạt ngay.")
            }
            if let error { Section { Text(error).foregroundStyle(.red).font(.callout) } }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    HStack { Spacer(); if busy { ProgressView() } else { Text("Đăng ký").bold() }; Spacer() }
                }
                .disabled(busy || !valid || !Config.isConfigured)
            }
        }
        .navigationTitle("Đăng ký")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            struct Approval: Decodable { let approved: Bool? }
            if let a: Approval = try? await API.get("api/check-approval") { needsApproval = a.approved == false }
        }
    }

    private func submit() async {
        busy = true
        error = nil
        do {
            try await session.register(username: username, password: password, realEmail: realEmail)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}
