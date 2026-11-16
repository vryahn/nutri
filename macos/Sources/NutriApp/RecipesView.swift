import NutriCore
import SwiftUI
import UniformTypeIdentifiers

struct RecipeIngredient: Identifiable {
    let id = UUID()
    var food: Record
    var amount: String
    var unit = "g"
    var label = ""
    var aiOrigin = ""
    var usdaQuery = ""
    var fromAI = false
    var staged = false

    var grams: Double? {
        guard let n = Double(cleanText(amount).replacingOccurrences(of: ",", with: ".")), n.isFinite, n > 0 else { return nil }
        return gramsPerUnit(unit).map { n * $0 }
    }

    func gramsPerUnit(_ unit: String) -> Double? {
        if unit.hasPrefix("portion:"),
           let portion = food.array("portions").compactMap(\.object).first(where: { $0.text("name") == String(unit.dropFirst(8)) }),
           let grams = portion.number("grams"), grams > 0 { return grams }
        return Domain.grams(1, unit: unit, density: food.number("density_g_ml"))
    }

    mutating func changeUnit(to unit: String) {
        let current = grams
        if let current, let next = gramsPerUnit(unit) { amount = draftNumber(current / next) }
        self.unit = unit
    }

    mutating func addPortion(_ portion: Double) {
        if let factor = gramsPerUnit(unit) { amount = draftNumber(((grams ?? 0) + portion) / factor) }
    }
}

private struct RecipePortion: Identifiable {
    let id = UUID()
    var name = ""
    var grams = ""
}

private struct RecipeDraft: Identifiable {
    let id = UUID()
    let recordID: String
    var name: String
    var cooked: String
    var source: String
    var ingredients: [RecipeIngredient]
    var portions: [RecipePortion]

    init(_ row: Record = [:], items: [Record] = []) {
        recordID = row.text("id")
        name = row.text("name")
        cooked = draftNumber(row.number("cooked_weight_g"))
        source = row.text("source").isEmpty ? "manual" : row.text("source")
        ingredients = items.map { item in
            var food = item.object("foods")
            if food.isEmpty { food = ["id": .string(item.text("food_id")), "name": .string("Alimento no disponible")] }
            return RecipeIngredient(food: food, amount: draftNumber(item.number("grams")))
        }
        portions = row.array("portions").compactMap(\.object).map {
            RecipePortion(name: $0.text("name"), grams: draftNumber($0.number("grams")))
        }
    }
}

private func recipePayload(_ recipe: Record, items: [Record], restore: Bool = false) -> Record {
    ["p_recipe_id": !restore && !recipe.text("id").isEmpty ? .string(recipe.text("id")) : .null,
     "p_name": .string(recipe.text("name")), "p_cooked_weight_g": recipe["cooked_weight_g"] ?? .null,
     "p_portions": recipe["portions"] ?? .array([]), "p_source": .string(recipe.text("source").isEmpty ? "manual" : recipe.text("source")),
     "p_items": .array(items.map { .object(["food_id": .string($0.text("food_id")), "grams": $0["grams"] ?? .null]) })]
}

struct RecipesView: View {
    @EnvironmentObject private var store: Store
    @State private var rows: [Record] = []
    @State private var perHundred: [String: Record] = [:]
    @State private var query = ""
    @State private var sourceFilter = ""
    @State private var sort = "name"
    @State private var descending = false
    @State private var loading = true
    @State private var opening = false
    @State private var error = ""
    @State private var form: RecipeDraft?

    private var visible: [Record] {
        let term = CSV.normalize(query)
        let filtered = rows.filter {
            (sourceFilter.isEmpty || $0.text("source") == sourceFilter) && (term.isEmpty || CSV.normalize($0.text("name")).contains(term))
        }
        return filtered.sorted { first, second in
            let by: Bool
            if sort == "kcal" {
                let a = perHundred[first.text("id")]?.number("kcal") ?? -1
                let b = perHundred[second.text("id")]?.number("kcal") ?? -1
                if a != b { by = a < b } else { return first.text("name").localizedStandardCompare(second.text("name")) == .orderedAscending }
            } else {
                let comparison = first.text("name").localizedStandardCompare(second.text("name"))
                guard comparison != .orderedSame else { return first.text("id") < second.text("id") }
                by = comparison == .orderedAscending
            }
            return descending ? !by : by
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(store.tr("Recetas")).font(.largeTitle.bold())
                Spacer()
                Button(store.tr("Nueva receta"), systemImage: "plus") { form = RecipeDraft() }.buttonStyle(.borderedProminent)
            }
            HStack {
                TextField(store.tr("Buscar recetas"), text: $query).textFieldStyle(.roundedBorder)
                Picker(store.tr("Fuente"), selection: $sourceFilter) {
                    Text(store.tr("Todas")).tag("")
                    Text(store.tr("Manual")).tag("manual")
                    Text(store.tr("IA")).tag("gemini")
                    Text(store.tr("IA personal")).tag("ia_personal")
                }.frame(maxWidth: 170)
                Menu(store.tr("Ordenar"), systemImage: "arrow.up.arrow.down") {
                    Picker(store.tr("Ordenar por"), selection: $sort) {
                        Text(store.tr("Nombre")).tag("name")
                        Text("kcal / 100 g").tag("kcal")
                    }
                    Toggle(store.tr("Descendente"), isOn: $descending)
                }
            }
            if loading || opening { ProgressView().controlSize(.small) }
            if !error.isEmpty {
                HStack {
                    Text(error).foregroundStyle(.red)
                    Button(store.tr("Reintentar")) { Task { await reload() } }
                }
            }
            if visible.isEmpty && !loading && error.isEmpty {
                ContentUnavailableView(store.tr("Sin recetas"), systemImage: "book.closed")
            } else {
                List(visible.indices, id: \.self) { index in
                    let row = visible[index]
                    Button {
                        Task { await open(row) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(row.text("name")).font(.headline)
                                Text(source(row.text("source"))).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let kcal = perHundred[row.text("id")]?.number("kcal") {
                                Text("\(numberText(kcal, digits: 1)) kcal / 100 g").monospacedDigit()
                            } else {
                                Text(store.tr("Sin datos nutricionales")).foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }.contentShape(Rectangle()).padding(.vertical, 5)
                    }.buttonStyle(.plain)
                    .contextMenu {
                        Button(store.tr("Editar")) { Task { await open(row) } }
                        Button(store.tr("Eliminar"), role: .destructive) { Task { await remove(row) } }
                    }
                }.listStyle(.inset)
            }
        }.padding(24)
        .task { await reload() }
        .sheet(item: $form) { draft in
            RecipeEditor(draft: displayedDraft(draft), useUS: store.units == "us", recipes: rows, onSaved: {
                form = nil
                await reload()
            }, onOpen: open, onRemove: deleteDraft)
        }
    }

