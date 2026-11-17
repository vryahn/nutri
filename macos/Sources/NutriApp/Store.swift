import Foundation
import Network
import SwiftUI
import NutriCore

@MainActor
final class Store: ObservableObject {
    @Published private(set) var owner: String?
    @Published private(set) var email = ""
    @Published private(set) var anonymous = false
    @Published private(set) var offline = false
    @Published private(set) var networkAvailable = true
    @Published private(set) var prefs: Record = [:]
    @Published private(set) var pending = 0
    @Published private(set) var entryVersion = 0
    @Published private(set) var copiedDay: String?
    @Published private(set) var signingOut = false
    @Published var errorMessage: String?
    @Published var notice: String?
    @Published var undoTitle: String?
    @Published var logFood: Record?
    @Published var newFood: Record?
    @Published var loginLanguage = UserDefaults.standard.string(forKey: "nutri.loginLanguage") ?? (Locale.preferredLanguages.first?.hasPrefix("es") == true ? "es" : "en") {
        didSet { UserDefaults.standard.set(loginLanguage, forKey: "nutri.loginLanguage") }
    }
    @Published var theme = UserDefaults.standard.string(forKey: "nutri.theme") ?? "system" {
        didSet { if !anonymous && !demoActive { UserDefaults.standard.set(theme, forKey: "nutri.theme") } }
    }

    var lang: String {
        let language = prefs["lang"]?.string ?? loginLanguage
        return language == "en" ? "en" : "es"
    }
    var units: String {
        let local = UserDefaults.standard.string(forKey: "nutri.units")
            ?? (["en", "en-US"].contains(Locale.preferredLanguages.first ?? "") ? "us" : "metric")
        return (prefs["units"]?.string ?? local) == "us" ? "us" : "metric"
    }
    var demoActive: Bool {
        #if DEBUG
        return demo != nil
        #else
        return false
        #endif
    }

    static let dayOrder = "sort_order.asc.nullslast,created_at.asc"
    static let catalogQuery = ["select": "id,owner,name,brand,kcal,protein_g,carbs_g,fat_g,micros,portions,density_g_ml,source,reviewed_at,created_at", "order": "name.asc,id.asc"]
    private let api: Supabase?
    private let root: URL
    private var cache: AccountCache?
    private var identity = UUID()
    private var dayCacheVersion: [String: Int] = [:]
    private var outbox: EntryOutbox?
    private let network = NWPathMonitor()
    private var drainTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var undoAction: (() async throws -> Void)?
    private var undoTask: Task<Void, Never>?
    private var noticeTask: Task<Void, Never>?
    #if DEBUG
    private var demo: DemoData?
    var snapshotScenario = ""
    #endif

