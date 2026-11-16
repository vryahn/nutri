import NutriCore
import SwiftUI
import UniformTypeIdentifiers

private let foodDensityPresets: [(String, Double)] = [
    ("Agua, café, té o caldo", 1), ("Leche", 1.03), ("Jugo o refresco", 1.04),
    ("Yogur bebible o licuado", 1.05), ("Bebida alcohólica", 0.99), ("Aceite", 0.92), ("Miel o jarabe", 1.4)
]
private let foodSources = [
    "manual": "Manual", "etiqueta": "Etiqueta", "gemini": "IA",
    "off": "Open Food Facts", "usda": "USDA", "cronometer": "Cronometer", "ia_personal": "IA personal"
]
private let requiredFoodMicros = ["sodio_mg", "potasio_mg", "magnesio_mg"]

private struct FoodPortion: Identifiable {
    let id = UUID()
    var name = ""
    var grams = ""
}

private struct FoodDraft: Identifiable {
    let id = UUID()
    let original: Record
    var name: String
    var brand: String
    var macros: [String: String]
    var micros: [String: String]
    var portions: [FoodPortion]
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
            FoodPortion(name: $0.text("name"), grams: draftNumber($0.number("grams")))
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
        guard let amount = decimal(basis) else { return nil }
        return Domain.grams(amount, unit: unit, density: decimal(density))
    }

    var warnings: [String] {
        guard let grams = equivalentGrams, grams.isFinite, (10_000 / grams).isFinite else { return [] }
        let raw = enteredValues
        let normalized = normalizedValues(raw, grams: grams)
        // A missing macro must not create a fictitious mismatch with a declared kcal.
        let allMacros = Domain.macroKeys.dropFirst().allSatisfy { raw.number($0) != nil }
        return Domain.foodWarnings(normalized).filter { allMacros || $0 != "Las kcal no coinciden con los macros." }
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
        let densityValue = try featureNumber(density, label: "Densidad")
        if let densityValue, densityValue <= 0 { throw FeatureError("La densidad debe ser mayor que cero.") }
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
        let savedPortions = try portions.compactMap { portion -> JSONValue? in
            let label = cleanText(portion.name)
            if label.isEmpty, cleanText(portion.grams).isEmpty { return nil }
            guard !label.isEmpty, let grams = try featureNumber(portion.grams, label: label), grams > 0 else {
                throw FeatureError("Cada porción necesita un nombre y gramos mayores que cero.")
            }
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
        if let value = row.number("density_g_ml"), value > 0 {
            let chosen = foodDensityPresets.min { abs($0.1 - value) < abs($1.1 - value) }?.1 ?? value
            let next = abs(chosen - value) <= 0.015 ? chosen : value
            density = draftNumber(next)
            densitySelection = Self.densityChoice(next)
        } else if basis == "100ml" {
            density = ""
            densitySelection = ""
        }
        self.source = source
        self.basis = "100"
        unit = basis == "100ml" ? "ml" : "g"
        reviewValid = false
    }
}

private struct FoodImportRow: Identifiable {
    let id = UUID()
    let payload: Record
    let warnings: [String]

    static let headers = ["name", "brand"] + Domain.macroKeys + ["density_g_ml", "source"] + Domain.micros.map(\.key) + ["portions"]
    static func parse(_ text: String) throws -> [Self] {
        try CSV.parse(text).enumerated().map { index, row in
            var draft = FoodDraft()
            draft.name = row["name"] ?? ""
            draft.brand = row["brand"] ?? ""
            draft.macros = row.filter { Domain.macroKeys.contains($0.key) }
            draft.micros = row.filter { cell in Domain.micros.contains { $0.key == cell.key } }
            draft.density = row["density_g_ml"] ?? ""
            draft.source = cleanText(row["source"] ?? "")
            if draft.source.isEmpty { draft.source = "manual" }
            do {
                if let portions = row["portions"], !cleanText(portions).isEmpty {
                    let values = try JSONDecoder().decode([Record].self, from: Data(portions.utf8))
                    draft.portions = values.map { FoodPortion(name: $0.text("name"), grams: draftNumber($0.number("grams"))) }
                }
                let payload = try draft.payload()
                return Self(payload: payload, warnings: Domain.foodWarnings(payload))
            } catch {
                throw FeatureError("Fila \(index + 2) · \(error.localizedDescription)")
            }
        }
    }

