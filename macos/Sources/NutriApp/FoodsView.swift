import NutriCore
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#endif

let foodDensityPresets: [(String, Double)] = [
    ("Agua, café, té o caldo", 1), ("Leche", 1.03), ("Jugo o refresco", 1.04),
    ("Yogur bebible o licuado", 1.05), ("Bebida alcohólica", 0.99), ("Aceite", 0.92), ("Miel o jarabe", 1.4)
]
private let foodSources = [
    "manual": "Manual", "etiqueta": "Etiqueta", "gemini": "IA",
    "off": "OFF", "usda": "USDA", "cronometer": "Cronometer", "ia_personal": "IA personal"
]
private let requiredFoodMicros = ["sodio_mg", "potasio_mg", "magnesio_mg"]

struct CatalogPortion: Identifiable {
    let id = UUID()
    var name = ""
    var grams = ""
    var unit = ""
    var amount: String?
}

private struct FoodDraft: Identifiable {
    let id = UUID()
    let original: Record
    var name: String
    var brand: String
    var macros: [String: String]
    var micros: [String: String]
    var portions: [CatalogPortion]
    var density: String
    var densitySelection: String
    var basis = "100"
    var unit = "g"
    var source: String
    var reviewValid: Bool

    init(_ row: Record = [:]) {
        original = row
        name = row.text("name")
        brand = row.text("brand")
        macros = Dictionary(uniqueKeysWithValues: Domain.macroKeys.map { ($0, draftNumber(row.number($0))) })
        micros = row.object("micros").compactMapValues { $0.number.map(draftNumber) }
        portions = row.array("portions").compactMap { $0.object }.map {
            CatalogPortion(name: $0.text("name"), grams: draftNumber($0.number("grams")))
        }
        density = draftNumber(row.number("density_g_ml"))
        densitySelection = Self.densityChoice(row.number("density_g_ml"))
        source = row.text("source").isEmpty ? "manual" : row.text("source")
        reviewValid = !row.text("reviewed_at").isEmpty
    }

    static func densityChoice(_ density: Double?) -> String {
        guard let density, density > 0 else { return "" }
        return foodDensityPresets.contains { $0.1 == density } ? String(density) : "other"
    }

    var isBase: Bool { !original.text("id").isEmpty && original.text("owner").isEmpty }

    var enteredValues: Record {
        var row: Record = macros.compactMapValues { decimal($0).flatMap { $0 >= 0 ? .number($0) : nil } }
        row["micros"] = .object(micros.compactMapValues { decimal($0).flatMap { $0 >= 0 ? .number($0) : nil } })
        return row
    }

    var equivalentGrams: Double? {
        let storedAmount = unit == "g" && cleanText(basis).isEmpty ? 100 : decimal(basis)
        guard let amount = storedAmount else { return nil }
        return Domain.grams(amount, unit: unit, density: decimal(density)).flatMap { $0.isFinite && (10_000 / $0).isFinite ? $0 : nil }
    }

    var reviewWarnings: (kcal: Bool, implausible: Bool, component: String?) {
        let raw = enteredValues
        let normalized = equivalentGrams.map { normalizedValues(raw, grams: $0) } ?? raw
        let hasMacros = Domain.macroKeys.dropFirst().contains { raw.number($0) != nil }
        return (raw.number("kcal") != nil && hasMacros && Domain.kcalSuspicious(raw),
                Domain.macrosImplausible(normalized), Domain.componentsInconsistent(normalized))
    }

    private func normalizedValues(_ row: Record, grams: Double) -> Record {
        if grams == 100 { return row }
        // The reference format is per 100 g. Portions remain absolute grams.
        var scaled = Domain.scaled(row, grams: 10_000 / grams)
        scaled["micros_complete"] = nil
        return scaled
    }

    func payload(reviewed: Bool = false) throws -> Record {
        let title = cleanText(name)
        guard !title.isEmpty else { throw FeatureError("Escribe el nombre del alimento.") }
        let densityValue = try featureNumber(density, label: "Densidad").flatMap { $0 > 0 ? $0 : nil }
        guard let grams = equivalentGrams, grams.isFinite, (10_000 / grams).isFinite else {
            throw FeatureError(unit == "ml" ? "Indica una base y una densidad válidas para convertir ml a gramos." : "Indica una cantidad base mayor que cero.")
        }
        var raw: Record = [:]
        for key in Domain.macroKeys {
            let number = try featureNumber(macros[key] ?? "", label: Domain.macroLabels[key] ?? key)
            if key != "kcal", number == nil {
                throw FeatureError("Falta \(Domain.macroLabels[key] ?? key). Usa 0 solo cuando esté declarado.")
            }
            raw[key] = number.map(JSONValue.number)
        }
        var nutrients: Record = [:]
        for (key, value) in micros {
            let label = Domain.micros.first { $0.key == key }?.label ?? key
            nutrients[key] = try featureNumber(value, label: label).map(JSONValue.number)
        }
        raw["micros"] = .object(nutrients)
        if raw["kcal"] == nil {
            let estimated = Domain.kcalFromMacros(raw)
            guard estimated >= 0, estimated.isFinite else { throw FeatureError("Indica las kcal declaradas y verifica macros y fibra.") }
            raw["kcal"] = .number(estimated)
        }
        let savedPortions = portions.compactMap { portion -> JSONValue? in
            let label = cleanText(portion.name)
            guard !label.isEmpty, let grams = decimal(portion.grams), grams > 0 else { return nil }
            return .object(["name": .string(label), "grams": .number(grams)])
        }
        var row = normalizedValues(raw, grams: grams)
        guard Domain.macroKeys.allSatisfy({ row.number($0) != nil }) else { throw FeatureError("Valores nutricionales fuera de rango.") }
        row["name"] = .string(title)
        row["brand"] = optionalText(brand)
        row["density_g_ml"] = densityValue.map(JSONValue.number) ?? .null
        row["portions"] = .array(savedPortions)
        row["source"] = .string(source)
        row["reviewed_at"] = reviewed ? .string(Date.now.ISO8601Format()) : .null
        return row
    }

    mutating func fill(_ row: Record, source: String, basis: String) {
        if !row.text("name").isEmpty { name = row.text("name") }
        if !row.text("brand").isEmpty { brand = row.text("brand") }
        macros = Dictionary(uniqueKeysWithValues: Domain.macroKeys.map { ($0, draftNumber(row.number($0))) })
        micros = row.object("micros").compactMapValues { $0.number.map(draftNumber) }
        if let value = row.number("density_g_ml"), value.isFinite, value > 0 {
            let next = foodDensityPresets.first { abs($0.1 - value) <= 0.015 }?.1 ?? value
            density = draftNumber(next)
            densitySelection = Self.densityChoice(next)
        }
        self.source = source
        self.basis = "100"
        unit = basis == "100ml" ? "ml" : "g"
        reviewValid = false
    }
}

private struct FoodImportRow {
    let payload: Record?
    let preview: CatalogCSVRow

    static let headers = ["name", "brand"] + Domain.macroKeys + ["density_g_ml", "source"] + Domain.micros.map(\.key)
    static func parse(_ text: String) throws -> [Self] {
        try CSV.parse(text).map { row in
            var draft = FoodDraft()
            draft.name = cleanText(row["name"] ?? "")
            draft.brand = row["brand"] ?? ""
            draft.macros = row.filter { Domain.macroKeys.contains($0.key) }
            draft.micros = row.filter { cell in Domain.micros.contains { $0.key == cell.key } }
            draft.density = row["density_g_ml"] ?? ""
            draft.source = cleanText(row["source"] ?? "")
            if draft.source.isEmpty { draft.source = "manual" }
            do {
                let payload = try draft.payload()
                return Self(payload: payload, preview: CatalogCSVRow(label: "\(draft.name) · \(numberText(payload.number("kcal"), digits: 1)) kcal",
                    warnings: foodImportWarnings(payload), valid: true))
            } catch {
                return Self(payload: nil, preview: CatalogCSVRow(label: draft.name.isEmpty ? "(sin nombre)" : draft.name,
                    warnings: [error.localizedDescription], valid: false))
            }
        }
    }
}

private func foodImportWarnings(_ payload: Record) -> [String] {
    var warnings: [String] = []
    if Domain.kcalSuspicious(payload) { warnings.append("kcal") }
    if Domain.macrosImplausible(payload) { warnings.append("macros") }
    if Domain.componentsInconsistent(payload) != nil { warnings.append("componentes") }
    return warnings
}

private struct FoodListItem: Identifiable {
    let row: Record
    var id: String { row.text("id") }
}

private func foodWarningPending(_ row: Record) -> Bool {
    !row.text("owner").isEmpty && row.text("reviewed_at").isEmpty && !Domain.foodWarnings(row).isEmpty
}

