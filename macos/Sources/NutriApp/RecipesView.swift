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
    var canonicalGrams: Double?

    var grams: Double? {
        if let canonicalGrams { return canonicalGrams > 0 ? canonicalGrams : nil }
        guard let n = decimal(amount), n > 0 else { return nil }
        return gramsPerUnit(unit).map { unit == "g" ? n : Domain.round(n * $0, 1) }
    }

    func gramsPerUnit(_ unit: String) -> Double? {
        if unit.hasPrefix("portion:"),
           let portion = food.array("portions").compactMap(\.object).first(where: { $0.text("name") == String(unit.dropFirst(8)) }),
           let grams = portion.number("grams"), grams > 0 { return grams }
        return Domain.grams(1, unit: unit, density: food.number("density_g_ml"))
    }

    mutating func changeUnit(to next: String) {
        let current = grams
        unit = next
        setGrams(current)
    }

    mutating func setGrams(_ value: Double?) {
        canonicalGrams = value
        amount = value.flatMap { grams in gramsPerUnit(unit).map {
            draftNumber(Domain.round(grams / $0, unit == "g" ? 9 : unit == "ml" ? 1 : 2))
        } } ?? ""
    }

    mutating func addPortion(_ portion: Double) { setGrams(Domain.round((grams ?? 0) + portion, 1)) }
}

private struct RecipeDraft: Identifiable {
    let id = UUID()
    let recordID: String
    var name: String
    var cooked: String
    var source: String
    var ingredients: [RecipeIngredient]
    var portions: [CatalogPortion]

