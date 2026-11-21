import SwiftUI
import NutriCore

@main
struct NutriApplication {
    @MainActor
    static func main() {
        #if DEBUG && os(macOS)
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
    @StateObject private var store: Store
    @Environment(\.scenePhase) private var scenePhase
    #if DEBUG && os(iOS)
    private static let fixtureDefaultsName = "nutri.ios-ui-fixture"
    #endif

    init() {
        #if DEBUG && os(iOS)
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ios-ui-demo") {
            UserDefaults(suiteName: Self.fixtureDefaultsName)?.removePersistentDomain(forName: Self.fixtureDefaultsName)
            _store = StateObject(wrappedValue: Store(snapshot: DemoData(longJournal: arguments.contains("--ios-ui-long-journal"))))
            return
        }
        if arguments.contains("--ios-ui-login") {
            _store = StateObject(wrappedValue: Store(snapshot: nil))
            return
        }
        #endif
        _store = StateObject(wrappedValue: Store())
    }

    var body: some Scene {
        #if os(macOS)
        Window("Nutri", id: "main") {
            root.frame(minWidth: 375, minHeight: 570)
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
        #else
        WindowGroup {
            #if DEBUG
            if let fixtureDefaults {
                root.defaultAppStorage(fixtureDefaults)
            } else {
                root
            }
            #else
            root
            #endif
        }
        #endif
    }

    #if DEBUG && os(iOS)
    private var fixtureDefaults: UserDefaults? {
        guard ProcessInfo.processInfo.arguments.contains("--ios-ui-demo"),
              let defaults = UserDefaults(suiteName: Self.fixtureDefaultsName) else { return nil }
        return defaults
    }
    #endif

    private var root: some View {
        RootView()
            .environmentObject(store)
            .tint(nutriAccent)
            .preferredColorScheme(colorScheme)
            .environment(\.locale, Locale(identifier: store.lang == "en" ? "en_US" : "es_MX"))
            .task { await store.bootstrap() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { store.flush(resetBackoff: true) } }
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

    var accessibilityID: String {
        switch self {
        case .today: "module.today"
        case .foods: "module.foods"
        case .recipes: "module.recipes"
        case .targets: "module.targets"
        case .dashboard: "module.dashboard"
        case .body: "module.body"
        }
    }

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
    #if os(iOS)
    @State private var progressModule: Module = .dashboard
    @State private var phoneSheetVisible = false
    @State private var phoneActions: [Module: [NutriSectionAction]] = [:]
    #endif
    @State private var avatar: NutriPlatformImage?
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

    private var profileAvatar: NutriPlatformImage? {
        avatarPath == store.prefs.object("profile").text("avatar_path") ? avatar : nil
    }

    private var avatarUnavailable: Bool {
        avatarPath != nil && avatarPath == store.prefs.object("profile").text("avatar_path") && avatar == nil
    }

    var body: some View {
        GeometryReader { geometry in
            Group {
                if let owner = store.owner {
                    signedIn(width: geometry.size.width).id(owner).disabled(store.signingOut)
                } else {
                    LoginView()
                }
            }
            .environment(\.nutriWindowWidth, geometry.size.width)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(palette.text)
        .font(.nutriSans(16))
        .background { palette.bg.ignoresSafeArea() }
        .nutriKeyboardDismissal(store.tr("Listo"), isActive: showsRootPresentation)
        .nutriErrorAlert(store, isActive: showsRootPresentation)
        .onReceive(NotificationCenter.default.publisher(for: .nutriSettings)) { _ in openSettings(.config) }
        .onReceive(NotificationCenter.default.publisher(for: .nutriModule)) { notification in
            if let selected = notification.object as? Module { select(selected) }
        }
        .onChange(of: store.newFood) { _, food in if food != nil { select(.foods) } }
        .onChange(of: store.logFood) { _, food in if food != nil { select(.today) } }
        .onChange(of: store.owner) { _, _ in
            menu = nil
            settings = nil
            #if os(iOS)
            phoneActions = [:]
            progressModule = .dashboard
            phoneSheetVisible = false
            #endif
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

    private var showsRootPresentation: Bool {
        #if os(iOS)
        !phoneSheetVisible
        #else
        true
        #endif
    }

    #if os(iOS)
    private var phoneTab: Binding<Module> {
        Binding(get: { module == .body ? .dashboard : module }, set: { next in
            select(next == .dashboard ? progressModule : next)
        })
    }

    private var phoneTabs: some View {
        TabView(selection: phoneTab) {
            phonePage(.today, title: "Hoy") { TodayView() }
                .tabItem { Label(store.tr("Hoy"), systemImage: "calendar") }.tag(Module.today)
            phonePage(.foods, title: "Alimentos") { FoodsView() }
                .tabItem { Label(store.tr("Alimentos"), systemImage: "carrot") }.tag(Module.foods)
            phonePage(.recipes, title: "Recetas") { RecipesView() }
                .tabItem { Label(store.tr("Recetas"), systemImage: "book") }.tag(Module.recipes)
            phonePage(.targets, title: "Objetivos") { TargetsView() }
                .tabItem { Label(store.tr("Objetivos"), systemImage: "target") }.tag(Module.targets)
            phonePage(.dashboard, title: "Progreso") {
                PhoneProgressSections(section: Binding(get: { progressModule }, set: select)) {
                    phoneActions[.body] = $0
                }
            }
            .tabItem { Label(store.tr("Progreso"), systemImage: "chart.bar.xaxis") }.tag(Module.dashboard)
        }
    }

    @ViewBuilder
    private var phoneTabChrome: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            phoneTabs.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            phoneTabs
        }
        #else
        phoneTabs
        #endif
    }

    private func phonePage<Content: View>(_ tab: Module, title: String, @ViewBuilder content: () -> Content) -> some View {
        let active = phoneTab.wrappedValue == tab
        let sectionActions = phoneActions[tab == .dashboard && module == .body ? .body : tab] ?? []
        return NavigationStack {
            VStack(spacing: 0) {
                if store.anonymous || store.demoActive { demoStrip }
                if store.outdated { outdatedStrip }
                // Keep the tab shell's SwiftUI metadata shallow when composing complex screens.
                AnyView(content())
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .environment(\.nutriSectionActionsHandler) { phoneActions[tab] = $0 }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        if !(tab == .today && phoneSheetVisible), store.undoTitle != nil || store.notice != nil {
                            notification.padding(.horizontal, 16).padding(.vertical, 4)
                        }
                    }
            }
            .background(palette.bg)
            .accessibilityHidden(scrimVisible || menu != nil)
            .navigationTitle(tab == .today ? "" : store.tr(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 0) {
                        if store.offline || store.pending > 0 { syncStatus }
                        if !sectionActions.isEmpty {
                            Button { toggleMenu(.more) } label: {
                                Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(store.tr("Más opciones"))
                            .accessibilityIdentifier("module.more")
                        }
                        Button { toggleMenu(.account) } label: {
                            NutriAvatar(image: profileAvatar, size: 28)
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(store.tr("Menú de usuario"))
                        .accessibilityIdentifier("account.menu")
                        .accessibilityHint(avatarUnavailable ? store.tr("Foto no disponible") : "")
                    }
                }
            }
        }
        .transformPreference(NutriPhoneSheetVisibleKey.self) { if !active { $0 = false } }
        .transformPreference(NutriModalVisibleKey.self) { if !active { $0 = false } }
        .transformPreference(NutriPresentedModalKey.self) { if !active { $0 = nil } }
    }
    #endif

    private func signedIn(width: CGFloat) -> some View {
        let phone = nutriPhoneLayout
        let wide = !phone && width >= 768
        return ZStack {
            signedInContent(width: width, wide: wide)
                .blur(radius: scrimVisible && !reduceTransparency ? 4 : 0)
                .accessibilityHidden(scrimVisible || phone && menu != nil)
                .allowsHitTesting(!scrimVisible && (!phone || menu == nil))
                .environment(\.nutriHasAccountOverlay, settings != nil || menu != nil)
                .onPreferenceChange(NutriModalVisibleKey.self) { moduleModalVisible = $0 }
                #if os(iOS)
                .onPreferenceChange(NutriPhoneSheetVisibleKey.self) { phoneSheetVisible = $0 }
                #endif
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
                    .padding(.top, popupTopInset(phone: phone, wide: wide, menu: menu))
            }
            if let settings {
                NutriModal(close: closeActiveSettings, maxWidth: settings == .labels ? 384 : 448) {
                    SettingsView(sheet: settings, prefs: store.prefs, avatar: profileAvatar, close: closeSettings, navigate: openSettings)
                        .id(settings == .labels ? .config : settings == .password ? .profile : settings)
                }
            }
        }
    }

    @ViewBuilder
    private func signedInContent(width: CGFloat, wide: Bool) -> some View {
        #if os(iOS)
        if nutriPhoneLayout {
            phoneTabChrome
        } else {
            windowJournal(width: width, wide: wide)
        }
        #else
        windowJournal(width: width, wide: wide)
        #endif
    }

    private func windowJournal(width: CGFloat, wide: Bool) -> some View {
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
    }

    private func popupTopInset(phone: Bool, wide: Bool, menu: Popup) -> CGFloat {
        if wide { return 0 }
        if phone { return 52 }
        return (store.anonymous || store.demoActive ? 44 : 0) + (menu == .account ? 72 : 68)
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
                    .accessibilityIdentifier(item.accessibilityID)
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
                    .accessibilityIdentifier("module.more")
                }
                Button { toggleMenu(.account) } label: {
                    HStack(spacing: 12) {
                        NutriAvatar(image: profileAvatar, size: 26)
                        Text(displayName).lineLimit(1)
                        Spacer()
                    }
                }
                .accessibilityLabel(store.tr("Menú de usuario"))
                .accessibilityIdentifier("account.menu")
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
                Button { toggleMenu(.more) } label: { NutriIcon("ellipsis").frame(width: nutriTouchSize(36)) }
                    .buttonStyle(NutriButtonStyle(.quiet, height: 36, horizontal: 0))
                    .accessibilityLabel(store.tr("Más opciones"))
                    .accessibilityIdentifier("module.more")
            }
            Button { toggleMenu(.account) } label: {
                NutriAvatar(image: profileAvatar, size: 32).padding(4)
                    .frame(minWidth: nutriTouchSize(40), minHeight: nutriTouchSize(40))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.tr("Menú de usuario"))
            .accessibilityIdentifier("account.menu")
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
                .accessibilityIdentifier(item.accessibilityID)
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
        #if os(iOS)
        let message = "Hay una actualización de Nutri para iPhone. Instala la versión más reciente desde Xcode."
        #else
        let message = "Nutri para Mac está desactualizada respecto a la web. Recompílala e instálala con macos/scripts/build-app.sh e install-app.sh."
        #endif
        return Text(store.tr(message))
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
                Button { store.flush(resetBackoff: true) } label: {
                    NutriIcon(store.offline ? "cloud-off" : "loader-circle", size: 16)
                        .foregroundStyle(palette.text2)
                        .frame(width: nutriTouchSize(28), height: nutriTouchSize(28))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(help)
                .help(help)
            }
        }
        .frame(width: nutriTouchSize(28), height: nutriTouchSize(28))
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