struct FoodsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.nutriWindowWidth) private var windowWidth
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var searchFocused: Bool
    @State private var foods: [Record] = []
    @State private var semantic: (term: String, rows: [Record])?
    @State private var exactHits: (term: String, rows: [Record])?
    @State private var query = ""
    @State private var source = ""
    @State private var warnOnly = false
    @State private var sort = ""
    @State private var descending = false
    @State private var busy = false
    @State private var loading = true
    @State private var refreshing = false
    @State private var failed = false
    @State private var reloadVersion = 0
    @State private var mutationVersion = 0
    @State private var catalogVersion = 0
    @State private var draft: FoodDraft?
    @State private var importText = ""
    @State private var importReview = false
    @State private var importError = ""

    private var desktop: Bool { windowWidth >= 1024 }
    private func refreshSilently() {
        guard scenePhase == .active, store.networkAvailable, !store.demoActive else { return }
        Task { await reload(silent: true) }
    }
    private var term: String { cleanText(query) }
    private var matching: [Record] {
        guard !term.isEmpty else { return foods }
        if let exactHits, exactHits.term == term { return exactHits.rows }
        return foods.filter { $0.text("name").localizedCaseInsensitiveContains(term) }
    }
    private var results: [Record] {
        let hits = matching
        guard let semantic, semantic.term == term, !semantic.rows.isEmpty else { return hits }
        let found = Set(hits.map { $0.text("id") })
        return Array((hits + semantic.rows.filter { !found.contains($0.text("id")) }).prefix(8))
    }
    private var visible: [Record] {
        let filtered = results.filter { (source.isEmpty || $0.text("source") == source) && (!warnOnly || foodWarningPending($0)) }
        if sort.isEmpty {
            guard !term.isEmpty else { return filtered }
            return filtered.filter { $0.text("source") != "usda" } + filtered.filter { $0.text("source") == "usda" }
        }
        return filtered.sorted { a, b in
            let order: ComparisonResult
            if sort == "name" { order = a.text("name").lowercased().compare(b.text("name").lowercased(), options: .literal) }
            else {
                let x = a.number(sort) ?? 0, y = b.number(sort) ?? 0
                order = x == y ? .orderedSame : x < y ? .orderedAscending : .orderedDescending
            }
            return descending ? order == .orderedDescending : order == .orderedAscending
        }
    }

    @State private var fileExport = FeatureFileExport()

    var body: some View {
        Group {
            if desktop {
                GeometryReader { space in
                    let column = max(0, (space.size.width - 56) / 2)
                    HStack(alignment: .top, spacing: 24) {
                        ScrollView { listing }.frame(width: column)
                        ScrollView {
                            if let draft { editor(draft) }
                            else { emptyEditor }
                        }.frame(width: column)
                    }.padding(16)
                }
            } else if let draft {
                ScrollView { editor(draft).padding(16) }.scrollDismissesKeyboard(.interactively)
            } else {
                ScrollView { listing.padding(16).padding(.bottom, 56) }
                    .scrollDismissesKeyboard(.interactively)
                    .overlay(alignment: .bottomTrailing) {
                        if !results.isEmpty {
                            Button { draft = FoodDraft() } label: { NutriIcon("plus", size: 22) }
                                .buttonStyle(NutriButtonStyle(.primary, height: 52, horizontal: 15, radius: 26))
                                .accessibilityLabel(store.tr("Nuevo alimento")).padding(16)
                        }
                    }
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active, !store.demoActive else { return }
            do {
                while !Task.isCancelled {
                    if store.networkAvailable { await reload(silent: true) }
                    try await Task.sleep(for: .seconds(30))
                }
            } catch is CancellationError { }
            catch { store.report(error) }
        }
        .font(.nutriSans(14)).foregroundStyle(palette.text)
        .task {
            openFromToday()
            await reload()
            #if DEBUG
            switch store.snapshotScenario {
            case "food-editor":
                draft = foods.first.map(FoodDraft.init) ?? FoodDraft()
            case "food-import":
                importText = "name,kcal,protein_g,carbs_g,fat_g,sodio_mg\nAvena,389,17,66,7,2\nZapallo,250,1,2,0,0\n,100,0,25,0,10"
                importReview = true
            default: break
            }
            #endif
        }
        .onChange(of: store.networkAvailable) { old, online in if !old && online { refreshSilently() } }
        .onChange(of: store.newFood) { _, _ in openFromToday() }
        .task(id: query) { await findFoods() }
        .nutriOnExitCommand { if importReview { if !busy { importReview = false } } else { draft = nil } }
        .onKeyPress("/") {
            guard !searchFocused, draft == nil else { return .ignored }
            searchFocused = true; return .handled
        }
        .preference(key: NutriPresentedModalKey.self, value: presentedImport)
        .preference(key: NutriModalVisibleKey.self, value: importReview)
        .nutriFeatureExport($fileExport) { store.report($0) }
    }

    private var presentedImport: NutriPresentedModal? {
        guard importReview else { return nil }
        return NutriPresentedModal("food-import", close: closeImport, maxWidth: 512) { importSheet }
    }

    private func closeImport() {
        if !busy { importReview = false }
    }

    private var listing: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(store.tr("Alimentos")).font(.nutriDisplay(20))
            filters
            if loading && foods.isEmpty {
                VStack(spacing: 8) {
                    ForEach(0..<3) { _ in RoundedRectangle(cornerRadius: 16).fill(palette.surface).frame(height: 64).accessibilityHidden(true) }
                }.accessibilityLabel(store.tr("Cargando…"))
            } else if failed && foods.isEmpty {
                VStack(spacing: 8) {
                    Text(store.tr("No se pudieron cargar los alimentos — revisa tu conexión.")).foregroundStyle(palette.text2)
                    Button(store.tr("Reintentar")) { Task { await reload() } }.buttonStyle(NutriButtonStyle(.secondary, height: 44))
                }
            } else if results.isEmpty {
                VStack(spacing: 12) {
                    let noMatches = !term.isEmpty && !foods.isEmpty
                    Text(store.tr(noMatches ? "Sin coincidencias con tu búsqueda" : "Sin alimentos aún")).foregroundStyle(palette.text2).font(.nutriSans(16))
                    if !noMatches {
                        Button(store.tr("Crear el primero")) { draft = FoodDraft() }.buttonStyle(NutriButtonStyle(.primary, height: 44))
                    }
                }.padding(.vertical, 48).frame(maxWidth: .infinity)
            } else if desktop {
                table
            } else if visible.isEmpty {
                Text(store.tr("Sin resultados con estos filtros.")).foregroundStyle(palette.text2).padding(.vertical, 24).frame(maxWidth: .infinity)
            } else {
                LazyVStack(spacing: 16) {
                    ForEach(visible.map(FoodListItem.init)) { item in compactRow(item.row) }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var filters: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                NutriIcon("search", size: 18).foregroundStyle(palette.text3)
                TextField(store.tr("Buscar…"), text: $query).font(.nutriSans(16)).textFieldStyle(.plain).focused($searchFocused)
                    .accessibilityIdentifier("foods.search")
            }.padding(.horizontal, 12).frame(height: 44).nutriCard(radius: 12, fill: palette.surface2)
            HStack(spacing: 8) {
                Button {
                    searchFocused = false; importText = ""; importError = ""; importReview = true
                } label: { HStack(spacing: 6) { NutriIcon("upload", size: 16); Text(store.tr("Importar")) } }
                    .buttonStyle(NutriButtonStyle(.secondary, height: 44))
                let sourceOptions = Set(results.map { $0.text("source") }).filter { !$0.isEmpty }.sorted()
                NutriSelect(value: source, select: { source = $0 }, options:
                    [("", store.tr("Todos"))] + sourceOptions.map { ($0, store.tr(foodSources[$0] ?? $0)) },
                    currentLabel: store.tr(foodSources[source] ?? source))
                    .accessibilityLabel(store.tr("Fuente"))
                Button { warnOnly.toggle() } label: { NutriIcon("triangle-alert", size: 18).frame(width: 44, height: 44) }
                    .buttonStyle(.plain).foregroundStyle(warnOnly ? palette.warn : palette.text3)
                    .background(warnOnly ? palette.warn.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(warnOnly ? palette.warn : palette.border) }
                    .accessibilityLabel(store.tr("Solo alimentos con avisos")).accessibilityAddTraits(warnOnly ? .isSelected : [])
            }
        }
    }

    private let tableColumns = [("Nombre", "name", CGFloat(0)), ("Kcal", "kcal", 66), ("P", "protein_g", 65), ("C", "carbs_g", 65), ("G", "fat_g", 65)]

    private var table: some View {
        LazyVStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(tableColumns.indices, id: \.self) { index in
                    let column = tableColumns[index]
                    Button {
                        if sort == column.1 { descending.toggle() } else { sort = column.1; descending = false }
                    } label: {
                        HStack(spacing: 3) {
                            Text(store.tr(column.0)).font(.nutriSans(14, weight: .medium))
                            if sort == column.1 { NutriIcon(descending ? "arrow-down" : "arrow-up", size: 11) }
                        }.frame(maxWidth: .infinity, alignment: index == 0 ? .leading : .trailing)
                            .frame(height: 36)
                    }.buttonStyle(.plain).padding(.horizontal, 12)
                    .frame(width: index == 0 ? nil : column.2)
                }
                Text("⚠").frame(width: 64, height: 38)
            }.foregroundStyle(palette.text2).background(palette.surface2)
            if visible.isEmpty {
                Text(store.tr("Sin resultados con estos filtros.")).foregroundStyle(palette.text2)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
            }
            ForEach(visible.map(FoodListItem.init)) { item in
                let row = item.row
                Rectangle().fill(palette.border).frame(height: 1)
                FoodTableRow(row: row, active: draft?.original["id"] == row["id"], removable: row.text("owner") == store.owner,
                    open: { draft = FoodDraft(row) }, delete: { Task { do { try await remove(row) } catch { store.report(error) } } })
            }
        }.clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border).allowsHitTesting(false) }
    }

    private func compactRow(_ row: Record) -> some View {
        let removeAction: (() -> Void)? = row.text("owner") == store.owner ?
            { Task { do { try await remove(row) } catch { store.report(error) } } } : nil
        return CatalogSwipeCard(open: { draft = FoodDraft(row) }, delete: removeAction) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.text("name")).font(.nutriSans(14, weight: .medium))
                    if foodWarningPending(row) {
                        NutriIcon("triangle-alert", size: 14).foregroundStyle(palette.warn)
                            .accessibilityLabel(store.tr("Valores nutricionales requieren revisión"))
                    }
                    Spacer()
                    Text("\(numberText(row.number("kcal"), digits: 1)) kcal").font(.nutriMono(14)).foregroundStyle(palette.text2)
                }
                if !row.text("brand").isEmpty { Text(row.text("brand")).foregroundStyle(palette.text3) }
            }
        }.accessibilityIdentifier("foods.card." + row.text("id"))
    }

    private var emptyEditor: some View {
        VStack(spacing: 12) {
            Text(store.tr("Selecciona un alimento o crea uno nuevo")).font(.nutriSans(16)).foregroundStyle(palette.text2).frame(minHeight: 24)
            Button { draft = FoodDraft() } label: { HStack { NutriIcon("plus", size: 16); Text(store.tr("Nuevo alimento")).font(.nutriSans(16, weight: .medium)) } }
                .buttonStyle(NutriButtonStyle(.primary, height: 44, horizontal: 16))
        }.padding(40).frame(maxWidth: .infinity).nutriCard()
    }

    private func editor(_ draft: FoodDraft) -> some View {
        FoodEditor(draft: draft, desktop: desktop, wide: windowWidth >= 1280, onSave: save, onDelete: remove, onClose: { self.draft = nil })
            .id(draft.id)
            .padding(desktop ? 24 : 0)
            .frame(maxWidth: .infinity)
            .background { if desktop { Color.clear.nutriCard() } }
    }

    private func openFromToday() {
        guard let context = store.newFood else { return }
        draft = FoodDraft(context)
        store.newFood = nil
    }

    private func reload(silent: Bool = false) async {
        if silent && (loading || busy || refreshing) { return }
        if silent { refreshing = true }
        reloadVersion += 1
        let version = reloadVersion
        let mutation = mutationVersion
        let search = term
        if !silent && foods.isEmpty {
            let firstPage = Store.catalogQuery.merging(["limit": "1000", "offset": "0"]) { _, page in page }
            if let cached = store.cached("foods", firstPage) { foods = cached.filter { !Domain.water($0) } }
        }
        if !silent { loading = true }
        defer {
            if silent { refreshing = false }
            else if reloadVersion == version { loading = false }
        }
        do {
            let rows = try await store.catalog(allowCached: !silent).filter { !Domain.water($0) }
            let exact = search.isEmpty || search != term ? nil : try? await searchCatalogNames(
                store: store, table: "foods", term: search, allowCached: !silent
            )
            guard !Task.isCancelled, reloadVersion == version, mutationVersion == mutation else { return }
            catalogVersion += 1
            foods = rows
            if term == search { exactHits = exact.map { (search, $0) } }
            if let previous = semantic { semantic = (previous.term, refreshedSemanticRows(previous.rows)) }
            failed = false
        } catch {
            if !silent && !Task.isCancelled && reloadVersion == version { failed = true; store.report(error) }
        }
    }

    private func refreshedSemanticRows(_ matches: [Record]) -> [Record] {
        let byID = Dictionary(foods.map { ($0.text("id"), $0) }, uniquingKeysWith: { first, _ in first })
        return matches.compactMap { byID[$0.text("id")] }
    }

    private func findFoods() async {
        let search = term
        guard !search.isEmpty, !store.offline, !store.demoActive else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let mutation = mutationVersion
            let catalog = catalogVersion
            let exact = try await searchCatalogNames(store: store, table: "foods", term: search)
            guard !Task.isCancelled, term == search, mutationVersion == mutation, !busy else { return }
            if catalogVersion == catalog { exactHits = (search, exact) }
            guard search.count >= 3, exact.count < 8, !store.anonymous else {
                semantic = nil
                return
            }
            let hits = try await searchSemanticFoods(store: store, query: search)
            guard !Task.isCancelled, term == search, mutationVersion == mutation, !busy else { return }
            if catalogVersion == catalog {
                semantic = (search, hits.filter { !Domain.water($0) })
            } else {
                semantic = (search, refreshedSemanticRows(hits))
            }
        } catch { /* The loaded local catalog remains usable. */ }
    }

    private func save(_ draft: FoodDraft, reviewed: Bool, log: Bool) async throws {
        guard let owner = store.owner else { throw CancellationError() }
        let payload = try draft.payload(reviewed: reviewed)
        let id = draft.original.text("id")
        let saved: Record
        if draft.original.text("owner") == owner, !id.isEmpty {
            guard let row = try await store.update("foods", ["id": "eq.\(id)"], payload).first else {
                throw FeatureError("El servidor no confirmó el alimento.")
            }
            saved = row
        } else {
            saved = try await store.insert("foods", payload.merging(["owner": .string(owner)]) { _, new in new })
        }
        mutationVersion += 1
        foods.removeAll { $0.text("id") == saved.text("id") }
        foods.append(saved)
        foods.sort { $0.text("name").localizedStandardCompare($1.text("name")) == .orderedAscending }
        semantic?.rows.removeAll { $0.text("id") == saved.text("id") }
        if let index = exactHits?.rows.firstIndex(where: { $0.text("id") == saved.text("id") }) {
            exactHits?.rows[index] = saved
        }
        if self.draft?.id == draft.id { self.draft = nil }
        store.toast(store.tr("Guardado."))
        if log {
            var routed = saved
            routed["day"] = draft.original["day"]
            routed["meal_label_id"] = draft.original["meal_label_id"]
            store.logFood = routed
        }
        if !term.isEmpty { Task { await findFoods() } }
        Task {
            guard !store.demoActive, !store.anonymous, !store.offline,
                  let vector = try? await foodEmbedding(store: store, text: saved.text("name") + " " + saved.text("brand")),
                  vector != .null, store.owner == owner else { return }
            let brand = saved["brand"]?.string.map { "eq.\($0)" } ?? "is.null"
            _ = try? await store.update("foods", [
                "id": "eq.\(saved.text("id"))", "name": "eq.\(saved.text("name"))", "brand": brand
            ], ["embedding": vector])
        }
    }

    private func remove(_ row: Record) async throws {
        guard !busy, let owner = store.owner, row.text("owner") == owner else {
            throw FeatureError("Solo puedes borrar tus propios alimentos.")
        }
        busy = true
        defer { busy = false }
        mutationVersion += 1
        let id = row.text("id")
        foods.removeAll { $0.text("id") == id }
        semantic?.rows.removeAll { $0.text("id") == id }
        exactHits?.rows.removeAll { $0.text("id") == id }
        let deleted: Record
        do {
            guard let result = try await store.delete("foods", ["id": "eq.\(id)"]).first else {
                throw FeatureError(store.tr("Tiene registros asociados, no se puede borrar."))
            }
            deleted = result
        } catch {
            await reload()
            throw error
        }
        mutationVersion += 1
        if draft?.original.text("id") == id { draft = nil }
        store.undo(store.tr("Alimento borrado")) {
            guard store.owner == owner else { throw CancellationError() }
            _ = try await store.insert("foods", deleted)
            await reload()
        }
    }

    private var importSheet: some View {
        let parsed = Result { try FoodImportRow.parse(importText) }
        let rows = (try? parsed.get()) ?? []
        let valid = rows.compactMap(\.payload)
        let parseError: String = { if case let .failure(error) = parsed { return error.localizedDescription }; return "" }()
        return CatalogCSVSheet(title: store.tr("Importar alimentos"),
            description: store.tr("Pega o sube un CSV: una fila por alimento, valores por 100 g. Columnas: name, kcal, protein_g, carbs_g, fat_g y una por cada micro (p. ej. sodio_mg)."),
            example: "name,kcal,protein_g,carbs_g,fat_g,sodio_mg\nAvena,389,17,66,7,2", text: $importText, error: $importError,
            parseError: parseError, count: valid.count, busy: busy, close: closeImport, template: exportTemplate,
            commit: { Task { await commitImport(valid) } }) { CatalogCSVPreview(rows: rows.map(\.preview)) }
    }

    private func commitImport(_ valid: [Record]) async {
        guard !busy, let owner = store.owner else { return }
        busy = true
        importError = ""
        defer { busy = false }
        do {
            let payload = valid.map { $0.merging(["owner": .string(owner)]) { _, new in new } }
            let saved = try await store.insert("foods", payload)
            importReview = false
            store.toast(store.tr("%n alimentos importados.").replacingOccurrences(of: "%n", with: String(saved.count)))
            await reload()
        } catch { importError = store.failure(error, "Error al importar.", networkOnly: true) }
    }

    private func exportTemplate() {
        do { try fileExport.save(Data((FoodImportRow.headers.joined(separator: ",") + "\n").utf8), name: "nutri_alimentos_plantilla.csv", type: .commaSeparatedText) }
        catch { store.report(error) }
    }

}

