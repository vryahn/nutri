import SwiftUI
import NutriCore

@main
struct NutriApplication {
    @MainActor
    static func main() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--module-checks") {
            do {
                try runModuleChecks()
                print("Nutri module checks passed.")
                return
            } catch {
                FileHandle.standardError.write(Data("Nutri module checks failed: \(error.localizedDescription)\n".utf8))
                exit(1)
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--snapshot-checks") {
            runSnapshotChecks()
            return
        }
        #endif
        NutriApp.main()
    }
}

struct NutriApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        Window("Nutri", id: "main") {
            RootView()
                .environmentObject(store)
                .tint(nutriAccent)
                .preferredColorScheme(colorScheme)
                .environment(\.locale, Locale(identifier: store.lang == "en" ? "en_US" : "es_MX"))
                .frame(minWidth: 375, minHeight: 570)
                .task { await store.bootstrap() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { store.flush() } }
        }
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button(store.tr("Configuración")) { NotificationCenter.default.post(name: .nutriSettings, object: nil) }
                    .keyboardShortcut(",").disabled(store.owner == nil)
            }
            CommandGroup(after: .sidebar) {
                ForEach(Array(Module.allCases.enumerated()), id: \.element) { index, module in
                    Button(store.tr(module.rawValue)) {
                        NotificationCenter.default.post(name: .nutriModule, object: module)
                    }
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                    .disabled(store.owner == nil)
                }
            }
        }
    }

    private var colorScheme: ColorScheme? {
        switch store.theme {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
}

extension Notification.Name {
    static let nutriSettings = Notification.Name("nutri.showSettings")
    static let nutriModule = Notification.Name("nutri.selectModule")
    static let nutriTargetsWizard = Notification.Name("nutri.targetsWizard")
}

enum Module: String, CaseIterable, Identifiable {
    case today = "Hoy", foods = "Alimentos", recipes = "Recetas", targets = "Objetivos", dashboard = "Dashboard", body = "Medidas"
    var id: Self { self }

    var icon: String {
        switch self {
        case .today: "calendar-days"
        case .foods: "apple"
        case .recipes: "chef-hat"
        case .targets: "target"
        case .dashboard: "bar-chart-3"
        case .body: "ruler"
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var module: Module
    @State private var settings: AccountSheet?
    @State private var menu: Popup?
    @State private var moduleModalVisible = false
    @State private var actions: [NutriSectionAction] = []
    @State private var avatar: NSImage?
    @State private var avatarPath: String?

    init(initialModule: Module = .today) {
        _module = State(initialValue: initialModule)
    }

    private enum Popup { case account, more }

    private var displayName: String {
        let profile = store.prefs.object("profile")
        let name = [profile.text("first_name"), profile.text("last_name")]
            .filter { !$0.isEmpty }.joined(separator: " ")
        return name.isEmpty ? store.tr("Tu perfil") : name
    }

    private var profileAvatar: NSImage? {
        avatarPath == store.prefs.object("profile").text("avatar_path") ? avatar : nil
    }

    private var avatarUnavailable: Bool {
        avatarPath != nil && avatarPath == store.prefs.object("profile").text("avatar_path") && avatar == nil
    }

    var body: some View {
        GeometryReader { geometry in
            Group {
                if let owner = store.owner {
                    journal(width: geometry.size.width)
                        .id(owner).disabled(store.signingOut)
                } else {
                    LoginView()
                }
            }
            .environment(\.nutriWindowWidth, geometry.size.width)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(palette.text)
        .font(.nutriSans(16))
        .background(palette.bg)
        .alert(store.tr("Error de Nutri"), isPresented: Binding(
            get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button(store.tr("Cerrar"), role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: .nutriSettings)) { _ in openSettings(.config) }
        .onReceive(NotificationCenter.default.publisher(for: .nutriModule)) { notification in
            if let selected = notification.object as? Module { select(selected) }
        }
        .onChange(of: store.newFood) { _, food in if food != nil { select(.foods) } }
        .onChange(of: store.logFood) { _, food in if food != nil { select(.today) } }
        .onChange(of: store.owner) { _, _ in
            menu = nil
            settings = nil
            select(.today)
        }
        .task(id: store.prefs.object("profile").text("avatar_path")) { await loadAvatar() }
        #if DEBUG
        .task {
            switch store.snapshotScenario {
            case "settings-profile": settings = .profile
            case "settings-region": settings = .region
            case "settings-config": settings = .config
            case "settings-menu": menu = .account
            default: break
            }
        }
        #endif
    }

    private func journal(width: CGFloat) -> some View {
        let wide = width >= 768
        return ZStack {
            HStack(spacing: 0) {
                if wide { sidebar }
                VStack(spacing: 0) {
                    if store.anonymous || store.demoActive { demoStrip }
                    if store.outdated { outdatedStrip }
                    if !wide { mobileHeader }
                    activeModule
                        .frame(maxWidth: module == .dashboard && wide ? 1600 : width >= 1024 ? 1152 : 768)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .padding(.top, wide ? 24 : 0)
                        .environment(\.nutriSectionActionsHandler) { actions = $0 }
                        .overlay(alignment: width >= 1024 ? .bottomTrailing : .bottom) {
                            notification
                                .padding(.horizontal, width >= 1024 ? 24 : 16)
                                .padding(.bottom, width >= 1024 ? 24 : wide ? 96 : 36)
                        }
                    if !wide { mobileTabs }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .blur(radius: scrimVisible && !reduceTransparency ? 4 : 0)
            .accessibilityHidden(scrimVisible)
            .allowsHitTesting(!scrimVisible)
            .environment(\.nutriHasAccountOverlay, settings != nil || menu != nil)
            .onPreferenceChange(NutriModalVisibleKey.self) { moduleModalVisible = $0 }
            .overlayPreferenceValue(NutriPresentedModalKey.self) { modal in
                if let modal {
                    NutriModal(close: modal.close, maxWidth: modal.maxWidth,
                               scrimOpacity: modal.scrimOpacity, fullscreen: modal.fullscreen) {
                        modal.content.id(modal.id)
                    }
                }
            }
            if let menu {
                Color.clear.contentShape(Rectangle()).onTapGesture { self.menu = nil }.accessibilityHidden(true)
                popup(menu)
                    .frame(maxWidth: .infinity, maxHeight: .infinity,
                           alignment: wide ? .bottomLeading : .topTrailing)
                    .padding(.leading, wide ? (menu == .account ? 204 : 200) : 0)
                    .padding(.trailing, wide ? 0 : (menu == .account ? 16 : 58))
                    .padding(.bottom, wide ? (menu == .account ? 16 : 64) : 0)
                    .padding(.top, wide ? 0 : ((store.anonymous || store.demoActive ? 44 : 0) + (menu == .account ? 72 : 68)))
            }
            if let settings {
                NutriModal(close: closeActiveSettings, maxWidth: settings == .labels ? 384 : 448) {
                    SettingsView(sheet: settings, prefs: store.prefs, avatar: profileAvatar, close: closeSettings, navigate: openSettings)
                        .id(settings == .labels ? .config : settings == .password ? .profile : settings)
                }
            }
        }
    }

    private var scrimVisible: Bool { settings != nil || moduleModalVisible }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                wordmark()
                Spacer()
                syncStatus
            }
            .frame(height: 28)
            .padding(.horizontal, 8).padding(.bottom, 16)
            VStack(spacing: 4) {
                ForEach(Module.allCases) { item in
                    Button { select(item) } label: {
                        HStack(spacing: 12) {
                            NutriIcon(item.icon)
                            Text(store.tr(item.rawValue)).font(.nutriSans(14))
                        }
                        .foregroundStyle(module == item ? palette.accent : palette.text2)
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .background(module == item ? palette.surface2 : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(module == item ? .isSelected : [])
                }
            }
            Spacer()
            Rectangle().fill(palette.border).frame(height: 1)
            VStack(spacing: 4) {
                if !actions.isEmpty {
                    Button { toggleMenu(.more) } label: {
                        HStack(spacing: 12) {
                            NutriIcon("ellipsis")
                            Text(store.tr("Más opciones"))
                            Spacer()
                        }
                    }
                    .buttonStyle(NutriButtonStyle(.quiet, radius: 8))
                }
                Button { toggleMenu(.account) } label: {
                    HStack(spacing: 12) {
                        NutriAvatar(image: profileAvatar, size: 26)
                        Text(displayName).lineLimit(1)
                        Spacer()
                    }
                }
                .accessibilityLabel(store.tr("Menú de usuario"))
                .accessibilityHint(avatarUnavailable ? store.tr("Foto no disponible") : "")
                .help(avatarUnavailable ? store.tr("Foto no disponible") : store.tr("Menú de usuario"))
                .buttonStyle(NutriButtonStyle(.quiet, radius: 8))
            }
            .padding(.top, 8)
        }
        .padding(.horizontal, 12).padding(.vertical, 16)
        .frame(width: 208)
        .background(palette.surface)
        .overlay(alignment: .trailing) { Rectangle().fill(palette.border).frame(width: 1) }
    }

    private var mobileHeader: some View {
        HStack {
            wordmark(glass: true)
            Spacer()
            syncStatus
            if !actions.isEmpty {
                Button { toggleMenu(.more) } label: { NutriIcon("ellipsis").frame(width: 36) }
                    .buttonStyle(NutriButtonStyle(.quiet, height: 36, horizontal: 0))
                    .accessibilityLabel(store.tr("Más opciones"))
            }
            Button { toggleMenu(.account) } label: {
                NutriAvatar(image: profileAvatar, size: 32).padding(4)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.tr("Menú de usuario"))
            .accessibilityHint(avatarUnavailable ? store.tr("Foto no disponible") : "")
            .help(avatarUnavailable ? store.tr("Foto no disponible") : store.tr("Menú de usuario"))
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .nutriGlass(radius: 0)
    }

    private var mobileTabs: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Module.allCases) { item in
                Button { select(item) } label: {
                    VStack(spacing: 2) {
                        NutriIcon(item.icon, size: 22)
                        Text(store.tr(item.rawValue)).font(.nutriSans(12)).lineLimit(1).minimumScaleFactor(0.72)
                        if module == item {
                            Capsule().fill(palette.accentGlass).frame(width: 24, height: 2)
                        }
                    }
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .top)
                    .foregroundStyle(module == item ? palette.accentGlass : palette.text2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(module == item ? .isSelected : [])
            }
        }
        .nutriGlass(radius: 0)
    }

    private var demoStrip: some View {
        HStack(spacing: 8) {
            Text(store.tr("Demo con datos de ejemplo — los cambios se borran solos."))
            Spacer()
            Button(action: signOut) { Text(store.tr("Salir")).underline() }
                .buttonStyle(.plain).padding(.horizontal, 8).frame(minHeight: 44)
        }
        .foregroundStyle(palette.text2).font(.nutriSans(12))
        .padding(.horizontal, 16).background(palette.surface2)
        .overlay(alignment: .bottom) { Rectangle().fill(palette.border).frame(height: 1) }
    }

    private var outdatedStrip: some View {
        Text(store.tr("Nutri para Mac está desactualizada respecto a la web. Recompílala e instálala con macos/scripts/build-app.sh e install-app.sh."))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .foregroundStyle(palette.warn).font(.nutriSans(12))
            .padding(.horizontal, 16).background(palette.surface2)
            .overlay(alignment: .bottom) { Rectangle().fill(palette.border).frame(height: 1) }
    }

    private var syncStatus: some View {
        Group {
            if store.offline || store.pending > 0 {
                let state = store.tr(store.offline ? "Sin conexión" : "Sincronizando")
                let count = store.pending > 0 ? " · \(store.pending) \(store.tr("pendientes"))" : ""
                let retry = store.tr("Reintentar")
                let help = "\(state)\(count) · \(retry)"
                Button(action: store.flush) {
                    NutriIcon(store.offline ? "cloud-off" : "loader-circle", size: 16)
                        .foregroundStyle(palette.text2)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(help)
                .help(help)
            }
        }
        .frame(width: 28, height: 28)
    }

    @ViewBuilder
    private var activeModule: some View {
        switch module {
        case .today: TodayView()
        case .foods: FoodsView()
        case .recipes: RecipesView()
        case .targets: TargetsView()
        case .dashboard: DashboardView()
        case .body: BodyView()
        }
    }

    @ViewBuilder
    private var notification: some View {
        if let message = store.undoTitle ?? store.notice {
            HStack(spacing: 12) {
                Text(message).fixedSize(horizontal: false, vertical: true)
                if store.undoTitle != nil {
                    Button(store.tr("Deshacer"), action: store.performUndo)
                        .buttonStyle(NutriButtonStyle(.quiet, height: 32))
                        .foregroundStyle(palette.accent)
                        .fixedSize()
                }
            }
            .font(.nutriSans(14)).padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: 384)
            .nutriCard(radius: 12, fill: palette.surface3)
        }
    }

    @ViewBuilder
    private func popup(_ item: Popup) -> some View {
        switch item {
        case .more:
            VStack(spacing: 0) {
                ForEach(actions) { action in
                    Button {
                        menu = nil
                        action.action()
                    } label: {
                        HStack(spacing: 8) {
                            NutriIcon(action.icon, size: 18)
                            Text(action.label)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(NutriButtonStyle(.quiet, height: 36, radius: 8))
                    .disabled(!action.enabled)
                }
            }
            .frame(minWidth: 176, maxWidth: 235)
            .padding(4)
            .nutriGlass(radius: 12)
            .shadow(color: .black.opacity(0.24), radius: 8, y: 4)
        case .account:
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    NutriAvatar(image: profileAvatar, size: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName).font(.nutriDisplay(15, weight: .semibold)).lineLimit(1)
                        if !store.email.isEmpty {
                            Text(store.email).font(.nutriMono(11)).foregroundStyle(palette.text3).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                HStack(spacing: 4) {
                    themeButton("system", label: "Auto", icon: "monitor")
                    themeButton("light", label: "Claro", icon: "sun")
                    themeButton("dark", label: "Oscuro", icon: "moon")
                }
                .padding(4).background(.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 4).padding(.bottom, 6)
                menuRule
                menuButton("Perfil", icon: "user") { openSettings(.profile) }
                menuButton("Idioma y unidades", icon: "globe") { openSettings(.region) }
                menuButton("Configuración", icon: "sliders-horizontal") { openSettings(.config) }
                menuButton("Asistente de metas", icon: "wand-sparkles") {
                    openSettings(.wizard)
                }
                menuRule
                menuButton("Cerrar sesión", icon: "log-out", danger: true, action: signOut)
            }
            .padding(6).frame(width: 256)
            .nutriGlass()
            .shadow(color: .black.opacity(0.24), radius: 8, y: 4)
        }
    }

    private var menuRule: some View {
        Rectangle().fill(palette.border).frame(height: 1).padding(4)
    }

    private func themeButton(_ mode: String, label: String, icon: String) -> some View {
        Button { store.theme = mode } label: {
            HStack(spacing: 6) {
                NutriIcon(icon, size: 14)
                Text(store.tr(label)).font(.nutriSans(11.5, weight: .medium))
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(NutriButtonStyle(store.theme == mode ? .primary : .quiet, height: 28, horizontal: 4, radius: 8))
        .accessibilityAddTraits(store.theme == mode ? .isSelected : [])
    }

    private func menuButton(_ label: String, icon: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                NutriIcon(icon, size: 19)
                Text(store.tr(label)).foregroundStyle(danger ? palette.danger : palette.text)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(NutriButtonStyle(danger ? .danger : .quiet, height: 39, horizontal: 10, radius: 8))
    }

    private func wordmark(glass: Bool = false) -> some View {
        (Text("nutri") + Text(".").foregroundColor(glass ? palette.accentGlass : palette.accent))
            .font(.nutriDisplay(18))
    }

    private func select(_ next: Module) {
        guard next != module else { return }
        actions = []
        menu = nil
        module = next
    }

    private func toggleMenu(_ next: Popup) { menu = menu == next ? nil : next }

    private func openSettings(_ next: AccountSheet) {
        menu = nil
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { settings = next }
    }

    private func closeActiveSettings() {
        if settings == .password { openSettings(.profile) }
        else if settings == .labels { openSettings(.config) }
        else { closeSettings() }
    }

    private func closeSettings() {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) { settings = nil }
    }

    private func signOut() {
        menu = nil
        Task {
            do { try await store.signOut() }
            catch { store.report(error) }
        }
    }

    private func loadAvatar() async {
        let path = store.prefs.object("profile").text("avatar_path")
        guard !path.isEmpty else {
            avatar = nil
            avatarPath = nil
            return
        }
        let data = try? await store.storage("GET", "object/authenticated/body-photos/" + path)
        guard !Task.isCancelled else { return }
        avatar = data.flatMap(NSImage.init(data:))
        avatarPath = path
    }
}

struct NutriAvatar: View {
    var image: NSImage?
    let size: CGFloat
    var login = false

    var body: some View {
        if let image = image ?? NutriIcon.assets[login ? "nutri-login-logo" : "nutri-logo"] {
            Image(nsImage: image).resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(login ? AnyShape(RoundedRectangle(cornerRadius: size * 96 / 512)) : AnyShape(Circle()))
                .accessibilityHidden(true)
        }
    }
}

private struct LoginView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State private var email = ""
    @State private var password = ""
    @State private var error = ""
    @State private var submitting = false
    @State private var demoSubmitting = false

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 12) {
                NutriAvatar(image: nil, size: 72, login: true)
                (Text("nutri") + Text(".").foregroundColor(palette.accent))
                    .font(.nutriDisplay(20)).tracking(-0.5)
            }
            VStack(alignment: .leading, spacing: 16) {
                field("Email") {
                    TextField("Email", text: $email, prompt: Text("")).textContentType(.username)
                        .nutriInput()
                }
                field(store.tr("Contraseña")) {
                    SecureField(store.tr("Contraseña"), text: $password, prompt: Text("")).textContentType(.password)
                        .nutriInput()
                }
                if !error.isEmpty {
                    Text(error).font(.nutriSans(14)).foregroundStyle(palette.danger)
                }
                Button(action: signIn) {
                    Text(store.tr(submitting ? "Entrando…" : "Entrar")).font(.nutriSans(16, weight: .medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NutriButtonStyle(.primary))
                .keyboardShortcut(.defaultAction)
                .disabled(submitting || demoSubmitting)
                Button(action: enterDemo) {
                    Text(store.tr(demoSubmitting ? "Preparando demo…" : "Explorar la demo")).font(.nutriSans(16, weight: .medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NutriButtonStyle(.secondary))
                .disabled(submitting || demoSubmitting)
            }
            .frame(maxWidth: 320)
            .onSubmit(signIn)
            if let url = URL(string: "https://nutri.vryahn.com/about/") {
                Link(store.tr("Conoce el proyecto") + " →", destination: url)
                    .font(.nutriSans(14)).foregroundStyle(palette.text3).padding(.top, 20)
            }
            #if DEBUG
            Button(store.tr("Probar con datos locales")) { store.activateDemo() }.buttonStyle(.plain).font(.nutriSans(12))
            #endif
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func field<T: View>(_ label: String, @ViewBuilder content: () -> T) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.nutriSans(14)).foregroundStyle(palette.text2).accessibilityHidden(true)
            content()
        }
    }

    private func signIn() {
        guard !submitting, !demoSubmitting else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard address.contains("@"), !password.isEmpty else {
            error = store.tr("Email o contraseña incorrectos.")
            return
        }
        submitting = true
        error = ""
        Task {
            defer { submitting = false }
            do { try await store.signIn(address, password); password = "" }
            catch { self.error = store.tr("Email o contraseña incorrectos.") }
        }
    }

    private func enterDemo() {
        guard !submitting, !demoSubmitting else { return }
        demoSubmitting = true
        error = ""
        Task {
            defer { demoSubmitting = false }
            do { try await store.activateRemoteDemo() }
            catch { self.error = error.localizedDescription }
        }
    }
}