    static func export(_ foods: [Record]) throws -> String {
        let rows = try foods.map { food in
            try headers.map { key in
                if key == "portions" {
                    return String(decoding: try JSONEncoder().encode(food.array("portions")), as: UTF8.self)
                }
                return food[key]?.string ?? draftNumber(nutritionValue(food, key))
            }
        }
        return CSV.encode([headers] + rows)
    }
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
    @State private var foods: [Record] = []
    @State private var semantic: [Record] = []
    @State private var query = ""
    @State private var source = ""
    @State private var ownerOnly = false
    @State private var warnOnly = false
    @State private var sort = ""
    @State private var descending = false
    @State private var busy = false
    @State private var loading = true
    @State private var failed = false
    @State private var draft: FoodDraft?
    @State private var importRows: [FoodImportRow] = []
    @State private var importReview = false
    @State private var importError = ""

    private var term: String { CSV.normalize(query) }
    private var matching: [Record] {
        guard !term.isEmpty else { return foods }
        return foods.filter { CSV.normalize($0.text("name") + " " + $0.text("brand")).contains(term) }
    }
    private var visible: [FoodListItem] {
        let hits = matching
        let found = Set(hits.map { $0.text("id") })
        let rows = hits + semantic.filter { !found.contains($0.text("id")) }
        let filtered = rows.filter { row in
            (source.isEmpty || row.text("source") == source) &&
            (!ownerOnly || row.text("owner") == store.owner) && (!warnOnly || foodWarningPending(row))
        }
        guard !sort.isEmpty else { return filtered.map(FoodListItem.init) }
        return filtered.sorted { a, b in
            if sort != "name", let x = a.number(sort), let y = b.number(sort), x != y {
                return descending ? x > y : x < y
            }
            let result = a.text("name").localizedStandardCompare(b.text("name"))
            return sort == "name" && descending ? result == .orderedDescending : result == .orderedAscending
        }.map(FoodListItem.init)
    }

    var body: some View {
        VStack(spacing: 8) {
            ColumnHeader(store.tr("Alimentos")) {
                Menu(store.tr("Importar y exportar"), systemImage: "arrow.up.arrow.down") {
                    Button(store.tr("Importar CSV…")) { importCSV() }
                    Button(store.tr("Descargar plantilla CSV…")) { export([]) }
                    Button(store.tr("Exportar catálogo personal…")) { export(foods.filter { $0.text("owner") == store.owner }) }
                }
                Button(store.tr("Nuevo alimento"), systemImage: "plus") { draft = FoodDraft() }
                    .buttonStyle(.borderedProminent).keyboardShortcut("n", modifiers: [.command, .shift])
            }
            filters.padding(.horizontal, 24)
            if loading && foods.isEmpty {
                ProgressView().frame(maxHeight: .infinity)
            } else if failed && foods.isEmpty {
                VStack {
                    Text(store.tr("No se pudieron cargar los alimentos"))
                    Button(store.tr("Reintentar")) { Task { await reload() } }
                }.frame(maxHeight: .infinity)
            } else if visible.isEmpty {
                ContentUnavailableView(store.tr("Sin alimentos"), systemImage: "magnifyingglass")
            } else {
                List(visible) { food in
                    foodRow(food.row)
                }.listStyle(.inset)
            }
        }
        .task { await reload() }
        .task(id: query) { await semanticSearch() }
        .sheet(item: $draft) { item in
            FoodEditor(draft: item, onSave: save, onDelete: remove)
        }
        .sheet(isPresented: $importReview) { importSheet }
    }

