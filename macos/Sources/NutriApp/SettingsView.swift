#if os(macOS)
import AppKit
#else
import PhotosUI
#endif
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

enum AccountSheet: Hashable { case config, profile, region, password, labels, wizard }

struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let sheet: AccountSheet
    let avatar: NutriPlatformImage?
    let close: () -> Void
    let navigate: (AccountSheet) -> Void
    @State private var profile: Record
    @State private var avatarData: Data?
    @State private var cropImage: NutriPlatformImage?
    @State private var removeAvatar = false
    @State private var bands: Record
    @State private var regimen = "default"
    @State private var sleep: Double
    @State private var busy = false
    @State private var choosingBirthDate = false
    #if os(iOS)
    @State private var choosingAvatarSource = false
    @State private var choosingAvatarFile = false
    @State private var choosingAvatarPhoto = false
    @State private var takingAvatarPhoto = false
    @State private var avatarPhoto: PhotosPickerItem?
    #endif

    init(sheet: AccountSheet, prefs: Record, avatar: NutriPlatformImage?, close: @escaping () -> Void, navigate: @escaping (AccountSheet) -> Void) {
        self.sheet = sheet
        self.avatar = avatar
        self.close = close
        self.navigate = navigate
        _profile = State(initialValue: prefs.object("profile"))
        _bands = State(initialValue: Self.initializedBands(prefs.object("adherence_bands")))
        _sleep = State(initialValue: prefs.number("sueno_umbral_h") ?? 6)
    }

    var body: some View {
        Group {
            switch sheet {
            case .config: configuration
            case .profile: profileSheet
            case .region: region
            case .password: PasswordEditor { navigate(.profile) }
            case .labels: MealLabelsView { navigate(.config) }
            case .wizard: TargetsWizardFromMenu(close: close)
            }
        }
        .disabled(busy)
        #if os(iOS)
        .confirmationDialog(store.tr("Foto de perfil"), isPresented: $choosingAvatarSource) {
            if nutriCameraAvailable {
                Button(store.lang == "en" ? "Take Photo" : "Tomar foto") { takingAvatarPhoto = true }
            }
            Button(store.lang == "en" ? "Photo Library" : "Fototeca") { choosingAvatarPhoto = true }
            Button(store.lang == "en" ? "Files" : "Archivos") { choosingAvatarFile = true }
        }
        .nutriCamera(isPresented: $takingAvatarPhoto) { result in
            do { try showAvatarCrop(result.get()) }
            catch { store.report(error) }
        }
        .photosPicker(isPresented: $choosingAvatarPhoto, selection: $avatarPhoto, matching: .images)
        .task(id: avatarPhoto) {
            guard let photo = avatarPhoto else { return }
            defer { if avatarPhoto == photo { avatarPhoto = nil } }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else {
                    throw NutriError("No se pudo abrir la imagen.")
                }
                guard !Task.isCancelled else { return }
                try showAvatarCrop(jpegData(data, maxSide: 2048))
            } catch {
                if !Task.isCancelled { store.report(error) }
            }
        }
        .nutriFilePicker(isPresented: $choosingAvatarFile, types: [.image]) { result in
            do {
                if let file = try result.get().first {
                    try showAvatarCrop(jpegData(file, maxSide: 2048))
                }
            } catch { store.report(error) }
        }
        #endif
    }

    private var configuration: some View {
        NutriSheet(store.tr("Configuración"), close: close) {
            VStack(alignment: .leading, spacing: 12) {
                caption("Adherencia")
                Text(store.tr("Rango de gracia por arquetipo. Afecta los colores de Hoy y Dashboard."))
                    .font(.nutriSans(12)).foregroundStyle(palette.text3)
                    .padding(.top, -6)
                bandSection("Kcal", tag: "diana", color: palette.kcal) {
                    pillSelector([("default", "Sin régimen"), ("deficit", "Déficit"), ("volumen", "Volumen"),
                                  ("mantenimiento", "Mant."), ("recomposicion", "Recomp.")], selected: regimen) {
                        regimen = $0
                    }
                    slider("En meta · defecto", kind: "diana", key: "okUnder")
                    slider("En meta · exceso", kind: "diana", key: "okOver")
                    slider("Aviso · defecto", kind: "diana", key: "warnUnder")
                    slider("Aviso · exceso", kind: "diana", key: "warnOver")
                }
                bandSection("Carbs · Grasa", tag: "rango", color: palette.carbs) {
                    slider("En meta", kind: "rango", key: "ok")
                    slider("Aviso", kind: "rango", key: "warn", max: 60)
                }
                bandSection("Límites (grasa sat., azúcar añadido…)", tag: "techo", color: palette.danger) {
                    slider("Holgura sobre el techo antes del aviso", kind: "techo", key: "warn", max: 30)
                }
                settingInfo("lock", title: "Sodio", subtitle: "Piso médico fijo, no configurable.") {
                    Text("1500–2300 mg").font(.nutriMono(13)).foregroundStyle(palette.text2)
                }
                settingInfo("moon", title: "Sueño", subtitle: "Umbral del checkpoint de Medidas: “dormí menos de N horas”.") {
                    HStack(spacing: 4) {
                        sleepBump(-0.5, icon: "minus", label: "Menos")
                        Text("\(numberText(sleep, digits: 1)) h").font(.nutriMono(14)).frame(width: 50)
                        sleepBump(0.5, icon: "plus", label: "Más")
                    }
                }
                Rectangle().fill(palette.border).frame(height: 1)
                nextSheet("Secciones de comida", icon: "tags") { navigate(.labels) }
            }
        } footer: {
            HStack(spacing: 8) {
                Button {
                    bands = Self.initializedBands([:])
                } label: {
                    HStack(spacing: 8) {
                        NutriIcon("rotate-ccw", size: 16)
                        Text(store.tr("Restaurar"))
                    }
                }
                .buttonStyle(NutriButtonStyle(.secondary, height: 46, horizontal: 16))
                primary("Guardar") {
                    run {
                        try await store.patchPrefs(["adherence_bands": .object(bands), "sueno_umbral_h": .number(sleep)])
                        close()
                    }
                }
            }
        }
    }

    private var region: some View {
        NutriSheet(store.tr("Idioma y unidades"), close: close) {
            VStack(alignment: .leading, spacing: 12) {
                caption("Idioma")
                VStack(spacing: 8) {
                    language("es", flag: "🇲🇽", label: "Español")
                    language("en", flag: "🇺🇸", label: "English")
                }
                caption("Sistema de unidades").padding(.top, 8)
                pillSelector([("metric", "Métrico · g · ml"), ("us", "Imperial · oz · fl oz")], selected: store.units) { value in
                    run { try await store.setRegion("units", value) }
                }
                HStack {
                    Text(store.units == "us" ? "5.3 oz · 8.5 fl oz" : "150 g · 250 ml")
                    Spacer()
                    Text(store.tr(store.units == "us" ? "imperial" : "métrico")).foregroundStyle(palette.accentGlass)
                }
                .font(.nutriMono(13)).foregroundStyle(palette.text2)
                .padding(.horizontal, 16).frame(height: 42)
                .nutriCard(radius: 12, fill: .black.opacity(0.2))
            }
        } footer: {
            primary("Listo", action: close)
        }
    }

    private var profileSheet: some View {
        NutriSheet(store.tr("Perfil"), close: close, showsFooter: cropImage == nil) {
            if let image = cropImage {
                ProfileCropper(image: image, close: { cropImage = nil }) { data in
                    avatarData = data
                    removeAvatar = false
                    cropImage = nil
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 16) {
                        Button(action: chooseAvatar) {
                            NutriAvatar(image: displayedAvatar, size: 66)
                                .overlay(alignment: .bottomTrailing) {
                                    NutriIcon("camera", size: 14).foregroundStyle(palette.onAccent)
                                        .frame(width: 28, height: 28)
                                        .background(palette.accentDeep, in: Circle())
                                        .overlay { Circle().strokeBorder(palette.surface, lineWidth: 2) }
                                        .offset(x: 4, y: 4)
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(store.tr("Foto de perfil"))
                        .accessibilityIdentifier("profile.avatar")
                        #if os(iOS)
                        .disabled(avatarPhoto != nil)
                        #endif
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.tr("Foto de perfil")).font(.nutriDisplay(15, weight: .semibold))
                            Text(store.tr("Se usa como avatar del menú.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                            if !removeAvatar, avatarData != nil || !profile.text("avatar_path").isEmpty {
                                Button {
                                    removeAvatar = true
                                    avatarData = nil
                                } label: {
                                    HStack(spacing: 4) {
                                        NutriIcon("trash-2", size: 13)
                                        Text(store.tr("Quitar foto")).font(.nutriSans(12))
                                    }
                                    .frame(minHeight: nutriTouchSize(0))
                                    .contentShape(Rectangle())
                                    .foregroundStyle(palette.danger)
                                }.buttonStyle(.plain).padding(.top, 4)
                            }
                        }
                    }
                    HStack(spacing: 12) {
                        profileField("Nombre", key: "first_name", placeholder: "Bryan")
                        profileField("Segundo nombre", key: "middle_name", placeholder: "—")
                    }
                    profileField("Apellidos", key: "last_name", placeholder: "Rodríguez")
                    HStack(spacing: 12) {
                        profileField("Nacimiento", key: "dob", placeholder: "AAAA-MM-DD")
                            .overlay(alignment: .bottomTrailing) {
                                Button { choosingBirthDate.toggle() } label: {
                                    NutriIcon("calendar-days", size: 16).foregroundStyle(palette.text2)
                                        .frame(width: nutriTouchSize(32), height: nutriTouchSize(42))
                                        .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                                }
                                .buttonStyle(.plain).accessibilityLabel(store.tr("Elegir fecha"))
                                .padding(.trailing, 2)
                                .popover(isPresented: $choosingBirthDate, arrowEdge: .bottom) {
                                    DatePicker(store.tr("Nacimiento"), selection: Binding(get: {
                                        Day.date(profile.text("dob")) ?? Date.now
                                    }, set: { date in
                                        profile["dob"] = .string(Day.key(date))
                                        choosingBirthDate = false
                                    }), displayedComponents: .date)
                                    .datePickerStyle(.graphical).labelsHidden().padding(8)
                                }
                            }
                        profileField("Altura (cm)", key: "height_cm", placeholder: "178")
                    }
                    caption("Sexo")
                    pillSelector([("m", "Masculino"), ("f", "Femenino"), ("x", "Prefiero no decir")],
                                 selected: profile.text("sex")) { profile["sex"] = .string($0) }
                    Rectangle().fill(palette.border).frame(height: 1)
                    nextSheet("Cambiar contraseña", icon: "key-round") { navigate(.password) }
                }
            }
        } footer: {
            primary("Guardar perfil") { run(saveProfile) }
        }
    }

    private var displayedAvatar: NutriPlatformImage? {
        guard !removeAvatar else { return nil }
        return avatarData.flatMap(NutriPlatformImage.init(data:)) ?? avatar
    }

    private func language(_ key: String, flag: String, label: String) -> some View {
        let selected = store.lang == key
        return Button {
            run { try await store.setRegion("lang", key) }
        } label: {
            HStack(spacing: 12) {
                Text(flag).font(.nutriSans(18))
                Text(label).font(.nutriSans(14))
                Spacer()
                if selected { NutriIcon("check", size: 18).foregroundStyle(palette.accentGlass) }
            }
            .foregroundStyle(selected ? palette.text : palette.text2)
            .padding(.horizontal, 16).frame(height: 46)
            .background(selected ? palette.accentDeep.opacity(0.1) : .black.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? palette.accentDeep : palette.border) }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("region.language.\(key)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func profileField(_ label: String, key: String, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            caption(label).accessibilityHidden(true)
            TextField(store.tr(label), text: Binding(
                get: { profile[key]?.string ?? formText(profile.number(key)) },
                set: { profile[key] = .string($0) }
            ), prompt: Text(placeholder))
                .nutriKeyboard(key == "height_cm" ? .decimal : .text)
                .font(key == "dob" || key == "height_cm" ? .nutriMono(14) : .nutriSans(14))
                .nutriInput(height: nutriTouchSize(42))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func caption(_ text: String) -> some View {
        Text(store.tr(text).uppercased()).font(.nutriSans(11, weight: .medium))
            .tracking(0.28).foregroundStyle(palette.text3)
    }

    private func primary(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(store.tr(busy && sheet != .region ? "Guardando…" : label)).frame(maxWidth: .infinity)
        }
            .buttonStyle(NutriButtonStyle(.primary, height: 46))
    }

    private func nextSheet(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                NutriIcon(icon, size: 19)
                Text(store.tr(label)).foregroundStyle(palette.text)
                Spacer()
                Text("›").foregroundStyle(palette.text3)
            }
        }
        .buttonStyle(NutriButtonStyle(.quiet, height: 36, horizontal: 4))
    }

    private func pillSelector(_ options: [(String, String)], selected: String, select: @escaping (String) -> Void) -> some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.0) { key, label in
                Button { select(key) } label: {
                    Text(store.tr(label)).font(.nutriSans(options.count > 3 ? 11.5 : 13, weight: .medium))
                        .lineLimit(1).minimumScaleFactor(0.7).frame(maxWidth: .infinity)
                }
                .buttonStyle(NutriButtonStyle(selected == key ? .primary : .quiet, height: 29, horizontal: 2, radius: 8))
                .accessibilityAddTraits(selected == key ? .isSelected : [])
            }
        }
        .padding(4).nutriCard(radius: 12, fill: .black.opacity(0.25))
    }

    private func bandSection<T: View>(_ label: String, tag: String, color: Color, @ViewBuilder content: () -> T) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(store.tr(label)).font(.nutriDisplay(14, weight: .semibold))
                Text(store.tr(tag)).font(.nutriSans(10, weight: .semibold))
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .foregroundStyle(color).background(color.opacity(0.15), in: Capsule())
            }
            content()
        }
        .padding(16).nutriCard(fill: .black.opacity(0.15))
    }

    private func settingInfo<T: View>(_ icon: String, title: String, subtitle: String, @ViewBuilder content: () -> T) -> some View {
        HStack(spacing: 12) {
            NutriIcon(icon, size: 18).foregroundStyle(palette.text3)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.tr(title)).font(.nutriSans(13)).foregroundStyle(palette.text2)
                Text(store.tr(subtitle)).font(.nutriSans(11)).foregroundStyle(palette.text3)
            }
            Spacer(minLength: 0)
            content()
        }
        .padding(16).nutriCard(fill: .black.opacity(0.15))
    }

    private func sleepBump(_ hours: Double, icon: String, label: String) -> some View {
        Button { sleep = min(12, max(1, ((sleep + hours) * 2).rounded() / 2)) } label: {
            NutriIcon(icon, size: 16).frame(width: 44)
        }
        .buttonStyle(NutriButtonStyle(.secondary, horizontal: 0))
        .accessibilityLabel(store.tr(label))
    }

    private func slider(_ label: String, kind: String, key: String, max: Double = 50) -> some View {
        let group = bands.object(kind)
        let values = kind == "diana" ? group.object(regimen) : group
        let value = (100 * (values.number(key) ?? 0)).rounded()
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(store.tr(label)).font(.nutriSans(13)).foregroundStyle(palette.text2)
                Spacer()
                Text("±\(Int(value))%").font(.nutriMono(13))
            }
            Slider(value: Binding(get: { min(max, value) }, set: { changeBand(kind, key: key, point: $0 / 100) }),
                   in: 0...max, step: 1) { Text(store.tr(label)) }
                .labelsHidden().tint(palette.accent).controlSize(.small)
        }
    }

    private func changeBand(_ kind: String, key: String, point: Double) {
        var group = bands.object(kind)
        var values = kind == "diana" ? group.object(regimen) : group
        values[key] = .number(point)
        let pairs = kind == "diana" ? [("okUnder", "warnUnder"), ("okOver", "warnOver")] : kind == "rango" ? [("ok", "warn")] : []
        for (ok, warn) in pairs {
            values[warn] = .number(max(values.number(ok) ?? 0, values.number(warn) ?? 0))
        }
        if kind == "diana" { group[regimen] = .object(values) }
        else { group = values }
        bands[kind] = .object(group)
    }

    private static func initializedBands(_ overrides: Record) -> Record {
        var result = Domain.defaultBands
        for kind in ["rango", "techo"] {
            result[kind] = .object(result.object(kind).merging(overrides.object(kind)) { _, new in new })
        }
        var energies = result.object("diana")
        for key in energies.keys {
            energies[key] = .object(energies.object(key).merging(overrides.object("diana").object(key)) { _, new in new })
        }
        result["diana"] = .object(energies)
        return result
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action() }
            catch { store.report(error) }
        }
    }

    private func chooseAvatar() {
        #if os(macOS)
        guard let url = openFiles([.image]).first else { return }
        do { try showAvatarCrop(secureFileData(url)) }
        catch { store.report(error) }
        #else
        choosingAvatarSource = true
        #endif
    }

    private func showAvatarCrop(_ data: Data) throws {
        guard let image = NutriPlatformImage(data: data), image.size.width > 0, image.size.height > 0 else {
            throw NutriError("No se pudo abrir la imagen.")
        }
        cropImage = image
    }

    private func saveProfile() async throws {
        guard let owner = store.owner else { throw CancellationError() }
        var next = profile.filter { $0.value != .null && $0.value.string != "" }
        if let height = next["height_cm"]?.string {
            guard let value = decimal(height), value > 0 else { throw NutriError("Altura inválida.") }
            next["height_cm"] = .number(value)
        }
        if let birth = next["dob"]?.string, Day.date(birth) == nil { throw NutriError("Fecha de nacimiento inválida.") }
        let previous = profile.text("avatar_path")
        var uploaded: String?
        if let avatarData {
            let path = owner + "/avatar/" + UUID().uuidString.lowercased() + ".jpg"
            _ = try await store.storage("POST", "object/body-photos/" + path, body: avatarData, contentType: "image/jpeg")
            next["avatar_path"] = .string(path)
            uploaded = path
        }
        if removeAvatar { next.removeValue(forKey: "avatar_path") }
        do { try await store.patchPrefs(["profile": .object(next)]) }
        catch {
            if let uploaded, (error as? NutriError)?.permanentWriteFailure == true { try? await deleteAvatar(uploaded) }
            throw error
        }
        close()
        if !previous.isEmpty, previous != next.text("avatar_path") { try await deleteAvatar(previous) }
    }

    private func deleteAvatar(_ path: String) async throws {
        let body = try JSONEncoder().encode(["prefixes": [path]])
        _ = try await store.storage("DELETE", "object/body-photos", body: body, contentType: "application/json")
    }
}

