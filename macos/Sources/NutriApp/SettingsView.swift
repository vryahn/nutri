import AppKit
import NutriCore
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: Store
    var close: () -> Void
    @State private var profile: Record = [:]
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var avatar: NSImage?
    @State private var avatarData: Data?
    @State private var avatarZoom = 1.0
    @State private var avatarX = 0.0
    @State private var avatarY = 0.0
    @State private var removeAvatar = false
    @State private var glass = ""
    @State private var sleep = ""
    @State private var editingBands = false

    var body: some View {
        VStack(spacing: 0) {
            EditorTitle(title: store.tr("Ajustes"), close: close).padding(20)
            Divider()
            TabView {
                Form {
                    Section(store.tr("Preferencias")) {
                        Picker(store.tr("Apariencia"), selection: $store.theme) {
                            Text(store.tr("Sistema")).tag("system")
                            Text(store.tr("Claro")).tag("light")
                            Text(store.tr("Oscuro")).tag("dark")
                        }
                        Picker(store.tr("Idioma"), selection: preference("lang", fallback: "es")) {
                            Text("Español").tag("es")
                            Text("English").tag("en")
                        }
                        Picker(store.tr("Unidades"), selection: preference("units", fallback: "metric")) {
                            Text(store.tr("Métricas (g, ml)")).tag("metric")
                            Text(store.tr("EE. UU. (oz, fl oz)")).tag("us")
                        }
                    }
                    Section(store.tr("Registro")) {
                        TextField(store.tr("Tamaño del vaso (ml)"), text: $glass)
                        TextField(store.tr("Umbral de sueño (h)"), text: $sleep)
                        Button(store.tr("Guardar preferencias")) {
                            save {
                                guard let capacity = decimal(glass), (1...5000).contains(capacity),
                                      let hours = decimal(sleep), (1...24).contains(hours) else {
                                    throw NutriError("Revisa las unidades y los límites de vaso y sueño.")
                                }
                                try await store.patchPrefs(["water_glass_ml": .number(capacity), "sueno_umbral_h": .number(hours)])
                            }
                        }
                        Button(store.tr("Bandas de adherencia…")) { editingBands = true }
                    }
                }.formStyle(.grouped).tabItem { Label(store.tr("Preferencias"), systemImage: "slider.horizontal.3") }

                Form {
                    Section(store.tr("Perfil")) {
                        HStack {
                            if let avatar = previewAvatar, !removeAvatar {
                                Image(nsImage: avatar).resizable().scaledToFill().frame(width: 48, height: 48).clipShape(Circle())
                            } else { Image(systemName: "person.crop.circle").font(.largeTitle) }
                            Button(store.tr("Elegir foto…"), action: chooseAvatar)
                            if avatar != nil && !removeAvatar {
                                Button(store.tr("Quitar foto"), role: .destructive) { avatarData = nil; removeAvatar = true }
                            }
                        }
                        if avatarData != nil {
                            Slider(value: $avatarZoom, in: 1...3) { Text(store.tr("Zoom")) }
                            Slider(value: $avatarX, in: -1...1) { Text(store.tr("Horizontal")) }
                            Slider(value: $avatarY, in: -1...1) { Text(store.tr("Vertical")) }
                        }
                        TextField(store.tr("Nombre"), text: profileText("first_name"))
                        TextField(store.tr("Segundo nombre"), text: profileText("middle_name"))
                        TextField(store.tr("Apellidos"), text: profileText("last_name"))
                        TextField(store.tr("Nacimiento (AAAA-MM-DD)"), text: profileText("dob"))
                        TextField(store.tr("Altura (cm)"), text: profileText("height_cm"))
                        Button(store.tr("Guardar perfil")) { save(saveProfile) }.buttonStyle(.borderedProminent)
                    }
                }.formStyle(.grouped).tabItem { Label(store.tr("Perfil"), systemImage: "person.crop.circle") }

                Form {
                    Section(store.tr("Cuenta")) {
                        LabeledContent(store.tr("Correo"), value: store.email)
                        Button(store.tr("Cerrar sesión"), role: .destructive) { save { try await store.signOut(); close() } }
                    }
                    Section(store.tr("Cambiar contraseña")) {
                        SecureField(store.tr("Nueva contraseña"), text: $password)
                        SecureField(store.tr("Confirmar contraseña"), text: $confirm)
                        Button(store.tr("Cambiar contraseña")) {
                            save {
                                guard password.count >= 8, password == confirm else {
                                    throw NutriError("Usa al menos ocho caracteres y confirma la misma contraseña.")
                                }
                                try await store.changePassword(password)
                                password = ""
                                confirm = ""
                            }
                        }.disabled(password.isEmpty || confirm.isEmpty || store.demoActive)
                    }
                }.formStyle(.grouped).tabItem { Label(store.tr("Cuenta"), systemImage: "key.horizontal") }
            }
            .padding(14)
            .disabled(busy || store.signingOut)
        }
        .frame(width: 530, height: 525)
        .task {
            profile = store.prefs.object("profile")
            glass = formText(store.prefs.number("water_glass_ml") ?? 1000)
            sleep = formText(store.prefs.number("sueno_umbral_h") ?? 6)
            let path = profile.text("avatar_path")
            if !path.isEmpty {
                do { avatar = NSImage(data: try await store.storage("GET", "object/authenticated/body-photos/" + path)) }
                catch { store.report(error) }
            }
        }
        .sheet(isPresented: $editingBands) { BandsView { editingBands = false } }
    }

    private func preference(_ key: String, fallback: String) -> Binding<String> {
        Binding(get: { store.prefs[key]?.string ?? fallback }, set: { value in
            save { try await store.patchPrefs([key: .string(value)]) }
        })
    }

    private func profileText(_ key: String) -> Binding<String> {
        Binding(get: { profile[key]?.string ?? formText(profile.number(key)) }, set: { profile[key] = .string($0) })
    }

    private func save(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await action()
                if store.owner != nil { store.toast(store.tr("Guardado")) }
            }
            catch { store.report(error) }
        }
    }

    private func chooseAvatar() {
        guard let url = openFiles([.image]).first else { return }
        do {
            let data = try jpegData(url, maxSide: 512)
            avatarData = data
            avatarZoom = 1
            avatarX = 0
            avatarY = 0
            removeAvatar = false
        } catch { store.report(error) }
    }

    private func saveProfile() async throws {
        guard let owner = store.owner else { throw CancellationError() }
        var next = profile
        for key in ["first_name", "middle_name", "last_name", "dob", "height_cm"] {
            let value = next.text(key).trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty && next.number(key) == nil { next.removeValue(forKey: key) }
            else if key == "height_cm" {
                guard let height = decimal(value.isEmpty ? formText(next.number(key)) : value), height > 0 else {
                    throw NutriError("Altura inválida.")
                }
                next[key] = .number(height)
            } else {
                if key == "dob", Day.date(value) == nil { throw NutriError("Fecha de nacimiento inválida.") }
                next[key] = .string(value)
            }
        }
        let previousAvatar = profile.text("avatar_path")
        var uploaded: String?
        var newAvatar: NSImage?
        if avatarData != nil {
            let crop = try croppedAvatar()
            let path = owner + "/avatar/" + UUID().uuidString.lowercased() + ".jpg"
            _ = try await store.storage("POST", "object/body-photos/" + path, body: crop, contentType: "image/jpeg")
            next["avatar_path"] = .string(path)
            newAvatar = NSImage(data: crop)
            uploaded = path
        }
        if removeAvatar { next.removeValue(forKey: "avatar_path") }
        do {
            try await store.patchPrefs(["profile": .object(next)])
        } catch {
            if let uploaded, (error as? NutriError)?.permanentWriteFailure == true { try? await deleteAvatar(uploaded) }
            throw error
        }
        profile = next
        if let newAvatar { avatar = newAvatar }
        if removeAvatar { avatar = nil }
        avatarData = nil
        removeAvatar = false
        if !previousAvatar.isEmpty, previousAvatar != next.text("avatar_path") { try await deleteAvatar(previousAvatar) }
    }

    private var previewAvatar: NSImage? {
        if avatarData != nil, let data = try? croppedAvatar() { return NSImage(data: data) }
        return avatar
    }

    private func croppedAvatar() throws -> Data {
        guard let data = avatarData, let image = NSBitmapImageRep(data: data)?.cgImage else {
            throw NutriError("No se pudo abrir la imagen.")
        }
        let width = Double(image.width)
        let height = Double(image.height)
        let side = max(1, floor(min(width, height) / avatarZoom))
        let rect = CGRect(x: floor((width - side) * (avatarX + 1) / 2),
                          y: floor((height - side) * (avatarY + 1) / 2), width: side, height: side)
        guard let cropped = image.cropping(to: rect),
              let encoded = NSBitmapImageRep(cgImage: cropped).representation(using: .jpeg, properties: [.compressionFactor: 0.88]) else {
            throw NutriError("No se pudo convertir la imagen.")
        }
        return encoded
    }

    private func deleteAvatar(_ path: String) async throws {
        let body = try JSONEncoder().encode(["prefixes": [path]])
        _ = try await store.storage("DELETE", "object/body-photos", body: body, contentType: "application/json")
    }
}