    private var filters: some View {
        HStack {
            TextField(store.tr("Buscar alimento o marca"), text: $query).textFieldStyle(.roundedBorder)
            Picker(store.tr("Fuente"), selection: $source) {
                Text(store.tr("Todas")).tag("")
                ForEach(Set(foods.map { $0.text("source") }).filter { !$0.isEmpty }.sorted(), id: \.self) { item in
                    Text(store.tr(foodSources[item] ?? item)).tag(item)
                }
            }.frame(maxWidth: 150)
            Toggle(store.tr("Personales"), isOn: $ownerOnly)
            Toggle(store.tr("Por revisar"), isOn: $warnOnly)
            Menu {
                Picker(store.tr("Orden"), selection: $sort) {
                    Text(store.tr("Relevancia")).tag("")
                    Text(store.tr("Nombre")).tag("name")
                    ForEach(nutritionMacros, id: \.key) { macro in Text(store.tr(macro.label)).tag(macro.key) }
                }
                Toggle(store.tr("Descendente"), isOn: $descending)
            } label: { Image(systemName: "arrow.up.arrow.down").accessibilityLabel(store.tr("Orden")) }
            .fixedSize()
        }
    }

    private func foodRow(_ row: Record) -> some View {
        HStack(spacing: 12) {
            Button {
                draft = FoodDraft(row)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.text("name")).font(.headline)
                    let info = [
                        row.text("brand"), store.tr(foodSources[row.text("source")] ?? row.text("source")),
                        row.text("owner").isEmpty ? store.tr("Catálogo base") : ""
                    ].filter { !$0.isEmpty }.joined(separator: " · ")
                    if !info.isEmpty { Text(info).font(.caption).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.plain)
            if foodWarningPending(row) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    .accessibilityLabel(store.tr("Valores nutricionales requieren revisión"))
            }
            Text("\(numberText(row.number("kcal"), digits: 1)) kcal")
                .monospacedDigit().frame(width: 86, alignment: .trailing)
                .help(store.tr("Por 100 g"))
            ForEach(nutritionMacros.dropFirst(), id: \.key) { macro in
                VStack(alignment: .trailing, spacing: 1) {
                    Text(store.tr(macro.label)).font(.caption2).foregroundStyle(.secondary)
                    Text("\(numberText(row.number(macro.key), digits: 1)) g").monospacedDigit()
                }
                .frame(width: 77, alignment: .trailing)
                .help(store.tr("Por 100 g"))
            }
            Button(store.tr("Registrar"), systemImage: "plus.circle") { store.logFood = row }
                .labelStyle(.iconOnly).buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button(store.tr("Editar")) { draft = FoodDraft(row) }
            Button(store.tr("Duplicar")) {
                var copy = row
                copy["id"] = nil
                copy["reviewed_at"] = nil
                draft = FoodDraft(copy)
            }
            if row.text("owner") == store.owner {
                Button(store.tr("Eliminar"), role: .destructive) {
                    Task { do { try await remove(row) } catch { store.report(error) } }
                }
            }
        }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            foods = try await store.catalog().filter { !Domain.water($0) }
            failed = false
        } catch {
            if !Task.isCancelled { failed = true; store.report(error) }
        }
    }

    private func semanticSearch() async {
        semantic = []
        let search = cleanText(query)
        guard search.count >= 3, !store.offline else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            guard matching.count < 8, !store.demoActive, !store.anonymous else { return }
            let hits = try await searchSemanticFoods(store: store, query: search)
            guard !Task.isCancelled, cleanText(query) == search else { return }
            semantic = hits.filter { !Domain.water($0) }
        } catch { /* Local search remains usable. */ }
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
        foods.removeAll { $0.text("id") == saved.text("id") }
        foods.append(saved)
        semantic.removeAll { $0.text("id") == saved.text("id") }
        self.draft = nil
        store.toast(store.tr("Guardado."))
        if log { store.logFood = saved }
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
        let id = row.text("id")
        guard let deleted = try await store.delete("foods", ["id": "eq.\(id)"]).first else {
            throw FeatureError("El servidor no confirmó el borrado.")
        }
        foods.removeAll { $0.text("id") == id }
        semantic.removeAll { $0.text("id") == id }
        draft = nil
        store.undo(store.tr("Alimento borrado")) {
            guard store.owner == owner else { throw CancellationError() }
            foods.append(try await store.insert("foods", deleted))
        }
    }

    private var importSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Importar alimentos")).font(.title2.bold())
            Text(store.tr("Revisa los valores antes de guardar.")).foregroundStyle(.secondary)
            List(importRows) { item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.payload.text("name"))
                    if !item.warnings.isEmpty {
                        Text(item.warnings.map(store.tr).joined(separator: " · ")).foregroundStyle(.orange)
                    }
                }
            }.frame(minHeight: 200)
            if !importError.isEmpty { Text(importError).foregroundStyle(.red) }
            HStack {
                Button(store.tr("Cancelar")) { importReview = false }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("\(store.tr("Importar")) · \(importRows.count)") { Task { await commitImport() } }
                    .buttonStyle(.borderedProminent)
            }.disabled(busy)
        }.padding(20).frame(minWidth: 520).interactiveDismissDisabled(busy)
    }

    private func importCSV() {
        guard let url = openFiles([.commaSeparatedText, .plainText]).first else { return }
        do {
            let data = try secureFileData(url)
            guard let text = String(data: data, encoding: .utf8) else { throw FeatureError("El archivo debe estar en UTF-8.") }
            importRows = try FoodImportRow.parse(text)
            guard !importRows.isEmpty else { throw FeatureError("No hay alimentos en el CSV.") }
            importError = ""
            importReview = true
        } catch { store.report(error) }
    }

    private func commitImport() async {
        guard !busy, let owner = store.owner else { return }
        busy = true
        defer { busy = false }
        do {
            let payload = importRows.map { $0.payload.merging(["owner": .string(owner)]) { _, new in new } }
            foods += try await store.insert("foods", payload)
            importReview = false
            store.toast("\(payload.count) \(store.tr("alimentos importados"))")
        } catch { importError = error.localizedDescription }
    }

    private func export(_ rows: [Record]) {
        do { try saveFeatureFile(Data(FoodImportRow.export(rows).utf8), name: "nutri_alimentos.csv", type: .commaSeparatedText) }
        catch { store.report(error) }
    }
}