private struct FoodTableRow: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State private var hovering = false
    let row: Record
    let active: Bool
    let removable: Bool
    let open: () -> Void
    let delete: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            Button(action: open) {
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.text("name")).font(.nutriSans(14, weight: .medium)).lineLimit(2).help(row.text("name"))
                        if !row.text("brand").isEmpty { Text(row.text("brand")).font(.nutriSans(12)).foregroundStyle(palette.text3).lineLimit(1) }
                    }.padding(.horizontal, 12).frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(Domain.macroKeys, id: \.self) { key in
                        Text(draftNumber(row.number(key))).font(.nutriMono(14, weight: .regular)).lineLimit(1).minimumScaleFactor(0.9)
                            .padding(.trailing, 12).frame(width: key == "kcal" ? 66 : 65, alignment: .trailing)
                    }
                }.padding(.vertical, 8).contentShape(Rectangle())
            }.buttonStyle(.plain)
            HStack(spacing: 4) {
                if foodWarningPending(row) {
                    NutriIcon("triangle-alert", size: 14).foregroundStyle(palette.warn)
                        .accessibilityLabel(store.tr("Valores nutricionales requieren revisión"))
                } else { Color.clear.frame(width: 14, height: 14) }
                if removable {
                    Button(action: delete) { NutriIcon("trash-2", size: 16).frame(width: 28, height: 30) }
                        .buttonStyle(.plain).foregroundStyle(palette.text2).opacity(hovering ? 1 : 0)
                        .accessibilityLabel(store.tr("Borrar") + " " + row.text("name"))
                }
            }.frame(width: 64)
        }.background(active || hovering ? palette.surface2 : Color.clear)
            .overlay { if active { Rectangle().strokeBorder(palette.accent).allowsHitTesting(false) } }
            .onHover { hovering = $0 }
            .contextMenu { if removable { Button(store.tr("Borrar"), role: .destructive, action: delete) } }
    }
}