    init() {
        root = URL.applicationSupportDirectory.appendingPathComponent("NutriNative", isDirectory: true)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            api = nil
            activateDemo()
            return
        }
        #endif
        let info = Bundle.main.infoDictionary ?? [:]
        guard let url = (info["NutriSupabaseURL"] as? String).flatMap(URL.init(string:)),
              let key = info["NutriSupabasePublishableKey"] as? String,
              let ai = (info["NutriAIURL"] as? String).flatMap(URL.init(string:)) else {
            api = nil
            errorMessage = "Falta la configuración de Nutri. Compila el paquete con macos/scripts/build-app.sh."
            return
        }
        let identifier = Bundle.main.bundleIdentifier ?? "com.vryahn.nutri.native"
        let keychain = SessionKeychain(service: "\(identifier).session.\(url.host ?? "default")")
        var restored: StoredSession?
        do { restored = try keychain.read() }
        catch { errorMessage = error.localizedDescription }
        api = Supabase(configuration: NutriConfiguration(database: url, publishableKey: key, ai: ai), session: restored, keychain: keychain)
        if let restored { activate(restored.auth) }
        network.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self, !demoActive else { return }
                if networkAvailable != online { networkAvailable = online }
                offline = !online
                if online { flush() }
            }
        }
        network.start(queue: DispatchQueue(label: "com.vryahn.nutri.network"))
    }

    deinit { network.cancel() }

    #if DEBUG
    init(snapshot: DemoData) {
        root = URL.applicationSupportDirectory.appendingPathComponent("NutriNative", isDirectory: true)
        api = nil
        activateDemo(snapshot)
    }

    func activateDemo(_ fixture: DemoData = DemoData()) {
        guard owner == nil else { return }
        let demo = fixture
        self.demo = demo
        owner = demo.owner
        anonymous = demo.isAnonymous
        email = "demo@nutri.invalid"
        prefs = demo.prefs
        offline = false
        outbox = try? EntryOutbox(directory: nil, owner: demo.owner)
    }
    #endif

    func signIn(_ email: String, _ password: String) async throws {
        guard let api else { throw NutriError("Falta la configuración de Nutri.") }
        let auth = try await api.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
        activate(auth)
        await bootstrap()
    }

    func activateRemoteDemo() async throws {
        guard owner == nil, let api else { throw NutriError("No se pudo abrir la demo — intenta más tarde.") }
        let auth = try await api.signInAnonymously()
        do {
            _ = try await api.rpc("seed_demo", ["lang": .string(loginLanguage), "demo_day": .string(Day.key(Date()))], owner: auth.user.id)
            activate(auth)
            await bootstrap()
        } catch {
            _ = try? await api.signOut(owner: auth.user.id)
            throw error
        }
    }

    func signOut() async throws {
        guard let owner, !signingOut else { return }
        signingOut = true
        defer { signingOut = false }
        #if DEBUG
        if demo != nil {
            demo = nil
            reset()
            return
        }
        #endif
        if let api { try await api.signOut(owner: owner) }
        let previousCache = cache
        reset()
        do { try previousCache?.clear() } catch { report(error) }
    }

    func changePassword(_ password: String) async throws {
        guard let owner, let api else { throw NutriError("Se requiere una sesión real.") }
        try await api.changePassword(password, owner: owner)
    }

    private func activate(_ auth: AuthSession) {
        identity = UUID()
        owner = auth.user.id
        email = auth.user.email ?? ""
        anonymous = auth.user.is_anonymous ?? false
        if anonymous { theme = "dark" }
        do {
            cache = try AccountCache(root: root, owner: auth.user.id)
            prefs = cached("prefs", ["select": "data"])?.first?.object("data") ?? [:]
            copiedDay = cache?.read("today.copiedDay")?.first?["day"]?.string
            outbox = try EntryOutbox(directory: root, owner: auth.user.id)
            pending = outbox?.operations.count ?? 0
        } catch { report(error) }
    }

    private func reset() {
        drainTask?.cancel()
        drainTask = nil
        retryTask?.cancel()
        retryTask = nil
        undoTask?.cancel()
        undoAction = nil
        undoTitle = nil
        noticeTask?.cancel()
        notice = nil
        errorMessage = nil
        identity = UUID()
        owner = nil
        email = ""
        anonymous = false
        theme = UserDefaults.standard.string(forKey: "nutri.theme") ?? "system"
        prefs = [:]
        cache = nil
        dayCacheVersion = [:]
        outbox = nil
        pending = 0
        logFood = nil
        newFood = nil
        copiedDay = nil
        entryVersion += 1
    }

    func bootstrap() async {
        guard let uid = owner else { return }
        do {
            let rows = try await read("prefs", ["select": "data"])
            if owner == uid {
                prefs = rows.first?.object("data") ?? [:]
                if !demoActive {
                    if let language = prefs["lang"]?.string, ["es", "en"].contains(language) { loginLanguage = language }
                    if let unit = prefs["units"]?.string, ["metric", "us"].contains(unit) { UserDefaults.standard.set(unit, forKey: "nutri.units") }
                }
            }
        } catch { report(error) }
        flush()
        guard !demoActive, !offline, owner == uid else { return }
        // Prime the same catalog queries used by the entry editor for later offline use.
        async let foods: [Record]? = try? catalog()
        async let recipes: [Record]? = try? read("recipes", ["order": "name.asc"])
        async let nutrients: [Record]? = try? read("recipe_per_100g")
        _ = await (foods, recipes, nutrients)
    }

    func tr(_ s: String) -> String {
        let canonical = Domain.translate(s, language: lang)
        if canonical != s { return canonical }
        if lang == "en", let value = nativeTranslations[s] { return value }
        return canonical
    }

    func report(_ error: Error) {
        guard !(error is CancellationError), (error as? URLError)?.code != .cancelled else { return }
        errorMessage = error.localizedDescription
    }

    func toast(_ title: String) {
        noticeTask?.cancel()
        notice = title
        noticeTask = Task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { notice = nil }
        }
    }

    func undo(_ title: String, action: @escaping () async throws -> Void) {
        undoTask?.cancel()
        undoTitle = title
        undoAction = action
        undoTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            undoTitle = nil
            undoAction = nil
        }
    }

    func performUndo() {
        let action = undoAction
        undoTask?.cancel()
        undoTitle = nil
        undoAction = nil
        Task { do { try await action?() } catch { report(error) } }
    }

    func cached(_ table: String, _ query: [String: String] = [:]) -> [Record]? {
        cache?.read(AccountCache.key(table, query))
    }

    func read(_ table: String, _ query: [String: String] = [:], allowCached: Bool = true) async throws -> [Record] {
        #if DEBUG
        if let demo {
            if snapshotScenario.hasSuffix("-loading") { try await Task.sleep(for: .seconds(5)) }
            if snapshotScenario.hasSuffix("-error") { throw URLError(.notConnectedToInternet) }
            return demo.read(table, query)
        }
        #endif
        guard let owner, let api else { throw NutriError("Inicia sesión para continuar.") }
        let current = identity
        let key = AccountCache.key(table, query)
        let cachedVersion = dayCacheVersion[key, default: 0]
        if allowCached, offline, network.currentPath.status != .satisfied, let rows = cache?.read(key) { return rows }
        do {
            let rows = try await api.rows("GET", table, query: query, owner: owner)
            try Task.checkCancellation()
            guard identity == current else { throw CancellationError() }
            offline = false
            if dayCacheVersion[key, default: 0] != cachedVersion, let updated = cache?.read(key) { return updated }
            do { try cache?.write(key, rows) } catch { report(error) }
            return rows
        } catch {
            let code = (error as? NutriError)?.status ?? 0
            let transport = error is URLError && (error as? URLError)?.code != .cancelled
            if allowCached, identity == current, transport || code >= 500, let rows = cache?.read(key) {
                offline = true
                return rows
            }
            throw error
        }
    }

    func insert(_ table: String, _ body: Record) async throws -> Record {
        guard let result = try await mutate("POST", table, body: .object(body)).first else {
            throw NutriError("El servidor no confirmó el registro.")
        }
        return result
    }

    func insert(_ table: String, _ body: [Record]) async throws -> [Record] {
        guard !body.isEmpty else { return [] }
        return try await mutate("POST", table, body: .array(body.map(JSONValue.object)))
    }

    func upsert(_ table: String, _ body: Record, onConflict: String) async throws -> Record {
        guard let row = try await mutate("POST", table, query: ["on_conflict": onConflict], body: .object(body), upsert: true).first else {
            throw NutriError("El servidor no confirmó el registro.")
        }
        return row
    }

    func upsert(_ table: String, _ body: [Record], onConflict: String) async throws -> [Record] {
        guard !body.isEmpty else { return [] }
        return try await mutate("POST", table, query: ["on_conflict": onConflict], body: .array(body.map(JSONValue.object)), upsert: true)
    }

    @discardableResult
    func update(_ table: String, _ query: [String: String], _ body: Record) async throws -> [Record] {
        guard !query.isEmpty else { throw NutriError("Falta el filtro de edición.") }
        return try await mutate("PATCH", table, query: query, body: .object(body))
    }

    @discardableResult
    func delete(_ table: String, _ query: [String: String]) async throws -> [Record] {
        guard !query.isEmpty else { throw NutriError("Falta el filtro de borrado.") }
        return try await mutate("DELETE", table, query: query)
    }

    private func mutate(_ method: String, _ table: String, query: [String: String] = [:], body: JSONValue? = nil,
                        upsert: Bool = false) async throws -> [Record] {
        #if DEBUG
        if demo != nil {
            let result = demo?.mutate(method, table, query: query, body: body) ?? []
            guard !result.isEmpty else { throw NutriError("Ningún registro cambió.", code: "PGRST116") }
            return result
        }
        #endif
        guard let owner, let api else { throw NutriError("Inicia sesión para continuar.") }
        let prefer = (upsert ? "resolution=merge-duplicates," : "") + "return=representation,missing=default"
        let rows = try await api.rows(method, table, query: query, body: body, prefer: prefer, owner: owner)
        guard owner == self.owner else { throw CancellationError() }
        guard !rows.isEmpty else { throw NutriError("Ningún registro cambió. Revisa que existe y que tienes acceso.", code: "PGRST116") }
        return rows
    }

    func rpc(_ name: String, _ body: Record = [:]) async throws -> JSONValue {
        #if DEBUG
        if demo != nil, let value = try demo?.rpc(name, body) { return value }
        #endif
        guard let owner, let api else { throw NutriError("Inicia sesión para continuar.") }
        return try await api.rpc(name, body, owner: owner)
    }

    func setRegion(_ key: String, _ value: String) async throws {
        guard (key == "lang" && ["es", "en"].contains(value)) || (key == "units" && ["metric", "us"].contains(value)) else { return }
        if key == "lang" { loginLanguage = value }
        else { UserDefaults.standard.set(value, forKey: "nutri.units") }
        prefs[key] = .string(value)
        try cache?.write(AccountCache.key("prefs", ["select": "data"]), [["data": .object(prefs)]])
        try await patchPrefs([key: .string(value)])
    }

    func patchPrefs(_ patch: Record) async throws {
        let current = identity
        let value = try await rpc("merge_prefs", ["patch": .object(patch)])
        guard identity == current else { throw CancellationError() }
        prefs = value.object ?? prefs.merging(patch) { _, new in new }
        do { try cache?.write(AccountCache.key("prefs", ["select": "data"]), [["data": .object(prefs)]]) }
        catch { report(error) }
    }

    func ai(_ body: Record) async throws -> JSONValue {
        guard let owner, let api else { throw NutriError("El proxy requiere una sesión real.") }
        return try await api.ai(body, owner: owner)
    }

    func storage(_ method: String, _ path: String, body: Data? = nil, contentType: String? = nil) async throws -> Data {
        #if DEBUG
        if demo != nil { return try demo?.storage(method, path, body) ?? Data() }
        #endif
        guard let owner, let api else { throw NutriError("Inicia sesión para continuar.") }
        return try await api.storage(method, path, body: body, contentType: contentType, owner: owner)
    }

    func catalog(allowCached: Bool = true) async throws -> [Record] {
        let limit = 1000
        var all: [Record] = []
        while true {
            var query = Self.catalogQuery
            query["limit"] = String(limit)
            query["offset"] = String(all.count)
            let page = try await read("foods", query, allowCached: allowCached)
            all += page
            if page.count < limit { return all }
        }
    }

    func copyDay(_ key: String) throws {
        guard owner != nil else { throw CancellationError() }
        try cache?.write("today.copiedDay", [["day": .string(key)]])
        copiedDay = key
    }

    func queuedDay(_ rows: [Record], _ day: String) -> [Record] {
        outbox?.overlay(rows, day: day) ?? rows
    }

    func addEntry(_ payload: Record, row: Record) throws {
        guard outbox != nil else { throw NutriError("La cola local no está disponible.") }
        try outbox?.insert(payload, row: row)
        changedEntries()
        flush()
    }

    func editEntry(_ id: String, patch: Record, row: Record) throws {
        guard outbox != nil else { throw NutriError("La cola local no está disponible.") }
        try outbox?.update(id, patch: patch, row: row)
        changedEntries()
        flush()
    }

    func removeEntry(_ id: String, row: Record? = nil) throws {
        guard outbox != nil else { throw NutriError("La cola local no está disponible.") }
        try outbox?.delete(id, row: row)
        changedEntries()
        flush()
    }

    private func changedEntries() {
        pending = outbox?.operations.count ?? 0
        entryVersion += 1
    }

    func flush() {
        guard drainTask == nil, let uid = owner, pending > 0, !signingOut else { return }
        retryTask?.cancel()
        retryTask = nil
        let current = identity
        drainTask = Task { await drain(uid, current: current) }
    }

    private func acknowledge(_ operation: EntryOperation) throws {
        guard let row = operation.row, !row.text("day").isEmpty else { return }
        let day = row.text("day")
        let key = AccountCache.key("entry_nutrients", Self.entriesQuery(day))
        var rows = cache?.read(key) ?? []
        rows.removeAll { $0.text("id") == operation.entryID }
        if operation.kind != .delete { rows.append(row.filter { $0.key != "_pending" }) }
        try cache?.write(key, rows)
        dayCacheVersion[key, default: 0] += 1
    }

    static func entriesQuery(_ day: String) -> [String: String] {
        ["day": "eq." + day, "order": dayOrder]
    }

    private func drain(_ uid: String, current: UUID) async {
        defer { if identity == current { drainTask = nil } }
        while identity == current && !Task.isCancelled {
            let candidate: EntryOperation?
            do { candidate = try outbox?.begin() }
            catch { report(error); return }
            guard let operation = candidate else { return }
            do {
                let query = ["id": "eq." + operation.entryID]
                switch operation.kind {
                case .insert:
                    do { _ = try await insert("entries", operation.payload) }
                    catch let error as NutriError where error.code == "23505" {
                        // A replay is successful only when this UUID exists for this owner.
                        guard let api else { throw error }
                        // A cached row cannot establish that this retry reached the server.
                        guard (try await api.rows("GET", "entries", query: query, owner: uid)).contains(where: {
                            $0.text("id") == operation.entryID
                        }) else { throw error }
                    }
                case .update: _ = try await update("entries", query, operation.payload)
                case .delete:
                    do { _ = try await delete("entries", query) }
                    catch let error as NutriError where error.code == "PGRST116" {
                        // A previous attempt may have deleted the UUID before a crash.
                        guard let api, (try await api.rows("GET", "entries", query: query, owner: uid)).isEmpty else {
                            throw error
                        }
                        toast(tr("El registro ya no existe."))
                    }
                }
                guard identity == current, !Task.isCancelled else { return }
                try acknowledge(operation)
                try outbox?.finish(operation)
                changedEntries()
            } catch {
                guard identity == current, !Task.isCancelled else { return }
                if (error as? NutriError)?.permanentWriteFailure == true {
                    do { try outbox?.finish(operation, discardDependents: operation.kind == .insert) }
                    catch { report(error); return }
                    changedEntries()
                    report(error)
                    continue
                }
                if error is URLError { offline = true }
                else { report(error) }
                retryTask = Task {
                    try? await Task.sleep(for: .seconds(12))
                    if !Task.isCancelled { flush() }
                }
                return
            }
        }
    }
}
