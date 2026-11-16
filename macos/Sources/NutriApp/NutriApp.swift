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
                .frame(minWidth: 780, minHeight: 570)
                .task { await store.bootstrap() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { store.flush() } }
        }
        .defaultSize(width: 1140, height: 780)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button(store.tr("Ajustes…")) { NotificationCenter.default.post(name: .nutriSettings, object: nil) }
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
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
}

private extension Notification.Name {
    static let nutriSettings = Notification.Name("nutri.showSettings")
    static let nutriModule = Notification.Name("nutri.selectModule")
}

private enum Module: String, CaseIterable, Identifiable {
    case today = "Hoy", foods = "Alimentos", recipes = "Recetas", targets = "Objetivos", dashboard = "Dashboard", body = "Medidas"
    var id: Self { self }

    var icon: String {
        switch self {
        case .today: "book.closed"
        case .foods: "carrot"
        case .recipes: "book"
        case .targets: "target"
        case .dashboard: "chart.xyaxis.line"
        case .body: "scalemass"
        }
    }
}

private struct RootView: View {
    @EnvironmentObject private var store: Store
    @State private var module: Module? = .today
    @State private var settings = false

    var body: some View {
        Group {
            if let owner = store.owner {
                journal.id(owner).disabled(store.signingOut)
            } else {
                LoginView()
            }
        }
        .alert(store.tr("Error de Nutri"), isPresented: Binding(
            get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button(store.tr("Cerrar"), role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: .nutriSettings)) { _ in settings = true }
        .onReceive(NotificationCenter.default.publisher(for: .nutriModule)) { notification in
            if let selected = notification.object as? Module { module = selected }
        }
        .onChange(of: store.logFood) { _, food in if food != nil { module = .today } }
        .onChange(of: store.owner) { _, _ in module = .today }
    }

    private var journal: some View {
        NavigationSplitView {
            List(selection: $module) {
                Section {
                    ForEach(Module.allCases) { item in
                        Label(store.tr(item.rawValue), systemImage: item.icon).tag(item)
                    }
                } header: {
                    HStack(spacing: 8) {
                        Text("nutri.").font(.system(size: 25, weight: .bold))
                        if store.demoActive { Text("Demo").font(.caption.weight(.medium)) }
                    }
                    .padding(.vertical, 8)
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 170, ideal: 198, max: 260)
            .safeAreaInset(edge: .bottom) {
                Button {
                    settings = true
                } label: {
                    Label(store.tr("Ajustes"), systemImage: "gearshape")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 5)
                }
                .buttonStyle(.plain)
                .padding(12)
            }
        } detail: {
            VStack(spacing: 0) {
                if store.offline || store.pending > 0 {
                    HStack {
                        Label(store.offline ? store.tr("Sin conexión") : store.tr("Sincronizando"), systemImage: store.offline ? "wifi.slash" : "arrow.triangle.2.circlepath")
                        Spacer()
                        if store.pending > 0 { Text("\(store.pending) \(store.tr("pendientes"))").monospacedDigit() }
                        Button(store.tr("Reintentar")) { store.flush() }.controlSize(.small)
                    }
                    .font(.callout)
                    .padding(.horizontal, 18).padding(.vertical, 5)
                    .background(.thinMaterial)
                }
                switch module ?? .today {
                case .today: TodayView()
                case .foods: FoodsView()
                case .recipes: RecipesView()
                case .targets: TargetsView()
                case .dashboard: DashboardView()
                case .body: BodyView()
                }
                if let undo = store.undoTitle {
                    HStack {
                        Text(undo)
                        Spacer()
                        Button(store.tr("Deshacer"), action: store.performUndo)
                    }
                    .padding(10).background(.thinMaterial)
                } else if let notice = store.notice {
                    Text(notice).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(.thinMaterial)
                }
            }
            .navigationTitle(store.tr((module ?? .today).rawValue))
        }
        .sheet(isPresented: $settings) { SettingsView { settings = false } }
    }
}

private struct LoginView: View {
    @EnvironmentObject private var store: Store
    @State private var email = ""
    @State private var password = ""
    @State private var submitting = false
    @FocusState private var emailFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("nutri.").font(.system(size: 53, weight: .bold)).foregroundStyle(nutriAccent)
            HStack {
                Text(store.tr("Inicia sesión")).font(.title2.weight(.semibold))
                Spacer()
                Picker(store.tr("Idioma"), selection: $store.loginLanguage) {
                    Text("Español").tag("es")
                    Text("English").tag("en")
                }.labelsHidden().frame(width: 100)
            }
            VStack(alignment: .leading, spacing: 10) {
                TextField(store.tr("Correo"), text: $email).focused($emailFocused).textContentType(.emailAddress)
                SecureField(store.tr("Contraseña"), text: $password).textContentType(.password)
            }
            .controlSize(.large)
            .onSubmit(signIn)
            Button(action: signIn) {
                if submitting { ProgressView().controlSize(.small).frame(maxWidth: .infinity) }
                else { Text(store.tr("Entrar")).frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .disabled(submitting || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
            #if DEBUG
            Button(store.tr("Probar con datos locales")) { store.activateDemo() }.disabled(submitting)
            #endif
        }
        .frame(width: 350)
        .padding(36)
        .background(.background, in: RoundedRectangle(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.quaternary) }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .underPageBackgroundColor))
        .task { emailFocused = true }
    }

    private func signIn() {
        guard !submitting, !email.isEmpty, !password.isEmpty else { return }
        submitting = true
        Task {
            defer { submitting = false }
            do { try await store.signIn(email, password); password = "" }
            catch { store.report(error) }
        }
    }
}