private struct FoodEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State var draft: FoodDraft
    let desktop: Bool
    let wide: Bool
    let onSave: (FoodDraft, Bool, Bool) async throws -> Void
    let onDelete: (Record) async throws -> Void
    let onClose: () -> Void
    @State private var busy = false
    @State private var error = ""
    @State private var lookupBusy = false
    @State private var lookup = ""
    @State private var images: [FeatureImage] = []
    @State private var sourceInfo = ""
    @State private var lookupError = ""
    @State private var missing: [String] = []
    @State private var discrepancies: [String] = []
    @State private var sweeteners: [Record] = []
    @State private var fdc: [Record] = []
    @State private var moreMicros = false

    private var editing: Bool { !draft.original.text("id").isEmpty }
    private var own: Bool { editing && draft.original.text("owner") == store.owner }
    private var favorites: [String] { store.prefs.array("fav_micros").compactMap(\.string) }
    private var canSave: Bool { !cleanText(draft.name).isEmpty && draft.equivalentGrams != nil }
    private var hasMacros: Bool { Domain.macroKeys.dropFirst().contains { draft.enteredValues.number($0) != nil } }
    private var kcalEstimate: String { numberText(Domain.kcalFromMacros(draft.enteredValues), digits: 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Button(action: onClose) {
                    NutriIcon("chevron-left", size: 22).frame(width: nutriTouchSize(28), height: nutriTouchSize(38))
                        .contentShape(Rectangle())
                }
                    .buttonStyle(.plain).accessibilityLabel(store.tr("Volver"))
                Text(store.tr(editing ? "Editar alimento" : "Nuevo alimento")).font(.nutriDisplay(20))
            }
            if draft.isBase { Text(store.tr("Alimento del catálogo base — al guardar se creará tu propia copia.")).foregroundStyle(palette.accent) }
            lookupSection
            if !fdc.isEmpty { fdcChips }
            basics
            basisSection
            nutrients
            warnings
            if !desktop { extraMicros }
            densitySection
            CatalogPortionsEditor(portions: $draft.portions, density: decimal(draft.density) ?? 0)
                .onChange(of: draft.portions.map { $0.name + "|" + $0.grams }) { _, _ in draft.reviewValid = false }
            sourceSection
            if !error.isEmpty { Text(error).foregroundStyle(palette.danger) }
            footer
        }.font(.nutriSans(14)).disabled(busy)
    }

    private var lookupSection: some View {
        CatalogAIDataCard(text: $lookup, images: $images, loading: lookupBusy, error: lookupError,
            placeholder: store.tr("Describe el alimento, pega un código de barras (EAN) o adjunta una foto de etiqueta/platillo"),
            hint: store.tr("Etiqueta legible → se transcribe. EAN → Open Food Facts. Si no, estimación IA con chips USDA para genéricos. Siempre por 100 g; revisa antes de guardar."),
            submit: startLookup) {
                VStack(alignment: .leading, spacing: 6) {
                    if !sourceInfo.isEmpty { Text(sourceInfo).foregroundStyle(palette.text2) }
                    if !missing.isEmpty { Text(store.tr("Sin dato fiable de:") + " " + missing.joined(separator: ", ")).foregroundStyle(palette.warn) }
                    if !discrepancies.isEmpty { Text("⚠ " + store.tr("La etiqueta y Open Food Facts difieren en:") + " " + discrepancies.joined(separator: ", ") + ".").foregroundStyle(palette.warn) }
                    if !sweeteners.isEmpty {
                        let names = sweeteners.map { "\($0.text("name")) (\($0.text("code")))" }.joined(separator: ", ")
                        Text(store.tr("Open Food Facts reporta edulcorantes:") + " " + names + ". " +
                            store.tr("La cantidad casi nunca se declara; captúrala en su micro si la conoces.")).foregroundStyle(palette.text2)
                    }
                }.font(.nutriSans(12))
        }
    }

    private var fdcChips: some View {
        NutriFlow(spacing: 8) {
            ForEach(fdc.indices, id: \.self) { index in
                Button("USDA: " + fdc[index].text("description")) { Task { await useFDC(fdc[index]) } }
                    .buttonStyle(NutriButtonStyle(.secondary, height: 44, radius: 22)).font(.nutriSans(12))
            }
        }.disabled(lookupBusy)
    }

    private var basics: some View {
        VStack(alignment: .leading, spacing: 16) {
            fieldLabel(store.tr("Nombre"), required: true) {
                TextField("", text: edit(\.name)).nutriInput().accessibilityLabel(store.tr("Nombre"))
            }
            fieldLabel(store.tr("Marca")) {
                TextField("", text: edit(\.brand)).nutriInput().accessibilityLabel(store.tr("Marca"))
            }
        }
    }

    private var basisSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(store.tr("Valores por")).foregroundStyle(palette.text3)
                TextField("100", text: edit(\.basis)).font(.nutriMono(14)).multilineTextAlignment(.center)
                    .nutriDecimalKeyboard()
                    .nutriInput().frame(width: 80).accessibilityLabel(store.tr("Base de los valores capturados"))
                CatalogUnitToggle(units: ["g", "ml"], current: draft.unit, height: 32) { edit(\.unit).wrappedValue = $0 }
            }
            let convert = store.tr("se convertirá a 100 g al guardar")
            if draft.unit == "ml" {
                if let density = decimal(draft.density), density > 0, let amount = decimal(draft.basis), amount > 0 {
                    Text("\(draft.basis) ml × \(draft.density) = \(numberText(amount * density, digits: 1)) g → \(convert)").foregroundStyle(palette.accent)
                } else if (decimal(draft.density) ?? 0) <= 0 { Text(store.tr("Elige el tipo de líquido para convertir ml a gramos")).foregroundStyle(palette.warn) }
            } else if let amount = decimal(draft.basis), amount > 0, amount != 100 { Text(convert).foregroundStyle(palette.accent) }
            if draft.equivalentGrams == nil && (draft.unit != "ml" || (decimal(draft.density) ?? 0) > 0) {
                Text(store.tr("Indica una cantidad base mayor que cero.")).foregroundStyle(palette.warn)
            }
            if store.units == "us", let amount = decimal(draft.basis), amount > 0 {
                Text(draft.unit == "ml" ? "≈ \(numberText(amount / Domain.mlPerFluidOunce)) fl oz" : "≈ \(numberText(amount / Domain.gramsPerOunce)) oz")
                    .font(.nutriMono(12)).foregroundStyle(palette.text3)
            }
        }.font(.nutriSans(12))
    }

    private var nutrients: some View {
        let required = Set(requiredFoodMicros)
        let primary = desktop ? Domain.micros.filter { required.contains($0.key) } : Array(Domain.micros.prefix(8))
        let promoted = Domain.micros.dropFirst(8).filter { favorites.contains($0.key) }
        let grid = Array(repeating: GridItem(.flexible(), spacing: 12), count: desktop ? (wide ? 4 : 3) : 2)
        return VStack(alignment: .leading, spacing: 12) {
            if desktop { Text(store.tr("★ = favorito, se promueve arriba en móvil.")).font(.nutriSans(12)).foregroundStyle(palette.text3) }
            LazyVGrid(columns: grid, spacing: 12) {
                ForEach(Domain.macroKeys, id: \.self) { key in
                    valueField(foodLabel(key) + (key == "kcal" ? "" : " (g)"), field: draftField(\.macros, key), placeholder: key == "kcal" && hasMacros ? "≈ \(kcalEstimate)" : "")
                }
                ForEach(primary) { micro in microField(micro, star: false) }
                if !desktop { ForEach(promoted) { microField($0, star: true) } }
            }
            if desktop { groupedMicros(Domain.micros.filter { !required.contains($0.key) }, columns: wide ? 3 : 2) }
        }
    }

    private var extraMicros: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                moreMicros.toggle()
            } label: {
                HStack(spacing: 4) {
                    NutriIcon(moreMicros ? "chevron-down" : "chevron-right", size: 12)
                    Text(store.tr("Más micros (opcional)"))
                }.frame(minHeight: 28)
            }.buttonStyle(.plain).foregroundStyle(palette.text2)
            if moreMicros {
                Text(store.tr("★ = favorito: aparece arriba junto a los principales.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                groupedMicros(Domain.micros.dropFirst(8).filter { !favorites.contains($0.key) }, columns: 2)
            }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading).nutriCard(radius: 12, fill: palette.surface2)
    }

    private func groupedMicros(_ items: [Nutrient], columns: Int) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Domain.categories, id: \.self) { category in
                let members = items.filter { $0.category == category }
                if !members.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(store.tr(category).uppercased()).tracking(0.5).font(.nutriSans(12)).foregroundStyle(palette.text3)
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 12) {
                            ForEach(members) { microField($0, star: true) }
                        }
                    }
                }
            }
        }
    }

    private func fieldLabel<Content: View>(_ label: String, required: Bool = false, @ViewBuilder field: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                Text(label).lineLimit(1).help(label)
                if required { Text("*").foregroundStyle(palette.danger) }
            }.foregroundStyle(palette.text2).frame(minHeight: 24)
            field()
        }
    }

    private func valueField(_ label: String, field: Binding<String>, placeholder: String = "") -> some View {
        fieldLabel(label) {
            TextField(placeholder, text: field).font(.nutriMono(14)).nutriDecimalKeyboard().nutriInput().accessibilityLabel(label)
        }
    }

    private func microField(_ micro: Nutrient, star: Bool) -> some View {
        let favorite = favorites.contains(micro.key)
        let label = store.tr(micro.label) + " (" + micro.unit + ")"
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 3) {
                Text(label).lineLimit(1).help(label).foregroundStyle(palette.text2)
                Spacer(minLength: 0)
                if star {
                    Button {
                        Task {
                            do {
                                let updated = favorite ? favorites.filter { $0 != micro.key } : favorites + [micro.key]
                                try await store.patchPrefs(["fav_micros": .array(updated.map(JSONValue.string))])
                            } catch { store.report(error) }
                        }
                    } label: {
                        Group {
                            if favorite { Image(systemName: "star.fill").foregroundStyle(palette.accent) }
                            else { NutriIcon("star", size: 16).foregroundStyle(palette.text3) }
                        }.frame(minWidth: nutriTouchSize(16), minHeight: nutriTouchSize(24)).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel(store.tr(favorite ? "Quitar de favoritos" : "Marcar como favorito") + " · " + store.tr(micro.label))
                }
            }.frame(minHeight: 24)
            TextField("", text: draftField(\.micros, micro.key)).font(.nutriMono(14))
                .nutriDecimalKeyboard().nutriInput().accessibilityLabel(label)
        }
    }

    private var densitySection: some View {
        fieldLabel(store.tr("Líquido")) {
            NutriSelect(value: draft.densitySelection, select: chooseDensity, options:
                [("", store.tr("No es líquido"))] + foodDensityPresets.map { label, density in
                    (String(density), store.tr(label) + " (\(draftNumber(density)) g/ml)")
                } + [("other", store.tr("Otro…"))])
                .accessibilityLabel(store.tr("Líquido"))
            if draft.densitySelection == "other" {
                TextField(store.tr("densidad en g/ml"), text: edit(\.density)).font(.nutriMono(14)).nutriDecimalKeyboard().nutriInput()
                    .accessibilityLabel(store.tr("Densidad en g/ml"))
            }
            Text(store.tr("Si es líquido, al registrar podrás capturar en ml y se convierte a gramos.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
        }
    }

    private func chooseDensity(_ choice: String) {
        draft.densitySelection = choice
        if choice != "other" { draft.density = choice }
        draft.reviewValid = false
    }

    private var sourceSection: some View {
        let options = [("manual", "Manual"), ("etiqueta", "Etiqueta"), ("gemini", "IA (Gemini)"), ("off", "Open Food Facts"), ("usda", "USDA")]
        return fieldLabel(store.tr("Fuente")) {
            NutriSelect(value: draft.source, select: { edit(\.source).wrappedValue = $0 },
                options: options.map { ($0.0, store.tr($0.1)) }, currentLabel: store.tr(foodSources[draft.source] ?? draft.source))
                .accessibilityLabel(store.tr("Fuente"))
        }
    }

    @ViewBuilder
    private var warnings: some View {
        if draft.macros["kcal", default: ""].isEmpty && hasMacros {
            Text(store.tr("Si dejas Kcal vacío, se guardará el cálculo por macros (≈ %n).").replacingOccurrences(of: "%n", with: kcalEstimate))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
        }
        let alerts = draft.reviewWarnings
        if alerts.kcal || alerts.implausible || alerts.component != nil {
            if draft.reviewValid {
                Text(store.tr("Valores atípicos, ya revisados por ti. El aviso vuelve si cambias los valores.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            } else {
                if alerts.kcal {
                    Text("⚠ " + store.tr("%n kcal no cuadran con los macros (≈ %m kcal por Atwater). El alimento quedará marcado para revisión.")
                        .replacingOccurrences(of: "%n", with: draft.macros["kcal", default: ""]).replacingOccurrences(of: "%m", with: kcalEstimate))
                        .foregroundStyle(palette.warn)
                }
                if alerts.implausible { Text("⚠ " + store.tr("Valores inusualmente altos para 100 g. Revisa antes de guardar.")).foregroundStyle(palette.warn) }
                if let component = alerts.component {
                    Text("⚠ " + store.tr("Componente inconsistente") + ": " + store.tr(component) + ". " + store.tr("Revisa antes de guardar."))
                        .foregroundStyle(palette.warn)
                }
                if own {
                    Button(store.tr("Marcar revisado")) { commit(reviewed: true, log: false) }
                        .buttonStyle(NutriButtonStyle(.secondary, height: 44)).foregroundStyle(palette.warn).disabled(!canSave || lookupBusy)
                }
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 16) {
            if !editing {
                Button { commit(reviewed: false, log: true) } label: { Text(store.tr("Guardar y registrar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.primary, height: 44)).disabled(!canSave)
            }
            Button { commit(reviewed: false, log: false) } label: { Text(store.tr(draft.isBase ? "Guardar copia" : "Guardar")).frame(maxWidth: .infinity) }
                .buttonStyle(NutriButtonStyle(editing ? .primary : .secondary, height: 44)).disabled(!canSave)
            if own {
                Button {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { try await onDelete(draft.original) } catch { self.error = error.localizedDescription }
                    }
                } label: { Text(store.tr("Borrar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.danger, height: 44))
            }
        }.disabled(busy || lookupBusy)
    }

    private func edit(_ key: WritableKeyPath<FoodDraft, String>) -> Binding<String> {
        Binding(get: { draft[keyPath: key] }, set: { draft[keyPath: key] = $0; draft.reviewValid = false })
    }

    private func draftField(_ map: WritableKeyPath<FoodDraft, [String: String]>, _ key: String) -> Binding<String> {
        Binding(get: { draft[keyPath: map][key] ?? "" }, set: {
            draft[keyPath: map][key] = $0
            draft.reviewValid = false
        })
    }

    private func commit(reviewed: Bool, log: Bool) {
        guard !busy else { return }
        busy = true
        error = ""
        Task {
            defer { busy = false }
            do { try await onSave(draft, reviewed, log) }
            catch { self.error = store.failure(error, "Error al guardar.") }
        }
    }

    private func startLookup() {
        guard !lookupBusy, !cleanText(lookup).isEmpty || !images.isEmpty else { return }
        lookupBusy = true
        lookupError = ""
        sourceInfo = ""
        missing = []
        discrepancies = []
        sweeteners = []
        fdc = []
        Task {
            defer { lookupBusy = false }
            do { try await lookupNutrition() }
            catch { self.lookupError = store.failure(error, "No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.", networkOnly: true) }
        }
    }

    private func lookupNutrition() async throws {
        let entered = cleanText(lookup)
        let digits = entered.filter { !$0.isWhitespace && $0 != "-" }
        if (8...14).contains(digits.count), digits.allSatisfy({ "0123456789".contains($0) }) {
            guard validEAN(digits) else { throw FeatureError("Código de barras inválido: dígito verificador no coincide, revísalo") }
            guard let off = try? await fetchOFF(digits) else { throw FeatureError(store.tr("EAN no encontrado en Open Food Facts.")) }
            applyLookup(off, source: "off", basis: off.text("per"))
            sweeteners = off.array("sweeteners").compactMap(\.object)
            return
        }
        let generated = try await estimateCatalogAI(store: store, text: entered, images: images)
        let candidate = generated.text("ean")
        let code = validEAN(candidate) ? candidate : ""
        let generic = generated.text("brand").isEmpty && code.isEmpty ? cleanText(generated.text("usda_query")) : ""
        async let off = optionalOFF(code)
        async let matches = optionalFDC(generic)
        let (catalog, suggested) = await (off, matches)
        fdc = suggested
        sweeteners = catalog?.array("sweeteners").compactMap(\.object) ?? []
        let result = resolveFoodSources(generated, off: catalog)
        discrepancies = result.mismatch.map(foodLabel)
        applyLookup(result.row, source: result.source, basis: result.basis)
    }

    private func optionalOFF(_ code: String) async -> Record? {
        guard validEAN(code) else { return nil }
        return try? await fetchOFF(code)
    }

    private func optionalFDC(_ query: String) async -> [Record] {
        guard !query.isEmpty else { return [] }
        return Array(((try? await searchFDC(store: store, query: query)) ?? []).prefix(6))
    }

    private func useFDC(_ value: Record) async {
        guard !lookupBusy, let id = value.number("fdcId").flatMap(Int.init(exactly:)), id > 0 else { return }
        lookupBusy = true
        lookupError = ""
        defer { lookupBusy = false }
        do {
            let item = try await fetchFDC(store: store, id: id)
            discrepancies = []
            sweeteners = []
            applyLookup(item, source: "usda", basis: "100g")
        } catch { self.lookupError = store.tr("No se pudo obtener el detalle de USDA.") }
    }

    private func applyLookup(_ sourceRow: Record, source: String, basis: String) {
        let numeric = checkedFoodNumbers(sourceRow)
        draft.fill(numeric, source: source, basis: basis)
        missing = (Domain.macroKeys + requiredFoodMicros).filter { nutritionValue(numeric, $0) == nil }.map(foodLabel)
        switch source {
        case "etiqueta": sourceInfo = "📋 " + store.tr("Etiqueta transcrita")
        case "gemini":
            let confidence = numeric.text("confidence").isEmpty ? "—" : store.tr(numeric.text("confidence"))
            sourceInfo = "≈ " + store.tr("Estimación IA") + " (" + store.tr("confianza") + " " + confidence + ")"
        case "off": sourceInfo = "✔ Open Food Facts: " + numeric.text("name")
        case "usda": sourceInfo = "USDA: " + numeric.text("name")
        default: sourceInfo = store.tr(foodSources[source] ?? source)
        }
    }

    private func foodLabel(_ key: String) -> String {
        store.tr(["kcal": "Kcal", "protein_g": "Proteína", "carbs_g": "Carbs", "fat_g": "Grasa"][key] ?? Domain.micros.first { $0.key == key }?.label ?? key)
    }
}

private func checkedFoodNumbers(_ source: Record) -> Record {
    var row = source
    let allowed = Set(Domain.micros.map(\.key))
    row["micros"] = .object(source.object("micros").filter { key, value in
        allowed.contains(key) && value.number.map { $0.isFinite && $0 >= 0 } == true
    })
    for key in Domain.macroKeys where row.number(key).map({ $0.isFinite && $0 >= 0 }) != true { row[key] = nil }
    return row
}

private func resolveFoodSources(_ ai: Record, off: Record?) -> (row: Record, source: String, basis: String, mismatch: [String]) {
    let ai = checkedFoodNumbers(ai)
    let basis = ai.text("basis") == "100ml" ? "100ml" : "100g"
    let catalog = off.map(checkedFoodNumbers)
    let sameBasis = catalog?.text("per") == basis
    if ai.text("mode") == "etiqueta" {
        var result = ai
        let mismatch: [String]
        if let catalog, sameBasis {
            result = fillFood(ai, with: catalog, requiredOnly: false)
            mismatch = (Domain.macroKeys + Domain.micros.map(\.key)).filter { key in
                guard let a = nutritionValue(ai, key), let b = nutritionValue(catalog, key), a > 5, b > 5 else { return false }
                return abs(a - b) / max(a, b) > 0.25
            }
        } else {
            // Metadata can be recovered from the same product independently of the nutrient basis.
            if let catalog { for key in ["name", "brand"] where result.text(key).isEmpty { result[key] = catalog[key] } }
            mismatch = []
        }
        return (result, "etiqueta", basis, mismatch)
    }
    if let catalog {
        var result = sameBasis ? fillFood(catalog, with: ai, requiredOnly: true) : catalog
        if catalog.text("per") == "100ml", let density = ai.number("density_g_ml"), density > 0 {
            result["density_g_ml"] = .number(density)
        }
        return (result, "off", catalog.text("per"), [])
    }
    return (ai, "gemini", basis, [])
}

private func fillFood(_ preferred: Record, with fallback: Record, requiredOnly: Bool) -> Record {
    var merged = preferred
    for key in Domain.macroKeys where merged.number(key) == nil {
        merged[key] = fallback.number(key).map(JSONValue.number)
    }
    for key in ["name", "brand"] where merged.text(key).isEmpty { merged[key] = fallback[key] }
    var micros = merged.object("micros")
    for (key, value) in fallback.object("micros") where !requiredOnly || requiredFoodMicros.contains(key) {
        if micros.number(key) == nil, let number = value.number { micros[key] = .number(number) }
    }
    merged["micros"] = .object(micros)
    return merged
}

struct CatalogCSVRow {
    let label: String
    var suffix = ""
    var count: Int? = nil  // substituted for %n in the translated suffix, like web "%n medidas"
    let warnings: [String]
    let valid: Bool
}

struct CatalogCSVPreview: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let rows: [CatalogCSVRow]

    var body: some View {
        if !rows.isEmpty {
            let warned = rows.filter { !$0.warnings.isEmpty }.count
            Text(store.tr("%n filas · %v se importarán").replacingOccurrences(of: "%n", with: String(rows.count))
                .replacingOccurrences(of: "%v", with: String(rows.filter(\.valid).count)) +
                (warned > 0 ? " · " + store.tr("%w con ⚠").replacingOccurrences(of: "%w", with: String(warned)) : ""))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
            ScrollView {
                VStack(spacing: 4) {
                    ForEach(rows.indices, id: \.self) { index in
                        let row = rows[index]
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(row.label + (row.suffix.isEmpty ? "" : (row.count == nil ? " " : " · ") + store.tr(row.suffix).replacingOccurrences(of: "%n", with: row.count.map(String.init) ?? ""))).lineLimit(1)
                            Spacer(minLength: 0)
                            if !row.warnings.isEmpty {
                                NutriIcon("triangle-alert", size: 13).foregroundStyle(palette.warn)
                                Text(row.warnings.map(store.tr).joined(separator: ", ")).font(.nutriSans(12)).foregroundStyle(palette.warn)
                            }
                        }.padding(.horizontal, 10).padding(.vertical, 6)
                            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(row.valid ? palette.border : palette.danger.opacity(0.4)) }
                            .opacity(row.valid ? 1 : 0.6)
                    }
                }
            }.frame(height: min(250, CGFloat(rows.count) * 34))
        }
    }
}

struct CatalogCSVSheet<Preview: View>: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let title: String
    let description: String
    let example: String
    @Binding var text: String
    @Binding var error: String
    let parseError: String
    let count: Int
    let busy: Bool
    let close: () -> Void
    let template: () -> Void
    let commit: () -> Void
    @ViewBuilder let preview: () -> Preview
    @State private var dragging = false
    @State private var importingFile = false

    var body: some View {
        NutriSheet(title, close: close) {
            VStack(alignment: .leading, spacing: 12) {
                Text(description).foregroundStyle(palette.text2)
                NutriFlow(spacing: 8) {
                    Button {
                        importingFile = true
                    } label: { HStack { NutriIcon("upload", size: 15); Text(store.tr("Subir archivo")) } }
                    Button(action: template) { HStack { NutriIcon("file-down", size: 15); Text(store.tr("Descargar plantilla")) } }
                }.buttonStyle(NutriButtonStyle(.secondary, height: 36))
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $text).nutriRawTextInput().scrollContentBackground(.hidden).font(.nutriMono(14))
                        .padding(8).frame(height: 120)
                        .accessibilityLabel(store.tr("Pega o sube un CSV"))
                        .accessibilityIdentifier("catalog.csv.text")
                    if text.isEmpty {
                        Text(dragging ? store.tr("Suelta el CSV aquí") : example).font(.nutriMono(14))
                            .foregroundStyle(palette.text3).padding(13).allowsHitTesting(false).accessibilityHidden(true)
                    }
                }
                .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(dragging ? palette.accentDeep : palette.border).allowsHitTesting(false) }
                preview()
                if !parseError.isEmpty || !error.isEmpty { Text([parseError, error].filter { !$0.isEmpty }.joined(separator: " · ")).font(.nutriSans(12)).foregroundStyle(palette.danger) }
            }
        } footer: {
            HStack {
                Button(store.tr("Cancelar"), action: close).buttonStyle(NutriButtonStyle(.secondary, height: 44))
                Spacer()
                Button(busy ? store.tr("Importando…") : store.tr("Importar %n").replacingOccurrences(of: "%n", with: String(count)), action: commit)
                    .buttonStyle(NutriButtonStyle(.primary, height: 44)).disabled(count == 0)
                    .accessibilityIdentifier("catalog.csv.commit")
            }
        }.font(.nutriSans(14)).foregroundStyle(palette.text)
            .nutriFilePicker(isPresented: $importingFile, types: [.commaSeparatedText, .plainText]) { result in
                do { if let url = try result.get().first { read(url) } }
                catch { self.error = error.localizedDescription }
            }
            .dropDestination(for: URL.self) { urls, _ in guard let url = urls.first else { return false }; read(url); return true }
                isTargeted: { dragging = $0 }
            .disabled(busy)
    }

    private func read(_ url: URL) {
        do {
            let data = try secureFileData(url)
            guard let csv = String(data: data, encoding: .utf8) else { throw FeatureError("El archivo debe estar en UTF-8.") }
            error = ""
            text = csv
        } catch { self.error = error.localizedDescription }
    }
}

struct CatalogUnitToggle: View {
    @Environment(\.nutriPalette) private var palette
    let units: [String]
    let current: String
    var height: CGFloat = 44
    let select: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(units, id: \.self) { unit in
                Button { select(unit) } label: {
                    Text(unit).font(.nutriSans(14, weight: unit == current ? .medium : .regular))
                        .padding(.horizontal, 10).frame(minWidth: nutriTouchSize(0), minHeight: nutriTouchSize(height))
                        .foregroundStyle(unit == current ? palette.bg : palette.text2)
                        .background(unit == current ? palette.accent : palette.surface2)
                }.buttonStyle(.plain).accessibilityAddTraits(unit == current ? .isSelected : [])
            }
        }.clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.border).allowsHitTesting(false) }
    }
}

