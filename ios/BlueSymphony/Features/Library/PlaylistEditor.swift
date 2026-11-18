import SwiftUI

/// Create (`playlist == nil`) or edit a playlist; calls `onSaved` with the server's copy.
struct PlaylistEditor: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    let playlist: Playlist?
    let onSaved: (Playlist) -> Void
    @State private var name: String
    @State private var description: String
    @State private var isPublic: Bool
    @State private var busy = false
    @State private var error: String?

    init(playlist: Playlist? = nil, onSaved: @escaping (Playlist) -> Void) {
        self.playlist = playlist
        self.onSaved = onSaved
        _name = State(initialValue: playlist?.name ?? "")
        _description = State(initialValue: playlist?.description ?? "")
        _isPublic = State(initialValue: playlist?.is_public ?? false)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Tên playlist", text: $name)
                    TextField("Mô tả", text: $description, axis: .vertical)
                }
                Section { Toggle("Công khai", isOn: $isPublic) } footer: { Text("Người khác có thể xem playlist công khai.") }
            }
            .navigationTitle(playlist == nil ? "Playlist mới" : "Sửa playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Lưu") { Task { await save() } }
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .errorAlert($error)
        }
    }

    private func save() async {
        busy = true
        let n = name.trimmingCharacters(in: .whitespaces)
        do {
            let saved = try await session.guarded {
                if let playlist { try await PlaylistAPI.update(playlist.id, name: n, description: description, isPublic: isPublic) }
                else { try await PlaylistAPI.create(name: n, description: description, isPublic: isPublic) }
            }
            onSaved(saved)
            dismiss()
        } catch { self.error = message(for: error) }
        busy = false
    }
}