    init(_ row: Record = [:], items: [Record] = []) {
        recordID = row.text("id")
        name = row.text("name")
        cooked = draftNumber(row.number("cooked_weight_g"))
        source = row.text("source").isEmpty ? "manual" : row.text("source")
        ingredients = items.map { item in
            var food = item.object("foods")
            if food.isEmpty { food = ["id": .string(item.text("food_id")), "name": .string("Alimento no disponible")] }
            return RecipeIngredient(food: food, amount: draftNumber(item.number("grams")), canonicalGrams: item.number("grams"))
        }
        portions = row.array("portions").compactMap(\.object).map {
            CatalogPortion(name: $0.text("name"), grams: draftNumber($0.number("grams")))
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
    @Environment(\.nutriPalette) private var palette
    @Environment(\.nutriWindowWidth) private var windowWidth
    @FocusState private var searchFocused: Bool
    @State private var rows: [Record] = []
    @State private var perHundred: [String: Record] = [:]
    @State private var query = ""
    @State private var exactHits: (term: String, rows: [Record])?
    @State private var sourceFilter = ""
    @State private var sort = ""
    @State private var descending = false
    @State private var loading = true
    @State private var opening: UUID?
    @State private var error = ""
    @State private var form: RecipeDraft?

    private var desktop: Bool { windowWidth >= 1024 }
    private var matching: [Record] {
        let term = cleanText(query)
        if term.isEmpty { return rows }
        if let exactHits, exactHits.term == term { return exactHits.rows }
        return rows.filter { $0.text("name").localizedCaseInsensitiveContains(term) }
    }
    private var visible: [Record] {
        let filtered = matching.filter { sourceFilter.isEmpty || $0.text("source") == sourceFilter }
        guard !sort.isEmpty else { return filtered }
        return filtered.sorted { first, second in
            if sort == "kcal" {
                let x = perHundred[first.text("id")]?.number("kcal"), y = perHundred[second.text("id")]?.number("kcal")
                guard let x else { return false }
                guard let y else { return true }
                return descending ? x > y : x < y
            }
            let order = first.text("name").lowercased().compare(second.text("name").lowercased(), options: .literal)
            return descending ? order == .orderedDescending : order == .orderedAscending
        }
    }

    var body: some View {
        Group {
            if desktop {
                GeometryReader { space in
                    let available = max(0, space.size.width - 56)
                    HStack(alignment: .top, spacing: 24) {
                        ScrollView { listing }.frame(width: available * 5 / 12)
                        ScrollView {
                            if let form { editor(form) }
                            else { emptyEditor }
                        }.coordinateSpace(name: "recipe-editor-scroll").frame(width: available * 7 / 12)
                    }.padding(16)
                }
            } else if let form {
                ScrollView { editor(form).padding(16) }
            } else {
                ScrollView { listing.padding(16).padding(.bottom, 56) }
                    .overlay(alignment: .bottomTrailing) {
                        if !matching.isEmpty {
                            Button { showEditor(RecipeDraft()) } label: { NutriIcon("plus", size: 22) }
                                .buttonStyle(NutriButtonStyle(.primary, height: 52, horizontal: 15, radius: 26))
                                .accessibilityLabel(store.tr("Nueva receta")).padding(16)
                        }
                    }
            }
        }.font(.nutriSans(14)).foregroundStyle(palette.text)
            .task {
                await reload()
                #if DEBUG
                if store.snapshotScenario == "recipe-editor", let recipe = rows.first { await open(recipe) }
                #endif
            }
            .task(id: query) { await findRecipes() }
            .onExitCommand { showEditor(nil) }
            .onKeyPress("/") {
                guard !searchFocused, form == nil else { return .ignored }
                searchFocused = true; return .handled
            }
    }

    private var listing: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(store.tr("Recetas")).font(.nutriDisplay(20))
                Spacer()
                if opening != nil { ProgressView().controlSize(.small).accessibilityLabel(store.tr("Cargando…")) }
            }
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    NutriIcon("search", size: 18).foregroundStyle(palette.text3)
                    TextField(store.tr("Buscar…"), text: $query).font(.nutriSans(16)).textFieldStyle(.plain).focused($searchFocused)
                }.padding(.horizontal, 12).frame(height: 44).nutriCard(radius: 12, fill: palette.surface2)
                if desktop { sourceMenu }
            }
            if loading && rows.isEmpty {
                VStack(spacing: 8) {
                    ForEach(0..<2) { _ in RoundedRectangle(cornerRadius: 16).fill(palette.surface).frame(height: 64).accessibilityHidden(true) }
                }.accessibilityLabel(store.tr("Cargando…"))
            } else if !error.isEmpty && rows.isEmpty {
                Text(store.tr("No se pudieron cargar las recetas — revisa tu conexión.")).foregroundStyle(palette.text2)
                Button(store.tr("Reintentar")) { Task { await reload() } }.buttonStyle(NutriButtonStyle(.secondary, height: 44))
            } else if matching.isEmpty {
                VStack(spacing: 12) {
                    Text(store.tr("Sin recetas aún")).foregroundStyle(palette.text2)
                    Button(store.tr("Crear la primera")) { showEditor(RecipeDraft()) }.buttonStyle(NutriButtonStyle(.primary, height: 44))
                }.padding(.vertical, 48).frame(maxWidth: .infinity)
            } else if desktop { table }
            else {
                LazyVStack(spacing: 16) {
                    ForEach(matching.map(RecipeListItem.init)) { item in compactRow(item.row) }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var sourceMenu: some View {
        let sources = (["manual", "gemini", sourceFilter] + matching.map { $0.text("source") }).reduce(into: [String]()) { values, item in
            if !item.isEmpty && !values.contains(item) { values.append(item) }
        }
        return NutriSelect(value: sourceFilter, select: { sourceFilter = $0 },
            options: [("", store.tr("Todos"))] + sources.map { ($0, source($0)) })
            .frame(width: 102).accessibilityLabel(store.tr("Fuente"))
    }

    private var table: some View {
        LazyVStack(spacing: 0) {
            HStack(spacing: 0) {
                sortCell("Nombre", key: "name").frame(maxWidth: .infinity, alignment: .leading)
                sortCell("Kcal/100g", key: "kcal").frame(width: 114, alignment: .trailing)
                Text("⚠").frame(width: 80, height: 38)
            }.foregroundStyle(palette.text2).background(palette.surface2)
            if visible.isEmpty {
                Text(store.tr("Sin resultados con estos filtros.")).foregroundStyle(palette.text2).frame(maxWidth: .infinity).padding(.vertical, 24)
            }
            ForEach(visible.map(RecipeListItem.init)) { item in
                let row = item.row
                Rectangle().fill(palette.border).frame(height: 1)
                RecipeTableRow(name: row.text("name"), ai: row.text("source") == "gemini", kcal: perHundred[item.id]?.number("kcal"),
                    active: form?.recordID == item.id, open: { Task { await open(row) } }, delete: { Task { await remove(row) } })
            }
        }.clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border).allowsHitTesting(false) }
    }

    private func sortCell(_ label: String, key: String) -> some View {
        Button {
            if sort == key { descending.toggle() } else { sort = key; descending = false }
        } label: {
            HStack(spacing: 4) {
                Text(store.tr(label)).font(.nutriSans(14, weight: .medium)).lineLimit(1)
                if sort == key { NutriIcon(descending ? "arrow-down" : "arrow-up", size: 11) }
            }.padding(.horizontal, 12).frame(height: 36)
        }.buttonStyle(.plain)
    }

    private func compactRow(_ row: Record) -> some View {
        CatalogSwipeCard(open: { Task { await open(row) } }, delete: { Task { await remove(row) } }) {
            HStack(spacing: 6) {
                Text(row.text("name")).font(.nutriSans(14, weight: .medium))
                if row.text("source") == "gemini" { Text("≈ " + store.tr("IA")).font(.nutriSans(10)).foregroundStyle(palette.accent) }
                Spacer()
                if let kcal = perHundred[row.text("id")]?.number("kcal") {
                    Text("\(numberText(kcal, digits: 1)) kcal/100g").font(.nutriMono(14)).foregroundStyle(palette.text2)
                }
            }
        }
    }

    private var emptyEditor: some View {
        VStack(spacing: 12) {
            Text(store.tr("Selecciona una receta o crea una nueva")).font(.nutriSans(16)).foregroundStyle(palette.text2).frame(minHeight: 24)
            Button { showEditor(RecipeDraft()) } label: { HStack { NutriIcon("plus", size: 16); Text(store.tr("Nueva receta")).font(.nutriSans(16, weight: .medium)) } }
                .buttonStyle(NutriButtonStyle(.primary, height: 44, horizontal: 16))
        }.padding(40).frame(maxWidth: .infinity).nutriCard()
    }

    private func editor(_ original: RecipeDraft) -> some View {
        var draft = original
        if store.units == "us" {
            for index in draft.ingredients.indices { draft.ingredients[index].changeUnit(to: "oz") }
        }
        return RecipeEditor(draft: draft, useUS: store.units == "us", desktop: desktop, recipes: rows, onSaved: {
            if form?.id == original.id { form = nil }
            await reload()
        }, onOpen: open, onRemove: deleteDraft, onClose: { showEditor(nil) })
        .id(draft.id).padding(desktop ? 24 : 0).frame(maxWidth: .infinity, alignment: .leading)
        .background { if desktop { Color.clear.nutriCard() } }
    }

    private func source(_ key: String) -> String {
        switch key {
        case "gemini": store.tr("IA")
        case "ia_personal": store.tr("IA personal")
        case "manual", "": store.tr("Manual")
        default: key
        }
    }

    private func findRecipes() async {
        let term = cleanText(query)
        guard !term.isEmpty, !store.offline, !store.demoActive else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let hits = try await searchCatalogNames(store: store, table: "recipes", term: term)
            guard !Task.isCancelled, cleanText(query) == term else { return }
            exactHits = (term, hits)
        } catch { /* The loaded local recipe list remains usable. */ }
    }

    private func reload() async {
        if rows.isEmpty, let cached = store.cached("recipes", ["order": "name.asc"]) { rows = cached }
        if perHundred.isEmpty, let cached = store.cached("recipe_per_100g", ["select": "recipe_id,kcal"]) {
            perHundred = Dictionary(cached.map { ($0.text("recipe_id"), $0) }, uniquingKeysWith: { first, _ in first })
        }
        loading = true
        defer { loading = false }
        do {
            async let recipes = store.read("recipes", ["order": "name.asc"])
            async let view = store.read("recipe_per_100g", ["select": "recipe_id,kcal"])
            let term = cleanText(query)
            let (a, b) = try await (recipes, view)
            guard !Task.isCancelled else { return }
            rows = a
            perHundred = Dictionary(b.map { ($0.text("recipe_id"), $0) }, uniquingKeysWith: { first, _ in first })
            if !term.isEmpty, term == cleanText(query) { await findRecipes() }
            error = ""
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription; store.report(error) }
        }
    }

    private func open(_ row: Record) async {
        let request = UUID()
        opening = request
        do {
            let ingredients = try await store.read("recipe_items", ["recipe_id": "eq.\(row.text("id"))", "select": "grams,food_id,foods(id,name,brand,kcal,protein_g,carbs_g,fat_g,micros,density_g_ml,portions,source)"])
            guard opening == request, !Task.isCancelled else { return }
            showEditor(RecipeDraft(row, items: ingredients))
        } catch {
            guard opening == request, !Task.isCancelled else { return }
            opening = nil
            store.report(error)
        }
    }

    private func showEditor(_ next: RecipeDraft?) {
        opening = nil
        form = next
    }

    private func deleteDraft(_ id: String) async throws {
        guard let row = (rows + matching).first(where: { $0.text("id") == id }) else { throw FeatureError("Receta no disponible.") }
        try await removeRecipe(row)
    }

    private func remove(_ row: Record) async {
        do { try await removeRecipe(row) }
        catch { store.report(error) }
    }

    private func removeRecipe(_ row: Record) async throws {
        let id = row.text("id")
        let query = ["recipe_id": "eq.\(id)", "select": "food_id,grams"]
        let items = try await store.read("recipe_items", query)
        rows.removeAll { $0.text("id") == id }
        exactHits?.rows.removeAll { $0.text("id") == id }
        let snapshot: Record
        do {
            guard let deleted = try await store.delete("recipes", ["id": "eq.\(id)"]).first else { throw FeatureError("La receta ya no está disponible.") }
            snapshot = deleted
        } catch { await reload(); throw error }
        if form?.recordID == id { form = nil }
        store.undo(store.tr("Receta borrada")) {
            if items.isEmpty {
                _ = try await store.insert("recipes", snapshot)
            } else {
                _ = try await store.rpc("save_recipe_atomic", recipePayload(snapshot, items: items, restore: true))
            }
            await reload()
        }
    }
}