struct CatalogPortionsEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var portions: [CatalogPortion]
    var density: Double = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.tr("Porciones (opcional)")).foregroundStyle(palette.text2)
            ForEach($portions) { $portion in
                let unit = density > 0 && !portion.unit.isEmpty ? portion.unit : (store.units == "us" ? "oz" : "g")
                let converted = ["ml", "fl oz"].contains(unit)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        TextField(store.tr("vaso, cucharada, rebanada…"), text: $portion.name)
                            .nutriInput().accessibilityLabel(store.tr("Nombre de la porción"))
                        if density > 0 {
                            CatalogUnitToggle(units: store.units == "us" ? ["oz", "fl oz"] : ["g", "ml"], current: unit) { next in
                                portion.unit = next
                                portion.amount = display(portion.grams, unit: next)
                            }
                        }
                        TextField(unit, text: Binding(
                            get: { portion.amount ?? display(portion.grams, unit: unit) },
                            set: { value in
                                portion.amount = value
                                if let n = decimal(value), let grams = Domain.grams(n, unit: unit, density: density) {
                                    portion.grams = unit == "g" ? value : draftNumber(Domain.round(grams, 1))
                                } else { portion.grams = value.isEmpty || unit == "g" ? value : "0" }
                            }))
                            .font(.nutriMono(14)).nutriDecimalKeyboard().nutriInput().frame(width: density > 0 ? 80 : 96)
                            .accessibilityLabel(store.tr("Cantidad de la porción") + " (" + unit + ")")
                        Button { portions.removeAll { $0.id == portion.id } } label: { NutriIcon("x", size: 18) }
                            .buttonStyle(NutriButtonStyle(.secondary, height: 44, horizontal: 13)).accessibilityLabel(store.tr("Quitar porción"))
                    }
                    if converted, !portion.grams.isEmpty {
                        Text("≈ \(portion.grams) g").font(.nutriMono(12)).foregroundStyle(palette.text3)
                    }
                }
            }
            Button { portions.append(CatalogPortion()) } label: { Text("+ " + store.tr("Añadir porción")).frame(maxWidth: .infinity) }
                .buttonStyle(NutriButtonStyle(.secondary, height: 44))
        }
        .onChange(of: density) { _, _ in
            for index in portions.indices { portions[index].unit = ""; portions[index].amount = nil }
        }
    }

    private func display(_ grams: String, unit: String) -> String {
        guard let value = decimal(grams), let factor = Domain.grams(1, unit: unit, density: density) else { return "" }
        return unit == "g" ? grams : draftNumber(Domain.round(value / factor, unit == "ml" ? 1 : 2))
    }
}