    private func displayedDraft(_ input: RecipeDraft) -> RecipeDraft {
        guard store.units == "us" else { return input }
        var draft = input
        let factor = Domain.gramsPerOunce
        draft.cooked = draftNumber(Double(draft.cooked).map { $0 / factor })
        for index in draft.portions.indices {
            draft.portions[index].grams = draftNumber(Double(draft.portions[index].grams).map { $0 / factor })
        }
        for index in draft.ingredients.indices {
            draft.ingredients[index].amount = draftNumber(Double(draft.ingredients[index].amount).map { $0 / factor })
            draft.ingredients[index].unit = "oz"
        }
        return draft
    }

    private func source(_ key: String) -> String {
        switch key {
        case "gemini": store.tr("IA")
        case "ia_personal": store.tr("IA personal")
        case "manual", "": store.tr("Manual")
        default: key
        }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            async let recipes = store.read("recipes", ["order": "name.asc"])
            async let view = store.read("recipe_per_100g", ["select": "recipe_id,kcal"])
            let (a, b) = try await (recipes, view)
            rows = a
            perHundred = Dictionary(b.map { ($0.text("recipe_id"), $0) }, uniquingKeysWith: { first, _ in first })
            error = ""
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription; store.report(error) }
        }
    }

    private func open(_ row: Record) async {
        guard !opening else { return }
        opening = true
        defer { opening = false }
        do {
            let ingredients = try await store.read("recipe_items", ["recipe_id": "eq.\(row.text("id"))", "select": "grams,food_id,foods(id,name,brand,kcal,protein_g,carbs_g,fat_g,micros,density_g_ml,portions,source)"])
            form = RecipeDraft(row, items: ingredients)
        } catch { store.report(error) }
    }

    private func deleteDraft(_ id: String) async throws {
        guard let row = rows.first(where: { $0.text("id") == id }) else { throw FeatureError("Receta no disponible.") }
        try await removeRecipe(row)
        form = nil
    }

    private func remove(_ row: Record) async {
        do { try await removeRecipe(row) }
        catch { store.report(error) }
    }

    private func removeRecipe(_ row: Record) async throws {
        let id = row.text("id")
        let query = ["recipe_id": "eq.\(id)", "select": "food_id,grams"]
        let items = try await store.read("recipe_items", query)
        let deleted = try await store.delete("recipes", ["id": "eq.\(id)"])
        guard let snapshot = deleted.first else { throw FeatureError("La receta ya no está disponible.") }
        rows.removeAll { $0.text("id") == id }
        store.undo(store.tr("Receta eliminada")) {
            if items.isEmpty {
                _ = try await store.insert("recipes", snapshot)
            } else {
                _ = try await store.rpc("save_recipe_atomic", recipePayload(snapshot, items: items, restore: true))
            }
            await reload()
        }
    }
}