private struct ProfileCropper: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let image: NutriPlatformImage
    let close: () -> Void
    let done: (Data) -> Void
    @State private var zoom = 1.0
    @State private var offset = CGSize.zero
    @GestureState private var drag = CGSize.zero
    private let side: CGFloat = 240

    private var scale: CGFloat { side / min(image.size.width, image.size.height) * zoom }
    private var size: CGSize { CGSize(width: image.size.width * scale, height: image.size.height * scale) }

    var body: some View {
        VStack(spacing: 12) {
            Image(nutriImage: image).resizable()
                .frame(width: size.width, height: size.height)
                .offset(clamp(CGSize(width: offset.width + drag.width, height: offset.height + drag.height)))
                .frame(width: side, height: side).clipped()
                .overlay {
                    Rectangle().fill(.black.opacity(0.55))
                        .mask { Rectangle().overlay { Circle().blendMode(.destinationOut) }.compositingGroup() }
                    Circle().strokeBorder(.white.opacity(0.8), lineWidth: 2)
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .gesture(DragGesture(minimumDistance: 0)
                    .updating($drag) { value, state, _ in state = value.translation }
                    .onEnded { value in
                        offset = clamp(CGSize(width: offset.width + value.translation.width, height: offset.height + value.translation.height))
                    })
            HStack(spacing: 10) {
                NutriIcon("zoom-in", size: 16).foregroundStyle(palette.text3)
                Slider(value: Binding(get: { zoom }, set: { next in
                    let factor = next / zoom
                    zoom = next
                    offset = clamp(CGSize(width: offset.width * factor, height: offset.height * factor))
                }), in: 1...3, step: 0.02) { Text(store.tr("Acercar")) }.labelsHidden()
            }
            Text(store.tr("Arrastra para reposicionar")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            HStack(spacing: 8) {
                Button(action: close) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.secondary))
                Button(action: bake) { Text(store.tr("Guardar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.primary))
            }
        }
    }

    private func clamp(_ point: CGSize) -> CGSize {
        let x = max(0, (size.width - side) / 2)
        let y = max(0, (size.height - side) / 2)
        return CGSize(width: min(x, max(-x, point.width)), height: min(y, max(-y, point.height)))
    }

    private func bake() {
        #if os(macOS)
        var source = CGRect(origin: .zero, size: image.size)
        let bitmap = image.cgImage(forProposedRect: &source, context: nil, hints: nil)
        #else
        let bitmap = image.cgImage
        #endif
        guard let cgImage = bitmap else {
            store.report(NutriError("No se pudo convertir la imagen."))
            return
        }
        let px = CGFloat(cgImage.width) / size.width
        let py = CGFloat(cgImage.height) / size.height
        let rect = CGRect(x: ((size.width - side) / 2 - offset.width) * px,
                          y: ((size.height - side) / 2 - offset.height) * py,
                          width: side * px, height: side * py)
        guard let crop = cgImage.cropping(to: rect.integral),
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: 512, height: 512, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
            store.report(NutriError("No se pudo convertir la imagen."))
            return
        }
        context.interpolationQuality = .high
        context.draw(crop, in: CGRect(x: 0, y: 0, width: 512, height: 512))
        guard let result = context.makeImage(), let data = jpegData(result, quality: 0.85) else {
            store.report(NutriError("No se pudo convertir la imagen."))
            return
        }
        done(data)
    }
}

private struct PasswordEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let close: () -> Void
    @State private var pwd = ""
    @State private var confirm = ""
    @State private var show = false
    @State private var showConfirm = false
    @State private var loading = false
    @State private var done = false
    @State private var error = ""

    var body: some View {
        NutriSheet(store.tr("Cambiar contraseña"), close: close) {
            if done {
                VStack(spacing: 10) {
                    NutriIcon("check", size: 40).foregroundStyle(palette.ok)
                    Text(store.tr("Contraseña actualizada")).font(.nutriDisplay(16))
                    Text(store.tr("Úsala la próxima vez que inicies sesión.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                }
                .padding(.vertical, 24).frame(maxWidth: .infinity)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        NutriIcon("lock", size: 18)
                        Text(store.tr("Cambia la contraseña de tu cuenta. Se aplica de inmediato."))
                            .font(.nutriSans(12))
                    }
                    .foregroundStyle(palette.text3).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .nutriCard(fill: .black.opacity(0.15))
                    field("Nueva contraseña", value: $pwd, showing: $show)
                    field("Confirmar contraseña", value: $confirm, showing: $showConfirm)
                    if !pwd.isEmpty && pwd.count < 6 {
                        Text(store.tr("Mínimo 6 caracteres")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                    }
                    if !confirm.isEmpty && confirm != pwd {
                        Text(store.tr("Las contraseñas no coinciden")).font(.nutriSans(14)).foregroundStyle(palette.danger)
                    }
                    if !error.isEmpty { Text(error).font(.nutriSans(14)).foregroundStyle(palette.danger) }
                }
            }
        } footer: {
            Button(action: submit) {
                Text(store.tr(done ? "Listo" : loading ? "Actualizando…" : "Actualizar contraseña"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(NutriButtonStyle(.primary, height: 46))
            .disabled(!done && (loading || pwd.count < 6 || pwd != confirm || store.anonymous || store.demoActive))
        }
    }

    private func field(_ title: String, value: Binding<String>, showing: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.tr(title).uppercased()).font(.nutriSans(11, weight: .medium))
                .foregroundStyle(palette.text3).accessibilityHidden(true)
            HStack(spacing: 0) {
                Group {
                    if showing.wrappedValue { TextField(store.tr(title), text: value, prompt: Text("")) }
                    else { SecureField(store.tr(title), text: value, prompt: Text("")) }
                }
                .textContentType(.newPassword).textFieldStyle(.plain).padding(.leading, 12)
                Button { showing.wrappedValue.toggle() } label: {
                    NutriIcon(showing.wrappedValue ? "eye-off" : "eye", size: 17).frame(width: nutriTouchSize(36))
                }
                .buttonStyle(NutriButtonStyle(.quiet, height: 36, horizontal: 0))
                .accessibilityLabel(store.tr(showing.wrappedValue ? "Ocultar contraseña" : "Mostrar contraseña"))
                .padding(.trailing, 4)
            }
            .font(.nutriSans(14)).frame(height: nutriTouchSize(42)).nutriCard(radius: 12, fill: .black.opacity(0.25))
        }
    }

    private func submit() {
        if done { close(); return }
        guard pwd.count >= 6, pwd == confirm, !loading else { return }
        loading = true
        error = ""
        Task {
            defer { loading = false }
            do {
                try await store.changePassword(pwd)
                done = true
                pwd = ""
                confirm = ""
            } catch {
                self.error = store.tr(error.localizedDescription.localizedCaseInsensitiveContains("different")
                    ? "La nueva contraseña debe ser distinta de la actual."
                    : "No se pudo actualizar la contraseña. Intenta de nuevo.")
            }
        }
    }
}