private struct FoodEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var draft: FoodDraft
    let onSave: (FoodDraft, Bool, Bool) async throws -> Void
    let onDelete: (Record) async throws -> Void
    @State private var busy = false
    @State private var error = ""
    @State private var lookupBusy = false
    @State private var lookup = ""
    @State private var images: [URL] = []
    @State private var sourceInfo = ""
    @State private var missing: [String] = []
    @State private var discrepancies: [String] = []
    @State private var sweeteners: [Record] = []
    @State private var fdc: [Record] = []
    @State private var moreMicros = false
    @State private var microQuery = ""

    private var editing: Bool { !draft.original.text("id").isEmpty }
    private var own: Bool { editing && draft.original.text("owner") == store.owner }
    private var favorites: [String] { store.prefs.array("fav_micros").compactMap(\.string) }
    private var primaryMicros: [Nutrient] {
        let visible = Set(Domain.micros.prefix(8).map(\.key)).union(favorites)
        return Domain.micros.filter { visible.contains($0.key) }
    }
    private var title: String {
        if draft.isBase { return "Alimento del catálogo base" }
        return editing ? "Editar alimento" : "Nuevo alimento"
    }
    private var canSave: Bool {
        !cleanText(draft.name).isEmpty && draft.equivalentGrams != nil
    }

    var body: some View {
        VStack(spacing: 0) {
            EditorTitle(title: store.tr(title)) { dismiss() }.padding(18)
            Form {
                lookupSection
                basics
                nutrients
                portionSection
                warnings
            }
            .formStyle(.grouped).disabled(busy || lookupBusy)
            if !error.isEmpty {
                Text(error).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 18)
            }
            if busy || lookupBusy { ProgressView().controlSize(.small).padding(8) }
            footer.padding(18)
        }
        .frame(minWidth: 680, idealWidth: 750, minHeight: 580, idealHeight: 740)
        .interactiveDismissDisabled(busy || lookupBusy)
    }

    private var lookupSection: some View {
        Section(store.tr("Datos con IA")) {
            TextField(store.tr("Descripción o código de barras"), text: $lookup)
                .onSubmit { startLookup() }
            HStack {
                Button(store.tr("Añadir fotos…"), systemImage: "photo.badge.plus") {
                    images = Array(openFiles([.image], multiple: true).prefix(3))
                }.disabled(store.anonymous || store.demoActive)
                if !images.isEmpty {
                    Text("\(images.count) \(store.tr("fotos"))").foregroundStyle(.secondary)
                    Button(store.tr("Quitar fotos")) { images = [] }
                }
                Spacer()
                Button(store.tr("Obtener datos"), action: startLookup)
                    .disabled(cleanText(lookup).isEmpty && images.isEmpty)
            }
            if !sourceInfo.isEmpty {
                Text(sourceInfo).font(.callout.weight(.medium))
                Text(store.tr("Revisa los valores antes de guardar.")).foregroundStyle(.secondary)
            }
            if !missing.isEmpty { Label(store.tr("Sin dato fiable de:") + " " + missing.joined(separator: ", "), systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if !discrepancies.isEmpty { Label(store.tr("La etiqueta difiere de Open Food Facts") + " · " + discrepancies.joined(separator: ", "), systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if !sweeteners.isEmpty {
                let names = sweeteners.map { $0.text("name").isEmpty ? $0.text("code") : $0.text("name") }
                Text(store.tr("Edulcorantes detectados sin cantidad declarada") + " · " + names.joined(separator: ", "))
                    .foregroundStyle(.secondary)
            }
            if !fdc.isEmpty {
                Menu(store.tr("Alternativas USDA")) {
                    ForEach(fdc.indices, id: \.self) { index in
                        Button(fdc[index].text("description")) { Task { await useFDC(fdc[index]) } }
                    }
                }
            }
        }
    }

    private var basics: some View {
        Section(store.tr("Identificación")) {
            TextField(store.tr("Nombre"), text: edit(\.name))
            TextField(store.tr("Marca"), text: edit(\.brand))
            if draft.isBase {
                Text(store.tr("Tus cambios se guardan como una copia personal.")).foregroundStyle(.secondary)
            }
            LabeledContent(store.tr("Fuente"), value: store.tr(foodSources[draft.source] ?? draft.source))
        }
    }

    private var nutrients: some View {
        Section(store.tr("Valores nutricionales")) {
            LabeledContent(store.tr("Valores por")) {
                HStack {
                    TextField("100", text: edit(\.basis)).frame(width: 86)
                    Picker(store.tr("Unidad"), selection: edit(\.unit)) {
                        Text("g").tag("g")
                        Text("ml").tag("ml")
                    }.labelsHidden().pickerStyle(.segmented).frame(width: 92)
                    if store.units == "us", let amount = decimal(draft.basis) {
                        Text(draft.unit == "ml" ? "≈ \(numberText(amount / Domain.mlPerFluidOunce)) fl oz" : "≈ \(numberText(amount / Domain.gramsPerOunce)) oz")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if draft.unit == "ml", draft.equivalentGrams == nil {
                Text(store.tr("Elige el tipo de líquido para convertir ml a gramos")).foregroundStyle(.orange)
            }
            ForEach(nutritionMacros, id: \.key) { macro in
                let estimate = macro.key == "kcal" && Domain.macroKeys.dropFirst().allSatisfy { draft.enteredValues.number($0) != nil }
                    ? "≈ \(numberText(Domain.kcalFromMacros(draft.enteredValues), digits: 0))" : "—"
                valueField(macro.label, unit: macro.unit, field: draftField(\.macros, macro.key), placeholder: estimate)
            }
            ForEach(primaryMicros) { micro in microField(micro) }
            DisclosureGroup(store.tr("Más micros"), isExpanded: $moreMicros) {
                TextField(store.tr("Buscar nutriente"), text: $microQuery)
                ForEach(Domain.categories, id: \.self) { category in
                    let term = CSV.normalize(microQuery)
                    let fields = Domain.micros.filter { $0.category == category &&
                        (term.isEmpty || CSV.normalize($0.label + " " + $0.key).contains(term)) }
                    if !fields.isEmpty {
                        Text(store.tr(category)).font(.headline)
                        ForEach(fields) { micro in microField(micro) }
                    }
                }
            }
        }
    }

    private func valueField(_ label: String, unit: String, field: Binding<String>, placeholder: String = "—") -> some View {
        LabeledContent("\(store.tr(label)) · \(unit)") {
            TextField(placeholder, text: field).frame(width: 120)
                .accessibilityLabel("\(store.tr(label)) · \(unit)")
        }
    }

    private func microField(_ micro: Nutrient) -> some View {
        let favorite = favorites.contains(micro.key)
        return HStack {
            valueField(micro.label, unit: micro.unit, field: draftField(\.micros, micro.key))
            Button {
                Task {
                    do {
                        let updated = favorite ? favorites.filter { $0 != micro.key } : favorites + [micro.key]
                        try await store.patchPrefs(["fav_micros": .array(updated.map(JSONValue.string))])
                    } catch { store.report(error) }
                }
            } label: { Image(systemName: favorite ? "star.fill" : "star") }
            .buttonStyle(.borderless)
            .accessibilityLabel(store.tr(favorite ? "Quitar de favoritos" : "Marcar como favorito") + " · " + store.tr(micro.label))
        }
    }

    private var portionSection: some View {
        Section(store.tr("Porciones y densidad")) {
            Picker(store.tr("Tipo de líquido"), selection: Binding(get: { draft.densitySelection }, set: { value in
                draft.densitySelection = value
                if value != "other" { draft.density = value }
                draft.reviewValid = false
            })) {
                Text(store.tr("Sin densidad")).tag("")
                ForEach(foodDensityPresets, id: \.0) { label, density in Text(store.tr(label)).tag(String(density)) }
                Text(store.tr("Otro…")).tag("other")
            }
            if draft.densitySelection == "other" {
                TextField(store.tr("Densidad (g/ml)"), text: edit(\.density))
            }
            ForEach($draft.portions) { $portion in
                HStack {
                    TextField(store.tr("Nombre de porción"), text: $portion.name)
                    TextField("g", text: $portion.grams).frame(width: 78).accessibilityLabel(store.tr("Gramos"))
                    Button(store.tr("Quitar porción"), systemImage: "minus.circle", role: .destructive) {
                        draft.portions.removeAll { $0.id == portion.id }
                        draft.reviewValid = false
                    }.labelStyle(.iconOnly).buttonStyle(.borderless)
                }
                .onChange(of: portion.name) { _, _ in draft.reviewValid = false }
                .onChange(of: portion.grams) { _, _ in draft.reviewValid = false }
            }
            Button(store.tr("Añadir porción"), systemImage: "plus") {
                draft.portions.append(FoodPortion())
                draft.reviewValid = false
            }
        }
    }

    @ViewBuilder
    private var warnings: some View {
        let alerts = draft.warnings
        if !alerts.isEmpty {
            Section(store.tr("Revisión de valores")) {
                ForEach(alerts, id: \.self) { warning in
                    Label(store.tr(warning), systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                }
                if draft.reviewValid {
                    Label(store.tr("Valores revisados"), systemImage: "checkmark.circle")
                } else if !draft.isBase {
                    Button(store.tr("Guardar como revisado")) { commit(reviewed: true, log: false) }.disabled(!canSave)
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            if own {
                Button(store.tr("Eliminar"), role: .destructive) {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { try await onDelete(draft.original) } catch { self.error = error.localizedDescription }
                    }
                }
            }
            Spacer()
            Button(store.tr("Cancelar")) { dismiss() }.keyboardShortcut(.cancelAction)
            Button(store.tr("Guardar y registrar")) { commit(reviewed: false, log: true) }.disabled(!canSave)
            Button(store.tr(draft.isBase ? "Guardar copia" : "Guardar")) { commit(reviewed: false, log: false) }
                .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(!canSave)
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
            catch { self.error = error.localizedDescription }
        }
    }

    private func startLookup() {
        guard !lookupBusy, !cleanText(lookup).isEmpty || !images.isEmpty else { return }
        lookupBusy = true
        error = ""
        sourceInfo = ""
        missing = []
        discrepancies = []
        sweeteners = []
        fdc = []
        Task {
            defer { lookupBusy = false }
            do { try await lookupNutrition() }
            catch { self.error = error.localizedDescription }
        }
    }

    private func lookupNutrition() async throws {
        let entered = cleanText(lookup)
        let digits = entered.filter { !$0.isWhitespace && $0 != "-" }
        if (8...14).contains(digits.count), digits.allSatisfy({ "0123456789".contains($0) }) {
            guard validEAN(digits) else { throw FeatureError("Código de barras inválido: dígito verificador no coincide, revísalo") }
            let off = try await fetchOFF(digits)
            applyLookup(off, source: "off", basis: off.text("per"))
            sweeteners = off.array("sweeteners").compactMap(\.object)
            return
        }
        guard !store.anonymous, !store.demoActive else { throw FeatureError("La asistencia de IA requiere una cuenta activa.") }
        let parts = [["text": JSONValue.string(entered.isEmpty ? "Lee los datos de las fotos." : entered)]] +
            (try images.map { try aiImagePart($0, maxSide: 1200) })
        let generated = try await generateNutritionJSON(store: store, prompt: foodPrompt(language: store.lang), parts: parts, schema: foodAISchema)
        let code = generated.text("ean").filter { !$0.isWhitespace && $0 != "-" }
        let generic = generated.text("brand").isEmpty ? cleanText(generated.text("usda_query")) : ""
        async let off = optionalOFF(code)
        async let matches = optionalFDC(generic)
        let (catalog, suggested) = await (off, matches)
        fdc = suggested
        sweeteners = catalog?.array("sweeteners").compactMap(\.object) ?? []
        let basis = generated.text("basis") == "100ml" ? "100ml" : "100g"
        let catalogBasis = catalog?.text("per")
        if generated.text("mode") == "etiqueta" {
            var result = generated
            if let catalog, catalogBasis == basis {
                result = fillFood(generated, with: catalog, requiredOnly: false)
                discrepancies = (Domain.macroKeys + Domain.micros.map(\.key)).compactMap { key in
                    guard let a = nutritionValue(generated, key), let b = nutritionValue(catalog, key), a > 5, b > 5,
                          abs(a - b) / max(a, b) > 0.25 else { return nil }
                    return foodLabel(key)
                }
            }
            applyLookup(result, source: "etiqueta", basis: basis)
        } else if let catalog {
            var result = catalogBasis == basis ? fillFood(catalog, with: generated, requiredOnly: true) : catalog
            if catalogBasis == "100ml", let density = generated.number("density_g_ml"), density > 0 {
                result["density_g_ml"] = .number(density)
            }
            applyLookup(result, source: "off", basis: catalog.text("per"))
        } else {
            applyLookup(generated, source: "gemini", basis: basis)
            let confidence = generated.text("confidence")
            if !confidence.isEmpty { sourceInfo += " · " + store.tr(confidence) }
        }
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
        error = ""
        defer { lookupBusy = false }
        do {
            let item = try await fetchFDC(store: store, id: id)
            discrepancies = []
            sweeteners = []
            applyLookup(item, source: "usda", basis: "100g")
        } catch { self.error = error.localizedDescription }
    }

    private func applyLookup(_ sourceRow: Record, source: String, basis: String) {
        var numeric = sourceRow
        let validMicros = Set(Domain.micros.map(\.key))
        let micros = sourceRow.object("micros").filter { key, value in
            validMicros.contains(key) && (value.number ?? -1) >= 0
        }
        numeric["micros"] = .object(micros)
        for key in Domain.macroKeys where (numeric.number(key) ?? -1) < 0 { numeric[key] = nil }
        draft.fill(numeric, source: source, basis: basis)
        missing = (Domain.macroKeys + requiredFoodMicros).filter { nutritionValue(numeric, $0) == nil }.map(foodLabel)
        let label = source == "etiqueta" ? "Etiqueta transcrita" : source == "gemini" ? "Estimación IA" : foodSources[source] ?? source
        sourceInfo = [store.tr(label), numeric.text("name")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func foodLabel(_ key: String) -> String {
        store.tr(Domain.macroLabels[key] ?? Domain.micros.first { $0.key == key }?.label ?? key)
    }
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

private var foodAISchema: Record {
    let metadata = ["mode", "basis", "ean", "confidence", "usda_query", "name", "brand"]
        .reduce(into: Record()) { $0[$1] = aiSchema("STRING", nullable: ["ean", "usda_query", "brand"].contains($1)) }
    let numbers = (Domain.macroKeys + ["density_g_ml"]).reduce(into: Record()) { $0[$1] = aiSchema("NUMBER", nullable: true) }
    let micros = Domain.micros.reduce(into: Record()) { $0[$1.key] = aiSchema("NUMBER", nullable: true) }
    var all = metadata.merging(numbers) { _, new in new }
    all["micros"] = .object(aiObject(micros, required: requiredFoodMicros))
    return aiObject(all, required: ["mode", "basis", "name", "confidence", "micros"] + Domain.macroKeys)
}

private func foodPrompt(language: String) -> String {
    let keys = Domain.micros.map { "\($0.key) (\($0.unit))" }.joined(separator: ", ")
    return """
    Eres un asistente de captura de Nutri. Si la foto tiene etiqueta nutrimental legible, transcribe cada valor declarado y usa mode etiqueta.
    Conserva la base declarada, normalízala a 100 unidades de masa o volumen e indica basis 100g o 100ml. No conviertas ml a g.
    Carbs_g son carbohidratos totales. Si una etiqueta mexicana dice carbohidratos disponibles y declara fibra, suma esa fibra para el total; si solo hay carbohidratos totales, no sumes fibra.
    Sin etiqueta usa mode estimacion y referencias USDA o alimentos equivalentes de México. Identifica el EAN visible cuando puedas.
    Para kcal, proteína, carbohidratos, grasa, sodio, potasio y magnesio aporta la mejor cifra fundada y null cuando sea desconocida. Nunca inventes ceros.
    Los demás micros requieren datos fiables. Transcribe todos los valores declarados. En edulcorantes de alta intensidad devuelve cantidad solo si está declarada.
    Solo para alimentos genéricos sin marca indica usda_query en inglés. Para líquidos indica density_g_ml si puedes fundarla. Devuelve confidence alta, media o baja.
    Escribe el nombre breve en \(language == "en" ? "inglés" : "español"). Usa estas claves de micros y sus unidades exactas: \(keys).
    """
}