private struct BandsView: View {
    @EnvironmentObject private var store: Store
    let close: () -> Void
    @State private var values = [String: String]()
    @State private var saving = false

    private var fields: [(String, String, String)] {
        let goals = ["default", "mantenimiento", "recomposicion", "deficit", "volumen"]
        return goals.flatMap { goal in ["okUnder", "okOver", "warnUnder", "warnOver"].map { ("diana", goal, $0) } }
            + [("rango", "", "ok"), ("rango", "", "warn"), ("techo", "", "warn")]
    }

    var body: some View {
        VStack {
            EditorTitle(title: store.tr("Bandas de adherencia"), close: close).padding()
            Form {
                ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                    let (kind, group, key) = field
                    let path = [kind, group, key].joined(separator: ".")
                    TextField(([kind, group, key].filter { !$0.isEmpty }).joined(separator: " · ") + " (%)", text: Binding(
                        get: { values[path] ?? "" }, set: { values[path] = $0 }
                    ))
                }
            }.formStyle(.grouped)
            HStack {
                Button(store.tr("Restablecer")) { values = initial(Domain.defaultBands) }
                Spacer()
                Button(store.tr("Guardar")) { persist() }.buttonStyle(.borderedProminent)
            }.padding()
        }
        .frame(width: 505, height: 550)
        .disabled(saving)
        .task { values = initial(store.prefs.object("adherence_bands")) }
    }

    private func initial(_ custom: Record) -> [String: String] {
        Dictionary(uniqueKeysWithValues: fields.map { kind, group, key in
            let c = group.isEmpty ? custom.object(kind) : custom.object(kind).object(group)
            let d = group.isEmpty ? Domain.defaultBands.object(kind) : Domain.defaultBands.object(kind).object(group)
            return ([kind, group, key].joined(separator: "."), numberText((c.number(key) ?? d.number(key) ?? 0) * 100))
        })
    }

    private func persist() {
        saving = true
        Task {
            defer { saving = false }
            do {
                var bands: Record = [:]
                for (kind, group, key) in fields {
                    guard let value = decimal(values[[kind, group, key].joined(separator: ".")] ?? ""), (0...100).contains(value) else {
                        throw NutriError("Usa un porcentaje de 0 a 100.")
                    }
                    var category = bands.object(kind)
                    if group.isEmpty { category[key] = .number(value / 100) }
                    else {
                        var regimen = category.object(group)
                        regimen[key] = .number(value / 100)
                        category[group] = .object(regimen)
                    }
                    bands[kind] = .object(category)
                }
                let energies = bands.object("diana")
                guard energies.values.allSatisfy({ value in
                    let band = value.object ?? [:]
                    return (band.number("okUnder") ?? 0) <= (band.number("warnUnder") ?? 0)
                        && (band.number("okOver") ?? 0) <= (band.number("warnOver") ?? 0)
                }), (bands.object("rango").number("ok") ?? 0) <= (bands.object("rango").number("warn") ?? 0) else {
                    throw NutriError("La tolerancia de alerta debe cubrir la tolerancia normal.")
                }
                try await store.patchPrefs(["adherence_bands": .object(bands)])
                close()
            } catch { store.report(error) }
        }
    }
}