#if os(iOS)
struct SwipeCardTapStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .onTapGesture { configuration.trigger() }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { configuration.trigger() }
    }
}
#endif

struct CatalogSwipeCard<Content: View>: View {
    @EnvironmentObject private var store: Store
    let open: () -> Void
    let delete: (() -> Void)?
    var radius: CGFloat = 16
    var padding: CGFloat = 16
    @ViewBuilder let content: () -> Content

    var body: some View {
        Button(action: open) {
            content().padding(padding).frame(maxWidth: .infinity, alignment: .leading).nutriCard(radius: radius)
        }
        #if os(iOS)
        .buttonStyle(SwipeCardTapStyle())
        #else
        .buttonStyle(.plain)
        #endif
            .modifier(SwipeToDelete(radius: radius, delete: delete))
            .contextMenu { if let delete { Button(store.tr("Borrar"), role: .destructive, action: delete) } }
            .accessibilityActions {
                if let delete { Button(store.tr("Borrar"), action: delete) }
            }
    }
}

struct SwipeToDelete: ViewModifier {
    @Environment(\.nutriPalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let radius: CGFloat
    let delete: (() -> Void)?
    @GestureState private var drag: CGFloat = 0
    #if os(iOS)
    @State private var panOffset: CGFloat = 0
    #endif
    @State private var width: CGFloat = 300

    func body(content: Content) -> some View {
        if let delete {
            #if os(iOS)
            if #available(iOS 18, *) {
                card(content, offset: panOffset)
                    .gesture(LeftSwipePan(onChange: { panOffset = min(0, $0) }, onEnd: { translation in
                        panOffset = 0
                        if let translation, passesThreshold(x: translation.x, y: translation.y) { delete() }
                    }))
            } else {
                legacySwipe(content, delete: delete)
            }
            #else
            legacySwipe(content, delete: delete)
            #endif
        } else {
            content
        }
    }