private struct RecipeListItem: Identifiable {
    let row: Record
    var id: String { row.text("id") }
}

private struct RecipeTableRow: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State private var hovering = false
    let name: String
    let ai: Bool
    let kcal: Double?
    let active: Bool
    let open: () -> Void
    let delete: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: open) {
                HStack(spacing: 0) {
                    Text(name).font(.nutriSans(14, weight: .medium)).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
                    Text(kcal.map(draftNumber) ?? "—").font(.nutriMono(14, weight: .regular)).padding(.trailing, 12).frame(width: 114, alignment: .trailing)
                }.padding(.vertical, 12).contentShape(Rectangle())
            }.buttonStyle(.plain)
            HStack(spacing: 4) {
                Text(ai ? "≈ " + store.tr("IA") : "").font(.nutriSans(10)).foregroundStyle(palette.accent).frame(width: 40)
                Button(action: delete) { NutriIcon("trash-2", size: 16).frame(width: 28, height: 28) }
                    .buttonStyle(.plain).foregroundStyle(palette.text2).opacity(hovering ? 1 : 0)
                    .accessibilityLabel(store.tr("Borrar") + " " + name)
            }.frame(width: 80)
        }.background(active || hovering ? palette.surface2 : Color.clear)
            .overlay { if active { Rectangle().strokeBorder(palette.accent).allowsHitTesting(false) } }
            .onHover { hovering = $0 }
            .contextMenu { Button(store.tr("Borrar"), role: .destructive, action: delete) }
    }
}