private struct RecipeEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var draft: RecipeDraft
    let useUS: Bool
    let recipes: [Record]
    let onSaved: () async -> Void
    let onOpen: (Record) async -> Void
    let onRemove: (String) async throws -> Void
    @State private var foods: [Record] = []
    @State private var loadingCatalog = true
    @State private var query = ""
    @State private var paste = ""
    @State private var pasteNotice = ""
    @State private var aiText = ""
    @State private var aiPhotos: [URL] = []
    @State private var attach = false
    @State private var error = ""
    @State private var busy = false
    @State private var confirm = false
    @State private var confidence = ""
    @State private var estimatedKcal: Double?
    @State private var dupes: [Record] = []
    @State private var choice: UUID?
    @State private var fdcID: UUID?
    @State private var fdcQuery = ""
    @State private var fdcRows: [Record] = []
    @State private var fdcError = ""
    @State private var fdcBusy = false

    private var unitUS: Bool { useUS }
    private var weightUnit: String { unitUS ? "oz" : "g" }
    private var cookedWeight: Double? {
        guard let value = Double(draft.cooked.replacingOccurrences(of: ",", with: ".")) else { return nil }
        return value > 0 ? inGrams(value) : nil
    }
    private var ingredientWeight: Double { draft.ingredients.compactMap(\.grams).reduce(0, +) }
    private var massDifference: Double? { cookedWeight.flatMap { ingredientWeight > 0 ? abs(ingredientWeight - $0) / $0 : nil } }
    private var visibleCatalog: [Record] {
        let term = CSV.normalize(query)
        guard !term.isEmpty else { return [] }
        return Array(foods.filter { CSV.normalize($0.text("name") + " " + $0.text("brand")).contains(term) }
            .sorted { ($0.text("source") == "usda" ? 1 : 0) < ($1.text("source") == "usda" ? 1 : 0) }.prefix(12))
    }
    private var perHundred: Record? {
        let pairs = draft.ingredients.compactMap { row in row.grams.map { (food: row.food, grams: $0) } }
        guard pairs.count == draft.ingredients.count else { return nil }
        return Domain.recipePer100g(pairs, cookedWeight: cookedWeight)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr(draft.recordID.isEmpty ? "Nueva receta" : "Editar receta")).font(.title2.bold())
            Form {
                Section(store.tr("Receta")) {
                    TextField(store.tr("Nombre"), text: $draft.name)
                    TextField("\(store.tr("Peso cocido")) (\(weightUnit))", text: $draft.cooked)
                    LabeledContent(store.tr("Peso de ingredientes"), value: "\(numberText(toDisplay(ingredientWeight))) \(weightUnit)")
                }
                Section(store.tr("Ingredientes")) {
                    catalogSearch
                    ForEach($draft.ingredients) { $ingredient in
                        ingredientRow($ingredient)
                    }
                    DisclosureGroup(store.tr("Importar ingredientes")) { pasteEditor }
                }
                Section(store.tr("Porciones")) { portions }
                Section(store.tr("Nutrición por 100 g")) { preview }
                if draft.recordID.isEmpty { DisclosureGroup(store.tr("Datos con IA")) { aiEditor } }
            }.formStyle(.grouped).disabled(busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                if !draft.recordID.isEmpty {
                    Button(store.tr("Eliminar receta"), role: .destructive) {
                        perform { try await onRemove(draft.recordID); dismiss() }
                    }
                }
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(store.tr("Cancelar")) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(store.tr("Guardar")) {
                    if draft.ingredients.contains(where: \.staged) { confirm = true }
                    else { perform(save) }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }.disabled(busy)
        }.padding(18).frame(minWidth: 700, idealWidth: 850, minHeight: 650)
        .interactiveDismissDisabled(busy)
        .task { await loadCatalog() }
        .confirmationDialog(store.tr("¿Guardar receta y nuevos alimentos?"), isPresented: $confirm) {
            Button(store.tr("Guardar receta y alimentos")) { perform(save) }
        } message: { Text(store.tr("Revisa los nombres, cantidades y valores de los ingredientes antes de guardarlos en el catálogo.")) }
        .fileImporter(isPresented: $attach, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            do {
                let urls = try result.get()
                guard urls.count <= 2 else { throw FeatureError("Elige hasta dos fotos del mismo platillo.") }
                aiPhotos = urls
            } catch { self.error = error.localizedDescription }
        }
        .sheet(isPresented: Binding(get: { fdcID != nil }, set: { if !$0 { fdcID = nil } })) {
            fdcSheet
        }
    }

    private var catalogSearch: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField(store.tr("Buscar en el catálogo"), text: $query)
            if loadingCatalog { ProgressView().controlSize(.small) }
            if !query.isEmpty, visibleCatalog.isEmpty, !loadingCatalog { Text(store.tr("Sin coincidencias")).foregroundStyle(.secondary) }
            ForEach(visibleCatalog.indices, id: \.self) { index in
                let food = visibleCatalog[index]
                Button(displayName(food)) { select(food) }.buttonStyle(.borderless)
            }
        }
    }

    private func ingredientRow(_ binding: Binding<RecipeIngredient>) -> some View {
        let row = binding.wrappedValue
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(displayName(row.food)).font(.headline)
                if !row.label.isEmpty { Text(store.tr(row.label)).font(.caption).foregroundStyle(.secondary) }
                Spacer()
                TextField(store.tr("Cantidad"), text: binding.amount).frame(width: 84).textFieldStyle(.roundedBorder)
                Picker(store.tr("Unidad"), selection: Binding(
                    get: { binding.wrappedValue.unit },
                    set: { binding.wrappedValue.changeUnit(to: $0) }
                )) {
                    Text("g").tag("g")
                    Text("oz").tag("oz")
                    if let density = row.food.number("density_g_ml"), density > 0 {
                        Text("ml").tag("ml")
                        if unitUS { Text("fl oz").tag("fl oz") }
                    }
                    let portions = row.food.array("portions").compactMap(\.object).map { $0.text("name") }
                    ForEach(Array(Set(portions)).sorted(), id: \.self) { Text($0).tag("portion:" + $0) }
                }.labelsHidden().frame(maxWidth: 130)
                let portions = row.food.array("portions").compactMap(\.object).filter { ($0.number("grams") ?? 0) > 0 }
                if !portions.isEmpty {
                    Menu(store.tr("Añadir porción"), systemImage: "plus.circle") {
                        ForEach(portions.indices, id: \.self) { index in
                            if let grams = portions[index].number("grams") {
                                Button(portions[index].text("name")) { binding.wrappedValue.addPortion(grams) }
                            }
                        }
                    }.labelStyle(.iconOnly)
                }
                Button(store.tr("Quitar ingrediente"), systemImage: "minus.circle", role: .destructive) {
                    guard let index = draft.ingredients.firstIndex(where: { $0.id == row.id }) else { return }
                    draft.ingredients.remove(at: index)
                    store.undo(store.tr("Ingrediente quitado")) {
                        draft.ingredients.insert(row, at: min(index, draft.ingredients.count))
                    }
                }.labelStyle(.iconOnly).buttonStyle(.borderless)
            }
            if row.staged {
                DisclosureGroup(store.tr("Revisar alimento nuevo")) {
                    TextField(store.tr("Nombre"), text: foodText(binding, "name"))
                    TextField(store.tr("Marca"), text: foodText(binding, "brand"))
                    ForEach(nutritionMacros, id: \.key) { field in
                        TextField("\(store.tr(field.label)) (\(field.unit)/100 g)", text: foodNumber(binding, field.key))
                    }
                    if !row.food.text("source").isEmpty {
                        LabeledContent(store.tr("Fuente"), value: row.food.text("source"))
                    }
                    TextField(store.tr("Densidad (g/ml)"), text: foodNumber(binding, "density_g_ml"))
                    DisclosureGroup(store.tr("Micronutrientes")) {
                        ForEach(Domain.micros.filter { $0.key != "agua_ml" }, id: \.key) { field in
                            TextField("\(store.tr(field.label)) (\(field.unit))", text: foodNumber(binding, field.key, micro: true))
                        }
                    }
                    ForEach(Domain.foodWarnings(row.food), id: \.self) { warning in
                        Label(store.tr(warning), systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                    }
                    HStack {
                        Button(store.tr("Buscar catálogo")) { choice = row.id; query = row.food.text("name") }
                        Button(store.tr("Buscar USDA")) {
                            fdcQuery = row.usdaQuery.isEmpty ? row.food.text("name") : row.usdaQuery
                            fdcRows = []
                            fdcError = ""
                            fdcID = row.id
                        }
                        Button(store.tr("Guardar alimento")) { perform { try await persistIngredient(row.id) } }
                    }
                }
            }
            if let grams = row.grams, row.unit != "g" {
                Text("\(numberText(grams)) g").foregroundStyle(.secondary).font(.caption)
            } else if !row.amount.isEmpty && row.grams == nil {
                Text(store.tr("Cantidad inválida o falta densidad")).foregroundStyle(.red).font(.caption)
            }
        }.padding(.vertical, 3)
    }

    private var pasteEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(store.tr("Una línea por ingrediente. Ejemplo 120 g arroz.")).foregroundStyle(.secondary)
            TextEditor(text: $paste).frame(minHeight: 85)
                .accessibilityLabel(store.tr("Ingredientes para importar"))
            Button(store.tr("Añadir ingredientes")) { importIngredients() }.disabled(paste.isEmpty || loadingCatalog)
            if !pasteNotice.isEmpty { Text(pasteNotice).foregroundStyle(.secondary) }
        }
    }

    private var portions: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach($draft.portions) { $portion in
                HStack {
                    TextField(store.tr("Nombre de porción"), text: $portion.name)
                    TextField(weightUnit, text: $portion.grams).frame(width: 100).accessibilityLabel(store.tr("Peso de porción"))
                    Button(store.tr("Quitar porción"), systemImage: "minus.circle", role: .destructive) {
                        draft.portions.removeAll { $0.id == portion.id }
                    }.labelStyle(.iconOnly).buttonStyle(.borderless)
                }
            }
            Button(store.tr("Añadir porción"), systemImage: "plus.circle") { draft.portions.append(RecipePortion()) }
        }
    }

    @ViewBuilder
    private var preview: some View {
        if let row = perHundred {
            HStack {
                ForEach(nutritionMacros, id: \.key) { field in
                    VStack(alignment: .leading) {
                        Text(store.tr(field.label)).font(.caption).foregroundStyle(.secondary)
                        Text("\(numberText(row.number(field.key))) \(field.unit)").monospacedDigit()
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if (row.number("kcal") ?? 0) > 900 {
                Label(store.tr("Densidad energética superior a 900 kcal / 100 g. Revisa pesos."), systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            }
            if let massDifference, massDifference > 0.05, let cookedWeight {
                HStack {
                    Text(store.tr("El peso cocido difiere de la suma de ingredientes.")).foregroundStyle(massDifference > 0.2 ? .orange : .secondary)
                    Button(store.tr("Ajustar cantidades al peso cocido")) {
                        let factor = cookedWeight / ingredientWeight
                        for index in draft.ingredients.indices {
                            if let grams = draft.ingredients[index].grams {
                                draft.ingredients[index].amount = draftNumber((grams * factor).rounded())
                                draft.ingredients[index].unit = "g"
                            }
                        }
                    }
                }
            }
            if let estimatedKcal, estimatedKcal >= 50, let cookedWeight, let kcal = row.number("kcal") {
                let total = kcal * cookedWeight / 100
                if total >= 50 && abs(total - estimatedKcal) / max(total, estimatedKcal) > 0.25 {
                    Text(store.tr("La estimación de IA y la suma de ingredientes difieren más de 25%.")).foregroundStyle(.orange)
                }
            }
            DisclosureGroup(store.tr("Micronutrientes")) {
                ForEach(Domain.micros.filter { $0.key != "agua_ml" }, id: \.key) { field in
                    let coverage = Domain.coverage(row, field.key)
                    LabeledContent(store.tr(field.label)) {
                        Text(previewText(row, key: field.key, unit: field.unit, coverage: coverage))
                            .foregroundStyle(coverage == .partial ? .orange : .secondary)
                    }
                }
            }
        } else {
            Text(store.tr("Añade ingredientes con cantidades válidas para calcular.")).foregroundStyle(.secondary)
        }
    }

    private var aiEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField(store.tr("Describe el platillo y su cantidad"), text: $aiText, axis: .vertical).lineLimit(2...5)
            HStack {
                Button(store.tr("Añadir hasta dos fotos…")) { attach = true }
                if !aiPhotos.isEmpty {
                    Text("\(aiPhotos.count) \(store.tr("fotos"))")
                    Button(store.tr("Quitar fotos")) { aiPhotos = [] }
                }
            }
            if !confidence.isEmpty { Text("\(store.tr("Confianza de IA")) · \(store.tr(confidence))").foregroundStyle(.secondary) }
            if !dupes.isEmpty {
                Text(store.tr("Recetas similares")).font(.headline)
                ForEach(dupes.indices, id: \.self) { index in
                    Button(dupes[index].text("name")) {
                        let row = dupes[index]
                        Task { await onOpen(row) }
                    }
                }
            }
            Button(store.tr(dupes.isEmpty ? "Obtener ingredientes" : "Estimar una receta nueva")) {
                perform {
                    if dupes.isEmpty {
                        let key = CSV.normalize(aiText.replacingOccurrences(of: #"(?i)\b\d+(?:[.,]\d+)?\s*(?:ml|kg|gr|g|l)\b"#, with: "", options: .regularExpression))
                        dupes = key.isEmpty ? [] : Array(recipes.filter { CSV.normalize($0.text("name")).contains(key) }.prefix(5))
                        if !dupes.isEmpty { return }
                    }
                    try await estimateRecipe()
                    dupes = []
                }
            }.disabled((cleanText(aiText).isEmpty && aiPhotos.isEmpty) || loadingCatalog)
        }
    }

    private var fdcSheet: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(store.tr("Buscar USDA")).font(.title2.bold())
            HStack {
                TextField(store.tr("Nombre en inglés"), text: $fdcQuery)
                    .onSubmit { Task { await lookupFDC() } }
                Button(store.tr("Buscar")) { Task { await lookupFDC() } }.disabled(fdcBusy || cleanText(fdcQuery).isEmpty)
            }
            if fdcBusy { ProgressView().controlSize(.small) }
            if !fdcError.isEmpty { Text(fdcError).foregroundStyle(.red) }
            List(fdcRows.indices, id: \.self) { index in
                let row = fdcRows[index]
                Button(row.text("description")) { Task { await chooseFDC(row) } }.disabled(fdcBusy)
            }.frame(minHeight: 180)
            Button(store.tr("Cancelar")) { fdcID = nil }.keyboardShortcut(.cancelAction).disabled(fdcBusy)
        }.padding(18).frame(width: 460).interactiveDismissDisabled(fdcBusy)
        .task { if !cleanText(fdcQuery).isEmpty { await lookupFDC() } }
    }

    private func displayName(_ row: Record) -> String {
        let name = row.text("name").isEmpty ? store.tr("Alimento sin nombre") : row.text("name")
        let brand = row.text("brand")
        return brand.isEmpty ? name : name + " · " + brand
    }

    private func previewText(_ row: Record, key: String, unit: String, coverage: Domain.Coverage) -> String {
        guard let value = row.object("micros").number(key) else { return store.tr("Sin datos") }
        return "\(numberText(value, digits: 3)) \(unit)" + (coverage == .partial ? " · " + store.tr("Parcial") : "")
    }

    private func perform(_ action: @escaping () async throws -> Void) {
        Task {
            guard !busy else { return }
            busy = true
            error = ""
            defer { busy = false }
            do { try await action() }
            catch { self.error = error.localizedDescription }
        }
    }

    private func toDisplay(_ grams: Double) -> Double { unitUS ? grams / Domain.gramsPerOunce : grams }

    private func inGrams(_ amount: Double) -> Double { unitUS ? amount * Domain.gramsPerOunce : amount }

    private func loadCatalog() async {
        defer { loadingCatalog = false }
        do { foods = try await store.catalog().filter { !Domain.water($0) } }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func select(_ food: Record) {
        if let choice, let index = draft.ingredients.firstIndex(where: { $0.id == choice }) {
            let alias = draft.ingredients[index].aiOrigin
            let current = draft.ingredients[index].grams
            let oldUnit = draft.ingredients[index].unit
            draft.ingredients[index].food = food
            draft.ingredients[index].staged = false
            draft.ingredients[index].label = "Catálogo"
            if oldUnit.hasPrefix("portion:") || (["ml", "fl oz"].contains(oldUnit) && (food.number("density_g_ml") ?? 0) <= 0) {
                draft.ingredients[index].amount = draftNumber(current.map(toDisplay))
                draft.ingredients[index].unit = weightUnit
            }
            if !alias.isEmpty {
                var aliases = store.prefs.object("ingredient_aliases")
                aliases[cleanText(alias).lowercased()] = .string(food.text("id"))
                Task {
                    do { try await store.patchPrefs(["ingredient_aliases": .object(aliases)]) }
                    catch { store.report(error) }
                }
            }
        } else {
            draft.ingredients.append(RecipeIngredient(food: food, amount: "", unit: weightUnit))
        }
        choice = nil
        query = ""
    }

    private func importIngredients() {
        var unresolved: [String] = []
        var count = 0
        for line in paste.split(whereSeparator: \.isNewline).map(String.init).map(cleanText) where !line.isEmpty {
            guard let parsed = parseRecipeLine(line, catalog: foods) else { unresolved.append(line); continue }
            draft.ingredients.append(parsed)
            count += 1
        }
        paste = unresolved.joined(separator: "\n")
        pasteNotice = "\(count) \(store.tr("ingredientes añadidos"))"
        if !unresolved.isEmpty { pasteNotice += " · \(unresolved.count) \(store.tr("líneas ambiguas o sin cantidad válida"))" }
    }

    private func lookupFDC() async {
        guard !fdcBusy else { return }
        fdcBusy = true
        fdcError = ""
        defer { fdcBusy = false }
        do {
            fdcRows = try await searchFDC(store: store, query: fdcQuery)
            if fdcRows.isEmpty { fdcError = store.tr("Sin coincidencias") }
        } catch { fdcError = error.localizedDescription }
    }

    private func chooseFDC(_ row: Record) async {
        guard let id = row.number("fdcId"), let selected = fdcID else { return }
        fdcBusy = true
        defer { fdcBusy = false }
        do {
            var food = try await fetchFDC(store: store, id: Int(id))
            guard let index = draft.ingredients.firstIndex(where: { $0.id == selected }) else { return }
            food["id"] = .string(UUID().uuidString.lowercased())
            if store.lang != "en" {
                let oldName = draft.ingredients[index].food.text("name")
                if !oldName.isEmpty { food["name"] = .string(oldName) }
            }
            draft.ingredients[index].food = food
            draft.ingredients[index].staged = true
            draft.ingredients[index].label = "USDA"
            fdcID = nil
        } catch { fdcError = error.localizedDescription }
    }

    private func foodText(_ binding: Binding<RecipeIngredient>, _ key: String) -> Binding<String> {
        Binding(get: { binding.wrappedValue.food.text(key) },
                set: { binding.wrappedValue.food[key] = .string($0) })
    }

    private func foodNumber(_ binding: Binding<RecipeIngredient>, _ key: String, micro: Bool = false) -> Binding<String> {
        Binding(get: {
            let row = micro ? binding.wrappedValue.food.object("micros") : binding.wrappedValue.food
            return row[key]?.string ?? draftNumber(row.number(key))
        }, set: { value in
            if micro {
                var micros = binding.wrappedValue.food.object("micros")
                micros[key] = value.isEmpty ? nil : .string(value)
                binding.wrappedValue.food["micros"] = .object(micros)
            } else {
                binding.wrappedValue.food[key] = value.isEmpty ? .null : .string(value)
            }
        })
    }

    private func estimateRecipe() async throws {
        let micronutrients = Dictionary(uniqueKeysWithValues: Domain.micros.map { ($0.key, aiSchema("NUMBER", nullable: true)) })
        var properties = Dictionary(uniqueKeysWithValues: nutritionMacros.map { ($0.key, aiSchema("NUMBER", nullable: true)) })
        for key in ["name_es", "db_match", "usda_query"] { properties[key] = aiSchema("STRING", nullable: key != "name_es") }
        properties["grams"] = aiSchema("NUMBER")
        properties["micros"] = .object(aiObject(micronutrients))
        let schema = aiObject([
            "name": aiSchema("STRING"), "confidence": aiSchema("STRING"),
            "total_weight_g": aiSchema("NUMBER", nullable: true),
            "kcal_total_estimate": aiSchema("NUMBER", nullable: true),
            "ingredients": aiArray(.object(aiObject(properties, required: ["name_es", "grams"])))
        ], required: ["ingredients", "name"])
        let parts = [["text": JSONValue.string(cleanText(aiText).isEmpty ? "Analiza las imágenes." : aiText)]] + (try aiPhotos.map { try aiImagePart($0) })
        let names = foods.map { $0.text("name") }.joined(separator: ", ")
        let units = Domain.micros.map { "\($0.key) (\($0.unit))" }.joined(separator: ", ")
        let prompt = """
        Eres un asistente de nutrición para México. El usuario describe un platillo, bebida o receta (texto y/o hasta dos fotos; si hay dos, son del MISMO platillo — combínalas). Descompón en ingredientes con su cantidad en GRAMOS tal como van en la preparación.
        Prefiere pocos ingredientes compuestos ("leche entera", no "leche + grasa"). Máximo 15.
        Se te da la lista EXACTA de alimentos del catálogo del usuario. Para cada ingrediente, si uno de esos nombres corresponde claramente al ingrediente, devuelve ese nombre LITERAL en "db_match"; si no hay correspondencia clara, "db_match" = null. Nunca inventes nombres que no estén en la lista.
        Catálogo del usuario: \(names.isEmpty ? "(vacío)" : names)
        Para ingredientes genéricos sin match, da "usda_query" (nombre en inglés apto para buscar en USDA FoodData Central); si no aplica, null.
        Para CADA ingrediente da además sus valores nutricionales por 100 g de porción comestible, como respaldo revisable (base tipo USDA priorizando México). OBLIGATORIOS siempre con tu mejor estimación disponible: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg, magnesio_mg (null SOLO si es imposible fundarlo, nunca 0 inventado). Resto de micros: solo con dato fiable, si no null. Unidades: kcal en kcal; protein_g/carbs_g/fat_g en gramos; micros: \(units).
        Si el usuario indica tamaño total (p. ej. "350ml"), conviértelo a gramos con densidad razonable y devuélvelo en "total_weight_g"; si no lo indica, tu mejor estimación del peso total preparado; null si imposible.
        "kcal_total_estimate": tu estimación gruesa de kcal TOTALES del platillo completo (solo para verificación cruzada, jamás se persiste); null si no puedes fundarla.
        "name": nombre corto de la receta, \(store.lang == "en" ? "in English" : "en español"). "confidence": "alta"|"media"|"baja".
        """
        let result = try await generateNutritionJSON(store: store, prompt: prompt, parts: parts, schema: schema)
        let aliases = store.prefs.object("ingredient_aliases")
        let parsed: [RecipeIngredient] = result.array("ingredients").prefix(15).compactMap { item in
            guard var food = item.object, !cleanText(food.text("name_es")).isEmpty else { return nil }
            let name = cleanText(food.text("name_es"))
            let aliasID = aliases.text(name.lowercased())
            let alias = foods.first { $0.text("id") == aliasID && !aliasID.isEmpty }
            let matches = foods.filter { CSV.normalize($0.text("name")) == CSV.normalize(food.text("db_match")) && !food.text("db_match").isEmpty }
            let match = alias ?? (matches.count == 1 ? matches.first : nil)
            let grams = food.number("grams").flatMap { $0 > 0 && $0 <= 5000 ? $0 : nil }
            let usda = food.text("usda_query")
            if let match {
                return RecipeIngredient(food: match, amount: draftNumber(grams), label: alias == nil ? "Catálogo" : "Alias", aiOrigin: name, usdaQuery: usda, fromAI: true)
            }
            food["id"] = .string(UUID().uuidString.lowercased())
            food["name"] = .string(name)
            food["source"] = .string("gemini")
            return RecipeIngredient(food: food, amount: draftNumber(grams), label: "IA", aiOrigin: name, usdaQuery: usda, fromAI: true, staged: true)
        }
        guard !parsed.isEmpty else { throw FeatureError("La IA no identificó ingredientes.") }
        draft.ingredients = draft.ingredients.filter { !$0.fromAI } + parsed
        if cleanText(draft.name).isEmpty { draft.name = result.text("name") }
        if let explicit = explicitRecipeAmount(aiText), explicit.unit == "g" {
            draft.cooked = draftNumber(toDisplay(explicit.value))
        } else if let weight = result.number("total_weight_g"), weight > 0 {
            if let explicit = explicitRecipeAmount(aiText), explicit.unit == "ml" {
                let density = weight / explicit.value
                if (0.5...2).contains(density) { draft.cooked = draftNumber(toDisplay(weight)) }
            } else {
                draft.cooked = draftNumber(toDisplay(weight))
            }
        }
        draft.source = "gemini"
        confidence = result.text("confidence")
        estimatedKcal = result.number("kcal_total_estimate")
    }

    private func stagedPayload(_ food: Record) throws -> Record {
        let name = cleanText(food.text("name"))
        guard !name.isEmpty else { throw FeatureError("El ingrediente nuevo necesita un nombre.") }
        guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
        var body: Record = ["id": .string(food.text("id")), "owner": .string(owner), "name": .string(name),
                            "brand": optionalText(food.text("brand")), "source": .string(food.text("source"))]
        for field in nutritionMacros {
            let input = food[field.key]?.string ?? draftNumber(food.number(field.key))
            guard let number = try featureNumber(input, label: "\(name) · \(field.label)") else {
                throw FeatureError("\(name) · falta \(field.label). Completa los datos o elige un alimento del catálogo.")
            }
            body[field.key] = .number(number)
        }
        let density = food["density_g_ml"]?.string ?? draftNumber(food.number("density_g_ml"))
        body["density_g_ml"] = try featureNumber(density, label: "Densidad", minimum: 0.000001).map(JSONValue.number) ?? .null
        var micros: Record = [:]
        let raw = food.object("micros")
        for field in Domain.micros where field.key != "agua_ml" {
            let input = raw[field.key]?.string ?? draftNumber(raw.number(field.key))
            micros[field.key] = try featureNumber(input, label: field.label).map(JSONValue.number)
        }
        body["micros"] = .object(micros)
        body["portions"] = .array(food.array("portions"))
        return body
    }

    private func persistIngredient(_ id: UUID) async throws {
        guard let index = draft.ingredients.firstIndex(where: { $0.id == id }), draft.ingredients[index].staged else { return }
        let row = draft.ingredients[index].food
        let payload = try stagedPayload(row)
        let saved: Record
        do { saved = try await store.insert("foods", payload) }
        catch let error as NutriError where error.code == "23505" {
            let existing = try await store.read("foods", ["id": "eq.\(row.text("id"))"])
            guard let food = existing.first, food.text("owner") == store.owner else { throw error }
            saved = food
        }
        draft.ingredients[index].food = saved
        draft.ingredients[index].staged = false
        foods.append(saved)
    }

    private func save() async throws {
        let name = cleanText(draft.name)
        guard !name.isEmpty, !draft.ingredients.isEmpty else { throw FeatureError("Ingresa un nombre y al menos un ingrediente.") }
        let cooked = try featureNumber(draft.cooked, label: "Peso cocido", minimum: 0.000001).map(inGrams)
        let portions: [JSONValue] = try draft.portions.compactMap { row in
            let name = cleanText(row.name)
            if name.isEmpty, cleanText(row.grams).isEmpty { return nil }
            guard !name.isEmpty, let grams = try featureNumber(row.grams, label: "Porción", minimum: 0.000001) else {
                throw FeatureError("Cada porción requiere nombre y peso.")
            }
            return .object(["name": .string(name), "grams": .number(inGrams(grams))])
        }
        guard Set(portions.compactMap { $0.object?.text("name") }).count == portions.count else { throw FeatureError("Hay porciones con el mismo nombre.") }
        for row in draft.ingredients {
            guard let grams = row.grams, grams.isFinite, grams > 0, !row.food.text("id").isEmpty else {
                throw FeatureError("Cantidad inválida · \(displayName(row.food))")
            }
            if row.staged { _ = try stagedPayload(row.food) }
        }
        for id in draft.ingredients.filter(\.staged).map(\.id) { try await persistIngredient(id) }
        let gramsByID = draft.ingredients.reduce(into: [String: Double]()) { items, row in
            if let grams = row.grams { items[row.food.text("id"), default: 0] += grams }
        }
        let items: [Record] = gramsByID.keys.sorted().compactMap { id in
            gramsByID[id].map { ["food_id": .string(id), "grams": .number($0)] }
        }
        let row: Record = ["id": .string(draft.recordID), "name": .string(name), "cooked_weight_g": cooked.map(JSONValue.number) ?? .null,
                           "portions": .array(portions), "source": .string(draft.source)]
        let response = try await store.rpc("save_recipe_atomic", recipePayload(row, items: items))
        guard response.string?.isEmpty == false else { throw FeatureError("El servidor no identificó la receta guardada.") }
        await onSaved()
        dismiss()
    }
}

private let recipeAmountPattern = #/(?i)([+-]?[0-9]+(?:[.,][0-9]+)?)\s*(kg|ml|grs|gramos|gr|g|l)\b/#

private func explicitRecipeAmount(_ text: String) -> (value: Double, unit: String)? {
    guard let match = text.firstMatch(of: recipeAmountPattern),
          let value = Double(match.1.replacingOccurrences(of: ",", with: ".")) else { return nil }
    switch match.2.lowercased() {
    case "kg": return (value * 1000, "g")
    case "l": return (value * 1000, "ml")
    case "ml": return (value, "ml")
    default: return (value, "g")
    }
}

func parseRecipeLine(_ line: String, catalog: [Record]) -> RecipeIngredient? {
    let explicit = line.firstMatch(of: recipeAmountPattern)
    let plain = line.matches(of: #/([+-]?[0-9]+(?:[.,][0-9]+)?)\b/#).last
    let range = explicit?.range ?? plain?.range
    guard let range else { return nil }
    if explicit == nil,
       line[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines).first?.isLetter == true,
       !line[..<range.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return nil
    }
    let amount = explicitRecipeAmount(line) ?? (plain.flatMap { Double($0.1.replacingOccurrences(of: ",", with: ".")) }.map { (value: $0, unit: "g") })
    guard let amount, amount.value.isFinite, amount.value > 0 else { return nil }
    var name = line
    name.replaceSubrange(range, with: " ")
    let term = CSV.normalize(name.replacingOccurrences(of: #"[,;:\t]"#, with: " ", options: .regularExpression))
    guard !term.isEmpty else { return nil }
    let exact = catalog.filter { CSV.normalize($0.text("name")) == term }
    let prefix = catalog.filter { let name = CSV.normalize($0.text("name")); return !name.isEmpty && (name.hasPrefix(term) || term.hasPrefix(name)) }
    let contains = catalog.filter { let name = CSV.normalize($0.text("name")); return !name.isEmpty && (name.contains(term) || term.contains(name)) }
    let chosen = !exact.isEmpty ? exact : !prefix.isEmpty ? prefix : contains
    guard chosen.count == 1, let food = chosen.first,
          Domain.grams(amount.value, unit: amount.unit, density: food.number("density_g_ml")) != nil else { return nil }
    return RecipeIngredient(food: food, amount: draftNumber(amount.value), unit: amount.unit)
}