    private func card(_ content: Content, offset: CGFloat) -> some View {
        ZStack(alignment: .trailing) {
            if offset < 0 {
                palette.danger
                NutriIcon("trash-2", size: 20).foregroundStyle(palette.text).padding(.trailing, 16)
            }
            content.offset(x: offset)
        }.clipShape(RoundedRectangle(cornerRadius: radius))
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: offset == 0)
    }

    private func legacySwipe(_ content: Content, delete: @escaping () -> Void) -> some View {
        card(content, offset: drag)
            .simultaneousGesture(DragGesture(minimumDistance: 8, coordinateSpace: .global).updating($drag) { event, state, _ in
                let translation = event.translation
                state = translation.width < -abs(translation.height) ? translation.width : 0
            }.onEnded { event in
                if passesThreshold(x: event.translation.width, y: event.translation.height) { delete() }
            })
    }

    private func passesThreshold(x: CGFloat, y: CGFloat) -> Bool {
        x < -max(abs(y), min(96, width * 0.35))
    }
}

#if os(iOS)
@available(iOS 18, *)
private struct LeftSwipePan: UIGestureRecognizerRepresentable {
    let onChange: (CGFloat) -> Void
    let onEnd: (CGPoint?) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .began, .changed: onChange(pan.translation(in: nil).x)
        case .ended: onEnd(pan.translation(in: nil))
        case .cancelled, .failed: onEnd(nil)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            return velocity.x < -abs(velocity.y)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let scroll = otherGestureRecognizer.view as? UIScrollView else { return false }
            return otherGestureRecognizer === scroll.panGestureRecognizer
        }
    }
}
#endif