private struct RecipeEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State var draft: RecipeDraft
    let useUS: Bool
    let desktop: Bool
    let recipes: [Record]
    let onSaved: () async -> Void
    let onOpen: (Record) async -> Void
    let onRemove: (String) async throws -> Void
    let onClose: () -> Void
    @State private var foods: [Record] = []
    @State private var loadingCatalog = true
    @State private var query = ""
    @State private var paste = ""
    @State private var showPaste = false
    @State private var pasteNotice = ""
    @State private var aiText = ""
    @State private var aiPhotos: [URL] = []
    @State private var aiError = ""
    @State private var aiWeightWarning = false
    @State private var aiLoading = false
    @State private var error = ""
    @State private var busy = false
    @State private var confirm = false
    @State private var confidence: String?
    @State private var estimatedKcal: Double?
    @State private var dupes: [Record] = []
    @State private var typedCooked: String?
    @State private var recipeColumnsHeight: CGFloat = 0

    private var weightUnit: String { useUS ? "oz" : "g" }
    private var cookedWeight: Double? { decimal(draft.cooked).flatMap { $0 > 0 ? $0 : nil } }
    private var ingredientWeight: Double { draft.ingredients.compactMap(\.grams).reduce(0, +) }
    private var massDifference: Double { cookedWeight.map { ingredientWeight > 0 ? abs(ingredientWeight - $0) / $0 : 0 } ?? 0 }
    private var staged: [RecipeIngredient] { draft.ingredients.filter(\.staged) }
    private var perHundred: Record? {
        let pairs = draft.ingredients.map { (food: $0.food, grams: $0.grams ?? 0) }
        return Domain.recipePer100g(pairs, cookedWeight: cookedWeight)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Button(action: onClose) { NutriIcon("chevron-left", size: 22).frame(width: 28, height: 38) }
                    .buttonStyle(.plain).accessibilityLabel(store.tr("Volver"))
                Text(store.tr(draft.recordID.isEmpty ? "Nueva receta" : "Editar receta")).font(.nutriDisplay(20))
            }
            if draft.recordID.isEmpty { aiEditor }
            if desktop {
                HStack(alignment: .top, spacing: 24) {
                    recipeInputs.frame(maxWidth: .infinity, alignment: .leading)
                    if let perHundred { stickyPreview(perHundred) }
                    else { Color.clear.frame(maxWidth: .infinity).frame(height: 1) }
                }.onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { recipeColumnsHeight = $0 }
            } else {
                recipeInputs
                if let perHundred { preview(perHundred) }
            }
            if confirm && !staged.isEmpty { confirmCard }
            if !error.isEmpty { Text(error).foregroundStyle(palette.danger).fixedSize(horizontal: false, vertical: true) }
            Button {
                if !staged.isEmpty && !confirm { confirm = true } else { perform(save) }
            } label: { Text(store.tr("Guardar")).frame(maxWidth: .infinity) }
                .buttonStyle(NutriButtonStyle(.primary, height: 44)).disabled(cleanText(draft.name).isEmpty || draft.ingredients.isEmpty || aiLoading)
            if !draft.recordID.isEmpty {
                Button { perform { try await onRemove(draft.recordID) } } label: { Text(store.tr("Borrar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.danger, height: 44))
            }
        }.disabled(busy).task { await loadCatalog() }
    }

    private var recipeInputs: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.tr("Nombre")).foregroundStyle(palette.text2)
                TextField("", text: $draft.name).nutriInput().accessibilityLabel(store.tr("Nombre"))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(store.tr("Ingredientes")).foregroundStyle(palette.text2)
                ForEach($draft.ingredients) { $ingredient in
                    if ingredient.staged { stagedIngredient($ingredient) }
                    else { ingredientRow($ingredient) }
                }
                TextField(store.tr("Añadir ingrediente…"), text: $query).nutriInput()
                RecipeCatalogHits(foods: foods, query: query) { food in
                    draft.ingredients.append(RecipeIngredient(food: food, amount: "", unit: weightUnit))
                    query = ""
                }
                pasteEditor
            }
            VStack(alignment: .leading, spacing: 4) {
                let label = "\(store.tr("Peso cocido")) (\(weightUnit))"
                Text(label).foregroundStyle(palette.text2)
                TextField("", text: Binding(get: {
                    useUS ? typedCooked ?? draftNumber(cookedWeight.map { Domain.round($0 / Domain.gramsPerOunce, 2) }) : draft.cooked
                }, set: { value in
                    if useUS {
                        typedCooked = value
                        draft.cooked = decimal(value).map { draftNumber(Domain.round($0 * Domain.gramsPerOunce, 1)) } ?? value
                    } else { draft.cooked = value }
                })).font(.nutriMono(14)).nutriInput().accessibilityLabel(label)
                Text(store.tr("vacío = suma de ingredientes")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
            CatalogPortionsEditor(portions: $draft.portions)
            recipeWarnings
        }
    }

    private func ingredientRow(_ binding: Binding<RecipeIngredient>) -> some View {
        let row = binding.wrappedValue
        let density = row.food.number("density_g_ml") ?? 0
        let alt = row.unit == "ml" || row.unit == "fl oz"
        let portions = row.food.array("portions").compactMap(\.object).filter { ($0.number("grams") ?? 0) > 0 }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName(row.food)).lineLimit(1)
                    if !row.label.isEmpty { Text(store.tr(row.label)).font(.nutriSans(12)).foregroundStyle(palette.text3) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                Button { removeIngredient(row.id) } label: { NutriIcon("trash-2", size: 16).foregroundStyle(palette.danger).padding(4) }
                    .buttonStyle(.plain).accessibilityLabel(store.tr("Quitar ingrediente"))
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(store.tr(row.unit == "ml" ? "Mililitros" : row.unit == "fl oz" ? "Fl oz" : row.unit == "oz" ? "Oz" : "Gramos"))
                        .foregroundStyle(palette.text2)
                    Spacer(minLength: 0)
                    if density > 0 {
                        CatalogUnitToggle(units: useUS ? ["oz", "fl oz"] : ["g", "ml"], current: row.unit, height: 32) {
                            binding.wrappedValue.changeUnit(to: $0)
                        }
                    }
                }
                TextField("", text: ingredientAmount(binding)).font(.nutriMono(14)).nutriInput().accessibilityLabel(store.tr("Cantidad"))
                if let grams = row.grams, alt || row.unit == "oz" {
                    Text("≈ \(numberText(grams, digits: 1)) g" + (alt ? " (\(store.tr("densidad")) \(draftNumber(density)) g/ml)" : ""))
                        .font(.nutriMono(12)).foregroundStyle(palette.text3)
                }
                if !portions.isEmpty {
                    NutriFlow(spacing: 8) {
                        ForEach(portions.indices, id: \.self) { index in
                            let portion = portions[index]
                            if let grams = portion.number("grams") {
                                Button("+ " + portion.text("name") + " (" + (useUS ? "\(numberText(grams / Domain.gramsPerOunce, digits: 1)) oz" : "\(numberText(grams)) g") + ")") {
                                    binding.wrappedValue.addPortion(grams)
                                }.buttonStyle(NutriButtonStyle(.secondary, height: 36, radius: 18))
                            }
                        }
                    }.padding(.top, 4)
                }
            }
        }.padding(.horizontal, 12).padding(.vertical, 8).nutriCard(radius: 12, fill: palette.surface2)
    }

    private func ingredientAmount(_ binding: Binding<RecipeIngredient>) -> Binding<String> {
        Binding(get: { binding.wrappedValue.amount }, set: {
            binding.wrappedValue.canonicalGrams = nil
            binding.wrappedValue.amount = $0
        })
    }

    private func stagedIngredient(_ binding: Binding<RecipeIngredient>) -> some View {
        let row = binding.wrappedValue
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TextField(store.tr("Nombre del alimento"), text: foodText(binding, "name"))
                    .nutriInput().background(palette.surface3, in: RoundedRectangle(cornerRadius: 12))
                TextField(weightUnit, text: ingredientAmount(binding)).font(.nutriMono(14)).nutriInput().frame(width: 54)
                    .accessibilityLabel(store.tr("Cantidad"))
                Button { perform { try await persistIngredient(row.id) } } label: {
                    NutriIcon("save", size: 16).foregroundStyle(palette.text2).padding(3)
                }.buttonStyle(.plain).disabled(cleanText(row.food.text("name")).isEmpty)
                    .help(store.tr("Guardar alimento")).accessibilityLabel(store.tr("Guardar") + " " + row.food.text("name"))
                Button { removeIngredient(row.id) } label: { NutriIcon("x", size: 16).foregroundStyle(palette.danger) }
                    .buttonStyle(.plain).accessibilityLabel(store.tr("Quitar") + " " + row.food.text("name"))
            }
            Text(store.tr(row.label.isEmpty ? "IA" : row.label) + " · " + store.tr("sin guardar") + " · " + store.tr("valores por 100 g"))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
            HStack(spacing: 8) {
                ForEach(macroStats, id: \.key) { field in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.tr(field.label)).font(.nutriSans(10)).foregroundStyle(palette.text3)
                        TextField("—", text: foodNumber(binding, field.key)).font(.nutriMono(14)).nutriInput()
                            .accessibilityLabel(store.tr(field.label))
                    }
                }
            }
            RecipeStagedSources(foods: foods, usdaQuery: row.usdaQuery,
                catalog: { swapToCatalog(row.id, food: $0) }, usda: { detail in swapToUSDA(row.id, food: detail) })
        }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.warn).allowsHitTesting(false) }
    }

    private func removeIngredient(_ id: UUID) { draft.ingredients.removeAll { $0.id == id } }

    private var pasteEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { showPaste.toggle() } label: {
                HStack(spacing: 4) {
                    NutriIcon(showPaste ? "chevron-down" : "chevron-right", size: 12)
                    Text(store.tr("Pegar lista de ingredientes"))
                }.frame(minHeight: 24)
            }.buttonStyle(.plain).foregroundStyle(palette.text2)
            if showPaste {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $paste).scrollContentBackground(.hidden).font(.nutriMono(14)).padding(5).frame(height: 86)
                        .accessibilityLabel(store.tr("Pegar lista de ingredientes"))
                    if paste.isEmpty {
                        Text("200 g arroz\n15 ml aceite de oliva\npechuga de pollo, 120").font(.nutriMono(14))
                            .foregroundStyle(palette.text3).padding(8).allowsHitTesting(false)
                    }
                }.nutriCard(radius: 12, fill: palette.surface2)
                Button(action: importIngredients) { Text(store.tr("Añadir del texto")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.secondary, height: 40)).disabled(cleanText(paste).isEmpty || loadingCatalog)
                if !pasteNotice.isEmpty { Text(pasteNotice).font(.nutriSans(12)).foregroundStyle(palette.text3) }
            }
        }.padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border).allowsHitTesting(false) }
    }

    private var macroStats: [(key: String, label: String, color: Color)] {
        [("kcal", "Kcal", palette.kcal), ("protein_g", "Prot", palette.protein), ("carbs_g", "Carbs", palette.carbs), ("fat_g", "Grasa", palette.fat)]
    }

    private func stickyPreview(_ row: Record) -> some View {
        let available = recipeColumnsHeight
        return preview(row).frame(maxWidth: .infinity, alignment: .leading)
            .visualEffect { content, geometry in
                let y = geometry.frame(in: .named("recipe-editor-scroll")).minY
                let travel = max(0, available - geometry.size.height)
                return content.offset(y: max(0, min(travel, 24 - y)))
            }.zIndex(1)
    }

    private func preview(_ row: Record) -> some View {
        let favorites = Set(store.prefs.array("fav_micros").compactMap(\.string)).union(Domain.micros.prefix(8).map(\.key))
        return VStack(alignment: .leading, spacing: 8) {
            Text(store.tr("Preview por 100 g")).foregroundStyle(palette.text3)
            HStack(spacing: 8) {
                ForEach(macroStats, id: \.key) { stat in
                    VStack(spacing: 0) {
                        Text(numberText(row.number(stat.key))).font(.nutriMono(18)).foregroundStyle(stat.color).lineLimit(1).minimumScaleFactor(0.7)
                        Text(store.tr(stat.label)).font(.nutriSans(12)).foregroundStyle(palette.text3).lineLimit(1)
                    }.frame(maxWidth: .infinity)
                }
            }.padding(.bottom, desktop ? 4 : 0)
            if desktop {
                ForEach(Domain.micros.filter { $0.key != "agua_ml" && favorites.contains($0.key) }) { micro in
                    Rectangle().fill(palette.border).frame(height: 1)
                    HStack(alignment: .firstTextBaseline) {
                        Text(store.tr(micro.label)).foregroundStyle(palette.text2)
                        Spacer(minLength: 4)
                        if let value = row.object("micros").number(micro.key) {
                            Text("\(numberText(value)) \(micro.unit)" + (Domain.coverage(row, micro.key) == .partial ? " (" + store.tr("parcial") + ")" : ""))
                                .font(.nutriMono(14)).multilineTextAlignment(.trailing)
                        } else { Text(store.tr("Sin dato")).font(.nutriMono(14)).foregroundStyle(palette.text3) }
                    }
                }
            }
        }.padding(16).nutriCard()
    }

    private func countText(_ text: String) -> String {
        store.tr(text).replacingOccurrences(of: "%n2", with: staged.count == 1 ? "" : "n")
            .replacingOccurrences(of: "%n", with: String(staged.count)).replacingOccurrences(of: "%s", with: staged.count == 1 ? "" : "s")
    }

    private var recipeWarnings: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !staged.isEmpty {
                Text(countText("%n alimento%s nuevo%s sin guardar — se crea%n2 al guardar la receta, o guárdalo con ⤓.")).foregroundStyle(palette.text3)
            }
            if massDifference > 0.05, let cookedWeight {
                let factor = Domain.round(cookedWeight / ingredientWeight, 2)
                if massDifference > 0.2 {
                    Text("⚠ " + store.tr("La suma de ingredientes (%a) no cuadra con el total (%b).")
                        .replacingOccurrences(of: "%a", with: showGrams(ingredientWeight)).replacingOccurrences(of: "%b", with: showGrams(cookedWeight)))
                        .foregroundStyle(palette.warn)
                }
                Button(store.tr("Ajustar ingredientes al total (×%n)").replacingOccurrences(of: "%n", with: numberText(factor))) {
                    for index in draft.ingredients.indices {
                        if let grams = draft.ingredients[index].grams { draft.ingredients[index].setGrams(Domain.round(grams * factor, 0)) }
                    }
                }.buttonStyle(NutriButtonStyle(.secondary, height: 44))
            }
            if let kcal = perHundred?.number("kcal") {
                if staged.isEmpty, let estimatedKcal, estimatedKcal >= 50, let cookedWeight {
                    let total = Domain.round(kcal * cookedWeight / 100, 0)
                    if total >= 50 && abs(total - estimatedKcal) / max(total, estimatedKcal) > 0.25 {
                        Text("⚠ " + store.tr("Las kcal calculadas (%a) difieren de la estimación del platillo (%b) — revisa cantidades.")
                            .replacingOccurrences(of: "%a", with: numberText(total)).replacingOccurrences(of: "%b", with: numberText(estimatedKcal)))
                            .foregroundStyle(palette.warn)
                    }
                }
                if kcal > 900 { Text("⚠ " + store.tr("Densidad calórica fuera de rango físico.")).foregroundStyle(palette.warn) }
            }
        }
    }

    private var confirmCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(countText("Se crearán %n alimento%s nuevo%s en tu catálogo:")).foregroundStyle(palette.text2)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(staged) { Text("• " + $0.food.text("name")) }
            }.padding(.leading, 8)
            HStack(spacing: 8) {
                Button(store.tr("Confirmar y guardar")) { perform(save) }.buttonStyle(NutriButtonStyle(.primary, height: 44))
                Button(store.tr("Cancelar")) { confirm = false }.buttonStyle(NutriButtonStyle(.secondary, height: 44))
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).nutriCard(fill: palette.surface2)
    }

    private var aiEditor: some View {
        CatalogAIDataCard(text: $aiText, images: $aiPhotos, loading: aiLoading, error: aiError,
            placeholder: store.tr("Describe el platillo o bebida (p. ej. «Caramel Macchiato 350ml») o adjunta una foto"),
            hint: store.tr("Gemini descompone en ingredientes con nutrientes de respaldo (prefill revisable). Cada alimento nuevo se edita y guarda por separado; prioridad: catálogo › USDA › IA."),
            submit: submitAI) {
            if !dupes.isEmpty {
                Text(store.tr("Ya la tienes:")).font(.nutriSans(12)).foregroundStyle(palette.text2)
                NutriFlow(spacing: 8) {
                    ForEach(dupes.map(RecipeListItem.init)) { item in
                        Button(item.row.text("name")) { Task { await onOpen(item.row) } }
                            .buttonStyle(NutriButtonStyle(.secondary, height: 44, radius: 22))
                    }
                    Button(store.tr("Continuar de todos modos")) { runEstimate() }
                        .buttonStyle(NutriButtonStyle(.secondary, height: 44, radius: 22))
                }
            }
            if aiWeightWarning && (decimal(draft.cooked) ?? 0) <= 0 { Text(store.tr("Falta densidad para convertir el volumen. Introduce el peso cocido.")).font(.nutriSans(12)).foregroundStyle(palette.warn) }
            if let confidence {
                Text("≈ " + store.tr("Ingredientes por IA (confianza %n) — revisa cantidades y nutrientes; guarda cada alimento nuevo.")
                    .replacingOccurrences(of: "%n", with: confidence.isEmpty ? "—" : store.tr(confidence)))
                    .font(.nutriSans(12)).foregroundStyle(palette.text2)
            }
        }
    }

    private func submitAI() {
        guard !aiLoading else { return }
        aiError = ""; confidence = nil; estimatedKcal = nil; dupes = []
        let text = cleanText(aiText)
        let key = text.firstMatch(of: recipeAmountPattern).map { match in cleanText(text.replacingOccurrences(of: String(match.0), with: "", range: match.range)) } ?? text
        if key.isEmpty { runEstimate(); return }
        aiLoading = true
        Task {
            let local = Array(recipes.filter { $0.text("name").localizedCaseInsensitiveContains(key) }.prefix(5))
            if !store.demoActive && !store.offline {
                dupes = (try? await searchCatalogNames(store: store, table: "recipes", term: key, limit: 5)) ?? local
            } else { dupes = local }
            aiLoading = false
            if dupes.isEmpty { runEstimate() }
        }
    }

    private func runEstimate() {
        guard !aiLoading else { return }
        aiLoading = true; aiError = ""; dupes = []
        Task {
            defer { aiLoading = false }
            do {
                if loadingCatalog { await loadCatalog() }
                try await estimateRecipe()
            } catch { aiError = store.failure(error, "No se pudo obtener datos. Revisa la conexión o intenta con otra descripción/foto.", networkOnly: true) }
        }
    }

    private func showGrams(_ grams: Double) -> String {
        useUS ? "\(numberText(grams / Domain.gramsPerOunce, digits: 1)) oz" : "\(numberText(grams, digits: 1)) g"
    }

    private func displayName(_ row: Record) -> String {
        row.text("name").isEmpty ? store.tr("Alimento sin nombre") : row.text("name")
    }

    private func perform(_ action: @escaping () async throws -> Void) {
        Task {
            guard !busy else { return }
            busy = true; error = ""
            defer { busy = false }
            do { try await action() }
            catch { self.error = error.localizedDescription }
        }
    }

    private func loadCatalog() async {
        defer { loadingCatalog = false }
        do { foods = try await store.catalog().filter { !Domain.water($0) } }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func swapToCatalog(_ id: UUID, food: Record) {
        guard let index = draft.ingredients.firstIndex(where: { $0.id == id }) else { return }
        let old = draft.ingredients.remove(at: index)
        var item = RecipeIngredient(food: food, amount: "", unit: weightUnit, label: "catálogo", fromAI: old.fromAI)
        item.setGrams(old.grams)
        appendConsolidated(item, to: &draft.ingredients)
        let alias = cleanText(old.aiOrigin).lowercased()
        if !alias.isEmpty {
            var aliases = store.prefs.object("ingredient_aliases")
            aliases[alias] = .string(food.text("id"))
            Task {
                do { try await store.patchPrefs(["ingredient_aliases": .object(aliases)]) }
                catch { store.report(error) }
            }
        }
    }

    private func swapToUSDA(_ id: UUID, food: Record) {
        guard let index = draft.ingredients.firstIndex(where: { $0.id == id }) else { return }
        var detail = food
        detail["id"] = .string(UUID().uuidString.lowercased())
        let name = draft.ingredients[index].aiOrigin
        if !name.isEmpty { detail["name"] = .string(name) }
        draft.ingredients[index].food = detail
    }

    private func appendConsolidated(_ item: RecipeIngredient, to rows: inout [RecipeIngredient]) {
        guard let index = rows.firstIndex(where: { !$0.staged && $0.fromAI == item.fromAI && $0.food.text("id") == item.food.text("id") }) else {
            rows.append(item); return
        }
        let sum = (rows[index].grams ?? 0) + (item.grams ?? 0)
        rows[index].setGrams(sum > 0 ? sum : nil)
    }

    private func importIngredients() {
        let lines = paste.split(whereSeparator: \.isNewline).map(String.init).map(cleanText).filter { !$0.isEmpty }
        let parsed = lines.compactMap { parseRecipeLine($0, catalog: foods) }
        for var row in parsed {
            let grams = row.grams
            row.unit = weightUnit
            row.setGrams(grams)
            appendConsolidated(row, to: &draft.ingredients)
        }
        paste = ""
        let missed = lines.count - parsed.count
        pasteNotice = store.tr(missed > 0 ? "%n añadidos · %m sin coincidencia (agrégalos arriba)" : "%n añadidos")
            .replacingOccurrences(of: "%n", with: String(parsed.count)).replacingOccurrences(of: "%m", with: String(missed))
    }

    private func foodText(_ binding: Binding<RecipeIngredient>, _ key: String) -> Binding<String> {
        Binding(get: { binding.wrappedValue.food.text(key) },
                set: { binding.wrappedValue.food[key] = .string($0) })
    }

    private func foodNumber(_ binding: Binding<RecipeIngredient>, _ key: String) -> Binding<String> {
        Binding(get: {
            let row = binding.wrappedValue.food
            return row[key]?.string ?? draftNumber(row.number(key))
        }, set: { binding.wrappedValue.food[key] = $0.isEmpty ? .null : .string($0) })
    }

    private func estimateRecipe() async throws {
        let result = try await estimateCatalogAI(store: store, recipe: true, text: aiText, images: aiPhotos, catalogNames: foods.map { $0.text("name") })
        let aliases = store.prefs.object("ingredient_aliases")
        let parsed: [RecipeIngredient] = result.array("ingredients").prefix(15).compactMap { item in
            guard var food = item.object, !cleanText(food.text("name_es")).isEmpty else { return nil }
            let name = cleanText(food.text("name_es"))
            let aliasID = aliases.text(name.lowercased())
            let alias = foods.first { $0.text("id") == aliasID && !aliasID.isEmpty }
            let matches = foods.filter { cleanText($0.text("name")).lowercased() == cleanText(food.text("db_match")).lowercased() && !food.text("db_match").isEmpty }
            let match = alias ?? (matches.count == 1 ? matches.first : nil)
            let grams = food.number("grams").flatMap { $0 > 0 && $0 <= 2000 ? $0 : nil }
            let usda = food.text("usda_query")
            if let match {
                return RecipeIngredient(food: match, amount: draftNumber(grams), label: alias == nil ? "catálogo" : "alias", aiOrigin: name, usdaQuery: usda, fromAI: true)
            }
            food["id"] = .string(UUID().uuidString.lowercased())
            food["name"] = .string(name)
            food["source"] = .string("gemini")
            return RecipeIngredient(food: food, amount: draftNumber(grams), label: "IA", aiOrigin: name, usdaQuery: usda, fromAI: true, staged: true)
        }
        var ingredients = draft.ingredients.filter { !$0.fromAI }
        for var row in parsed where !row.staged {
            let grams = row.grams; row.unit = weightUnit; row.setGrams(grams)
            appendConsolidated(row, to: &ingredients)
        }
        for var row in parsed where row.staged {
            let grams = row.grams; row.unit = weightUnit; row.setGrams(grams)
            ingredients.append(row)
        }
        draft.ingredients = ingredients
        if cleanText(draft.name).isEmpty { draft.name = result.text("name") }
        let explicit = explicitRecipeAmount(aiText)
        if let weight = recipeCookedEstimate(explicit, estimate: result.number("total_weight_g")) {
            aiWeightWarning = false
            draft.cooked = draftNumber(weight)
            typedCooked = nil
        } else if explicit?.unit == "ml" {
            draft.cooked = ""
            typedCooked = nil
            aiWeightWarning = true
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
        for field in Domain.micros {
            let input = raw[field.key]?.string ?? draftNumber(raw.number(field.key))
            micros[field.key] = try featureNumber(input, label: field.label).map(JSONValue.number)
        }
        body["micros"] = .object(micros)
        body["portions"] = .array(food.array("portions"))
        return body
    }

    private func persistIngredient(_ id: UUID, failure: String = "No se pudo guardar el alimento. Intenta de nuevo.") async throws {
        guard let index = draft.ingredients.firstIndex(where: { $0.id == id }), draft.ingredients[index].staged else { return }
        let row = draft.ingredients[index].food
        let payload = try stagedPayload(row)
        let saved: Record
        do {
            do { saved = try await store.insert("foods", payload) }
            catch let error as NutriError where error.code == "23505" {
                let existing = try await store.read("foods", ["id": "eq.\(row.text("id"))"])
                guard let food = existing.first, food.text("owner") == store.owner else { throw error }
                saved = food
            }
        } catch is CancellationError { throw CancellationError() }
        catch { throw FeatureError(store.failure(error, failure)) }
        draft.ingredients[index].food = saved
        draft.ingredients[index].staged = false
        foods.append(saved)
    }

    private func save() async throws {
        let name = cleanText(draft.name)
        guard !name.isEmpty, !draft.ingredients.isEmpty else { throw FeatureError("Ingresa un nombre y al menos un ingrediente.") }
        let cooked = try featureNumber(draft.cooked, label: "Peso cocido", minimum: 0.000001)
        if aiWeightWarning && cooked == nil {
            throw FeatureError(store.tr("Falta densidad para convertir el volumen. Introduce el peso cocido."))
        }
        let portions: [JSONValue] = draft.portions.compactMap { row in
            let name = cleanText(row.name)
            guard !name.isEmpty, let grams = decimal(row.grams), grams > 0 else { return nil }
            return .object(["name": .string(name), "grams": .number(grams)])
        }
        for row in draft.ingredients {
            guard let grams = row.grams, grams.isFinite, grams > 0, !row.food.text("id").isEmpty else {
                throw FeatureError("Cantidad inválida · \(displayName(row.food))")
            }
            if row.staged { _ = try stagedPayload(row.food) }
        }
        for id in draft.ingredients.filter(\.staged).map(\.id) { try await persistIngredient(id, failure: "No se pudo crear un alimento nuevo. Intenta de nuevo.") }
        let gramsByID = draft.ingredients.reduce(into: [String: Double]()) { items, row in
            if let grams = row.grams { items[row.food.text("id"), default: 0] += grams }
        }
        let items: [Record] = gramsByID.keys.sorted().compactMap { id in
            gramsByID[id].map { ["food_id": .string(id), "grams": .number($0)] }
        }
        let row: Record = ["id": .string(draft.recordID), "name": .string(name), "cooked_weight_g": cooked.map(JSONValue.number) ?? .null,
                           "portions": .array(portions), "source": .string(draft.source)]
        let response: JSONValue
        do { response = try await store.rpc("save_recipe_atomic", recipePayload(row, items: items)) }
        catch is CancellationError { throw CancellationError() }
        catch { throw FeatureError(store.failure(error, "No se pudo guardar la receta.", networkOnly: true)) }
        guard response.string?.isEmpty == false else { throw FeatureError("El servidor no identificó la receta guardada.") }
        await onSaved()
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

func recipeCookedEstimate(_ explicit: (value: Double, unit: String)?, estimate: Double?) -> Double? {
    if let explicit, explicit.value.isFinite, explicit.value > 0 {
        if explicit.unit == "g" { return explicit.value }
        let implied = (estimate ?? 0) / explicit.value
        guard implied > 0.5, implied < 2 else { return nil }
        let density = foodDensityPresets.first { abs($0.1 - implied) <= 0.015 }?.1 ?? implied
        let grams = Domain.round(explicit.value * density, 0)
        return grams.isFinite && grams > 0 ? grams : nil
    }
    return estimate.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
}

func parseRecipeLine(_ line: String, catalog: [Record]) -> RecipeIngredient? {
    let explicit = line.firstMatch(of: recipeAmountPattern)
    let plain = line.matches(of: #/([+-]?[0-9]+(?:[.,][0-9]+)?)\b/#).last
    let range = explicit?.range ?? plain?.range
    guard let range else { return nil }
    let prefix = String(line[..<range.lowerBound])
    let suffix = String(line[range.upperBound...])
    guard prefix.range(of: #"\d\s*/\s*$"#, options: .regularExpression) == nil,
          suffix.range(of: #"^\s*/\s*\d"#, options: .regularExpression) == nil else { return nil }
    if explicit == nil {
        let rest = cleanText(suffix)
        let unsupported = rest.range(of: #"(?i)^(mg|mcg|µg|μg|ug|oz|fl\s*oz|lb|lbs|tsp|tbsp|cups?|tazas?|cucharadas?|cucharaditas?|piezas?|pieces?)\b"#, options: .regularExpression) != nil
        if unsupported || (!cleanText(prefix).isEmpty && rest.first?.isLetter == true) { return nil }
    }
    let amount = explicitRecipeAmount(line) ?? (plain.flatMap { Double($0.1.replacingOccurrences(of: ",", with: ".")) }.map { (value: $0, unit: "g") })
    guard let amount, amount.value.isFinite, amount.value > 0 else { return nil }
    var name = line
    name.replaceSubrange(range, with: " ")
    let term = CSV.normalize(name.replacingOccurrences(of: #"[,;:\t]"#, with: " ", options: .regularExpression))
    guard !term.isEmpty else { return nil }
    let exact = catalog.filter { CSV.normalize($0.text("name")) == term }
    let prefixMatches = catalog.filter { let name = CSV.normalize($0.text("name")); return !name.isEmpty && (name.hasPrefix(term) || term.hasPrefix(name)) }
    let contains = catalog.filter { let name = CSV.normalize($0.text("name")); return !name.isEmpty && (name.contains(term) || term.contains(name)) }
    let chosen = !exact.isEmpty ? exact : !prefixMatches.isEmpty ? prefixMatches : contains
    guard chosen.count == 1, let food = chosen.first,
          let grams = Domain.grams(amount.value, unit: amount.unit, density: food.number("density_g_ml")),
          grams.isFinite else { return nil }
    return RecipeIngredient(food: food, amount: draftNumber(amount.value), unit: amount.unit)
}

private struct RecipeCatalogHits: View {
    @Environment(\.nutriPalette) private var palette
    let foods: [Record]
    let query: String
    let select: (Record) -> Void
    @State private var filter = ""
    @State private var exact: [Record]?
    @EnvironmentObject private var store: Store

    private var results: [Record] {
        guard !filter.isEmpty, filter == cleanText(query) else { return [] }
        let results = (exact ?? foods.filter { $0.text("name").localizedCaseInsensitiveContains(filter) }).prefix(8)
        return results.filter { $0.text("source") != "usda" } + results.filter { $0.text("source") == "usda" }
    }

    var body: some View {
        Group {
            if !results.isEmpty {
                VStack(spacing: 0) {
                    ForEach(results.map(RecipeListItem.init)) { item in
                        Button { select(item.row) } label: {
                            Text(item.row.text("name")).padding(.horizontal, 12).padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }.nutriCard(radius: 12, fill: palette.surface2)
            }
        }.task(id: query) {
            exact = nil
            let term = cleanText(query)
            if term.isEmpty { filter = ""; return }
            do {
                try await Task.sleep(for: .milliseconds(250))
                filter = term
                if !store.demoActive, !store.offline {
                    let rows = try await searchCatalogNames(store: store, table: "foods", term: term, limit: 8)
                    guard !Task.isCancelled, cleanText(query) == term else { return }
                    exact = rows
                }
            } catch { }
        }
    }
}

private struct RecipeStagedSources: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let foods: [Record]
    let usdaQuery: String
    let catalog: (Record) -> Void
    let usda: (Record) -> Void
    @State private var query = ""
    @State private var matches: [Record] = []
    @State private var translated: [String: String] = [:]
    @State private var error = ""
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(store.tr("¿Ya está en tu catálogo? Búscalo…"), text: $query).nutriInput()
            RecipeCatalogHits(foods: foods, query: query, select: catalog)
            if !matches.isEmpty {
                NutriFlow {
                    ForEach(matches.indices, id: \.self) { index in
                        let row = matches[index]
                        let description = row.text("description")
                        Button("USDA: " + (translated[description] ?? description)) {
                            Task {
                                guard !picking, let id = row.number("fdcId").flatMap(Int.init(exactly:)) else { return }
                                picking = true; error = ""
                                defer { picking = false }
                                do { usda(try await fetchFDC(store: store, id: id)) }
                                catch { self.error = store.tr("No se pudo obtener el detalle de USDA.") }
                            }
                        }.buttonStyle(NutriButtonStyle(.secondary, height: 36, radius: 18)).font(.nutriSans(12))
                            .disabled(picking)
                    }
                }
            }
            if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
        }.task(id: usdaQuery) {
            matches = []; translated = [:]
            guard !usdaQuery.isEmpty, !store.demoActive, !store.anonymous else { return }
            let hits = (try? await searchFDC(store: store, query: usdaQuery)) ?? []
            guard !Task.isCancelled else { return }
            matches = hits
            await withTaskGroup(of: (String, String).self) { group in
                for hit in hits {
                    let description = hit.text("description")
                    group.addTask { (description, await translateFDCEnEs(description)) }
                }
                for await (text, result) in group where !Task.isCancelled { translated[text] = result }
            }
        }
    }
}