    private var notification: some View { NutriUndoNotice() }

    private var popupActions: [NutriSectionAction] {
        #if os(iOS)
        if nutriPhoneLayout { return phoneActions[module] ?? [] }
        #endif
        return actions
    }

    @ViewBuilder
    private func popup(_ item: Popup) -> some View {
        switch item {
        case .more:
            VStack(spacing: 0) {
                ForEach(popupActions) { action in
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
                    .accessibilityIdentifier("account.profile")
                menuButton("Idioma y unidades", icon: "globe") { openSettings(.region) }
                    .accessibilityIdentifier("account.region")
                menuButton("Configuración", icon: "sliders-horizontal") { openSettings(.config) }
                    .accessibilityIdentifier("account.config")
                menuButton("Asistente de metas", icon: "wand-sparkles") {
                    openSettings(.wizard)
                }
                .accessibilityIdentifier("account.wizard")
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
        #if os(iOS)
        if next == .dashboard || next == .body { progressModule = next }
        #endif
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
        avatar = data.flatMap(NutriPlatformImage.init(data:))
        avatarPath = path
    }
}

#if os(iOS)
private struct PhoneProgressSections: View {
    @EnvironmentObject private var store: Store
    @Binding var section: Module
    let bodyActions: ([NutriSectionAction]) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Picker(store.tr("Progreso"), selection: $section) {
                Text(store.tr("Dashboard")).tag(Module.dashboard)
                Text(store.tr("Medidas")).tag(Module.body)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .accessibilityIdentifier("progress.sections")
            if section == .body {
                BodyView().environment(\.nutriSectionActionsHandler, bodyActions)
            } else {
                DashboardView()
            }
        }
    }
}
#endif

struct NutriUndoNotice: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette

    var body: some View {
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
}

struct NutriAvatar: View {
    var image: NutriPlatformImage?
    let size: CGFloat
    var login = false

    var body: some View {
        if let image = image ?? NutriIcon.assets[login ? "nutri-login-logo" : "nutri-logo"] {
            Image(nutriImage: image).resizable().scaledToFill()
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
        #if os(iOS)
        GeometryReader { geometry in
            ScrollView {
                form
                    .padding(.vertical, 24)
                    .frame(minHeight: geometry.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        #else
        form.frame(maxHeight: .infinity)
        #endif
    }

    private var form: some View {
        VStack(spacing: 32) {
            VStack(spacing: 12) {
                NutriAvatar(image: nil, size: 72, login: true)
                (Text("nutri") + Text(".").foregroundColor(palette.accent))
                    .font(.nutriDisplay(20)).tracking(-0.5)
            }
            VStack(alignment: .leading, spacing: 16) {
                field("Email") {
                    TextField("Email", text: $email, prompt: Text(""))
                        .textContentType(.username)
                        #if os(iOS)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        #endif
                        .nutriInput()
                        .accessibilityIdentifier("login.email")
                }
                field(store.tr("Contraseña")) {
                    SecureField(store.tr("Contraseña"), text: $password, prompt: Text("")).textContentType(.password)
                        .nutriInput()
                        .accessibilityIdentifier("login.password")
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
                .accessibilityIdentifier("login.submit")
                .disabled(submitting || demoSubmitting)
                Button(action: enterDemo) {
                    Text(store.tr(demoSubmitting ? "Preparando demo…" : "Explorar la demo")).font(.nutriSans(16, weight: .medium))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(NutriButtonStyle(.secondary))
                .accessibilityIdentifier("login.demo")
                .disabled(submitting || demoSubmitting)
            }
            .frame(maxWidth: 320)
            .onSubmit(signIn)
            if let url = URL(string: "https://nutri.vryahn.com/about/") {
                Link(store.tr("Conoce el proyecto") + " →", destination: url)
                    .font(.nutriSans(14)).foregroundStyle(palette.text3).padding(.top, 20)
            }
            #if DEBUG
            Button { store.activateDemo() } label: {
                Text(store.tr("Probar con datos locales")).font(.nutriSans(12))
                    .frame(minHeight: nutriTouchSize(0)).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            #endif
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
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