#if DEBUG
func checkCatalogFidelity() throws {
    func check(_ ok: Bool, _ description: String) throws {
        if !ok { throw FeatureError("Catalog check failed · " + description) }
    }
    try check(["96385074", "036000291452", "4006381333931", "04006381333931"].allSatisfy(validEAN), "GS1 accepts all four valid lengths")
    try check(!validEAN("4006381333932") && !validEAN("400638133") && !validEAN("٤٠٠٦٣٨١٣٣٣٩٣١"), "GS1 rejects invalid digits and length")
    let product: Record = ["nutrition_data_per": .string("100ml"), "brands": .string("Original, Otro"),
                           "nutriments": .object(["energy_100g": .number(418.4), "salt_100g": .number(0.25), "fiber_100g": .number(0)]),
                           "additives_tags": .array([.string("en:e955"), .string("es:E955"), .string("en:e960c")])]
    let off = mapOFFProduct(product)
    try check(off.text("per") == "100ml" && off.number("kcal") == 100 && off.text("brand") == "Original", "OFF keeps declared basis, converts kJ and chooses first brand")
    try check(nutritionValue(off, "sodio_mg") == 100 && nutritionValue(off, "fibra_g") == 0 && nutritionValue(off, "potasio_mg") == nil && off.array("sweeteners").count == 2, "OFF preserves measured zeroes, salt fallback and deduplicates additives")
    let partialOFF = mapOFFProduct(["nutriments": .object([
        "energy-kcal_100g": .string(""), "energy_100g": .number(418.4), "proteins_100g": .string(" "),
        "fiber_100g": .string(""), "fat_100g": .number(-0.001), "trans-fat_100g": .number(0),
        "sodium_100g": .string(""), "salt_100g": .string("0,25")
    ])])
    try check(partialOFF.number("kcal") == 100 && partialOFF.number("protein_g") == nil && partialOFF.number("fat_g") == nil &&
              nutritionValue(partialOFF, "fibra_g") == nil && nutritionValue(partialOFF, "grasa_trans_g") == 0 &&
              nutritionValue(partialOFF, "sodio_mg") == 100, "OFF blanks and invalid values stay unknown; zeros and fallbacks survive")
    let label: Record = ["mode": .string("etiqueta"), "basis": .string("100ml"), "kcal": .number(70), "micros": .object(["sodio_mg": .number(0), "fibra_g": .number(2)])]
    let labelResult = resolveFoodSources(label, off: off)
    try check(labelResult.source == "etiqueta" && labelResult.basis == "100ml" && labelResult.mismatch == ["kcal"] && nutritionValue(labelResult.row, "sodio_mg") == 0, "same-basis label beats OFF, retains zero, flags >25% discrepancy")
    let incompatible = resolveFoodSources(label.merging(["basis": .string("100g"), "micros": .object([:])]) { _, new in new }, off: off)
    try check(incompatible.mismatch.isEmpty && nutritionValue(incompatible.row, "sodio_mg") == nil, "different bases are neither compared nor mixed")
    let estimate: Record = ["mode": .string("estimacion"), "basis": .string("100ml"), "kcal": .number(12),
                            "micros": .object(["potasio_mg": .number(19), "calcio_mg": .number(5)])]
    let offResult = resolveFoodSources(estimate, off: off)
    try check(offResult.source == "off" && offResult.row.number("kcal") == 100 && nutritionValue(offResult.row, "potasio_mg") == 19 && nutritionValue(offResult.row, "calcio_mg") == nil, "OFF estimates fill missing required fields only")
    let nutrients: [[Double]] = [[2047, 108], [2048, 112], [1008, 110], [2048, 115], [1093, 0.2], [1079, 0]]
    let fdc = mapFDCFood(["foodNutrients": .array(nutrients.map { value in
        .object(["amount": .number(value[1]), "nutrient": .object(["id": .number(value[0]), "unitName": .string(value[0] > 2000 || value[0] == 1008 ? "kcal" : "g")])])
    })])
    try check(fdc.number("kcal") == 110 && nutritionValue(fdc, "sodio_mg") == 200 && nutritionValue(fdc, "fibra_g") == 0,
        "FDC priority: direct energy beats Atwater; explicit compatible units")
    var draft = FoodDraft(["name": .string("Leche"), "kcal": .number(104), "protein_g": .number(10.4), "carbs_g": .number(20.8), "fat_g": .number(0), "micros": .object(["fibra_g": .number(0)])])
    draft.unit = "ml"
    let blocked = (try? draft.payload()) == nil
    try check(blocked, "food ml cannot store without density")
    draft.density = "1.04"; draft.portions = [CatalogPortion(name: "vaso", grams: "55")]
    let normalized = try draft.payload()
    try check(normalized.number("kcal") == 100 && normalized.number("protein_g") == 10 && normalized.number("fat_g") == 0 &&
              nutritionValue(normalized, "fibra_g") == 0 && nutritionValue(normalized, "sodio_mg") == nil &&
              normalized.array("portions").first?.object?.number("grams") == 55, "per-100g normalizes values only; zeroes, null and portions survive")
    var negative = draft
    negative.basis = "1000"
    negative.macros["protein_g"] = "-0.001"
    try check((try? negative.payload()) == nil, "food validates a negative macro before it can round to zero")
    negative = draft
    negative.basis = "1000"
    negative.micros["sodio_mg"] = "-0.001"
    try check((try? negative.payload()) == nil, "food validates a negative micro before it can round to zero")
    let imported = try FoodImportRow.parse("name,kcal,protein_g,carbs_g,fat_g,fibra_g\nAvena,,17,66,7,0\nSin datos,,17,,,\n")
    try check(imported.count == 2 && imported[0].payload?.number("kcal") == 395 && !imported[1].preview.valid, "food preview validates each row; missing kcal calculated, missing macro blocked")
    let body = try BodyImportRow.preview("day,weight,body_fat,note\n2026-01-01,0,85,prueba\n2026-01-01,1,,\n2026-02-30,5,,\n")
    try check(body.count == 3 && body[0].value?.metrics.number("peso_kg") == 0 && body[0].preview.warnings == ["fuera de rango"] &&
              body[1].value == nil && body[2].value == nil, "body preview aliases, measured zero, warning, duplicate and invalid day")
    var ingredient = RecipeIngredient(food: ["density_g_ml": .number(1.03)], amount: "123.4567")
    ingredient.changeUnit(to: "fl oz"); ingredient.changeUnit(to: "oz"); ingredient.changeUnit(to: "g")
    try check(ingredient.grams == 123.4567, "recipe unit switches preserve canonical grams")
    let demo = try catalogAIDemo(recipe: false, language: "en")
    try check(demo.text("name") == "Greek yogurt, plain" && demo.number("kcal") == 94.5, "demo translates name without changing values")
    let schema = foodAISchema().object("properties").object("micros")
    try check(schema.array("required").compactMap(\.string) == Domain.micros.map(\.key), "food schema requires every canonical micro")
}
#endif
