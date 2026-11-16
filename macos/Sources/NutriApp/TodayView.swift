import NutriCore
import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var store: Store
    @State private var date = Date()
    @State private var serverRows: [Record] = []
    @State private var loadedDay = ""
    @State private var labels: [Record] = []
    @State private var targets: [Record] = []
    @State private var history: [Record] = []
    @State private var proposal: PhaseProposal?
    @State private var editor: Sheet?
    @State private var loading = true
    @State private var confirmingDeleteDay = false
    @State private var busy = false
    @State private var waterAmount = ""
    @State private var energy = ""
    @State private var expandedMicros = false
    @State private var importRows: [Record] = []
    @State private var confirmingImport = false

    private enum Sheet: Identifiable {
        case entry(Record?, String, Record?, Double?)
        case labels, templates, summary
        var id: String {
            switch self {
            case let .entry(row, label, food, _): return "entry-" + (row?.text("id") ?? "") + label + (food?.text("id") ?? "")
            case .labels: return "labels"
            case .templates: return "templates"
            case .summary: return "summary"
            }
        }
    }

    private var day: String { Day.key(date) }
    private var rows: [Record] { store.queuedDay(loadedDay == day ? serverRows : [], day) }
    private var waterID: String { store.prefs.text("water_food_id") }
    private var foodRows: [Record] {
        rows.filter { row in
            row.text("food_id").isEmpty || (row.text("food_id") != waterID && !Domain.water(row))
        }
    }
    private var waterRows: [Record] { rows.filter { !foodRows.contains($0) } }
    private var currentTarget: Record? { Domain.resolveTarget(targets, day) }
    private var totals: Record { Domain.totals(rows) }
    private var activeBands: Record { store.prefs.object("adherence_bands") }

    var body: some View {
        VStack(spacing: 0) {
            ColumnHeader(store.tr("Hoy")) { dayToolbar }
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if loading && rows.isEmpty { ProgressView().frame(maxWidth: .infinity).padding() }
                    summary
                    waterPanel
                    ForEach(labels, id: \.self) { label in section(label) }
                    section(nil)
                }
                .padding(24)
                .frame(maxWidth: 1100, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .task(id: day) { await loadDay(); await loadReference() }
        .onChange(of: day) { _, _ in
            energy = ""
            proposal = nil
        }
        .onChange(of: store.entryVersion) { _, _ in
            if store.pending == 0 {
                if let cached = store.cached("entry_nutrients", Store.entriesQuery(day)) {
                    loadedDay = day
                    serverRows = cached
                }
                Task { await loadDay() }
            }
        }
        .onAppear { openFromFood() }
        .onChange(of: store.logFood) { _, _ in openFromFood() }
        .sheet(item: $editor, onDismiss: { Task { await loadLabels() } }) { sheet in
            switch sheet {
            case let .entry(row, label, food, amount):
                EntryEditor(row: row, day: day, initialLabel: label, initialFood: food, initialAmount: amount,
                            labels: labels, frequent: frequent(label), close: { editor = nil })
            case .labels:
                MealLabelsView { editor = nil }
            case .templates:
                MealTemplatesView(day: day, entries: foodRows, close: { editor = nil }, reload: loadDay)
            case .summary:
                SummarySettingsView { editor = nil }
            }
        }
        .confirmationDialog(store.tr("¿Borrar los alimentos de este día?"), isPresented: $confirmingDeleteDay, titleVisibility: .visible) {
            Button(store.tr("Borrar día"), role: .destructive) { run(clearDay) }
        } message: {
            Text("\(foodRows.count) \(store.tr("registros")) · " + store.tr("Se conserva el agua."))
        }
        .confirmationDialog(store.tr("Importar registros"), isPresented: $confirmingImport) {
            Button(store.tr("Importar") + " \(importRows.count)") {
                run {
                    _ = try await store.insert("entries", importRows)
                    importRows = []
                    await loadDay()
                }
            }
        } message: { Text(store.tr("Revisa la fecha y el número de registros antes de guardar.")) }
    }

    private var dayToolbar: some View {
        HStack(spacing: 10) {
            Button { date = Day.add(date, -1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel(store.tr("Día anterior"))
            DatePicker(store.tr("Fecha"), selection: $date, displayedComponents: .date).labelsHidden()
            Button { date = Day.add(date, 1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel(store.tr("Día siguiente"))
            Button(store.tr("Hoy")) { date = Date() }.disabled(day == Day.key(Date()))
            Menu {
                Button(store.tr("Etiquetas de sección…")) { editor = .labels }
                Button(store.tr("Plantillas de comida…")) { editor = .templates }
                Button(store.tr("Configurar resumen…")) { editor = .summary }
                Divider()
                Button(store.tr("Copiar día")) {
                    do {
                        try store.copyDay(day)
                        store.toast(store.tr("Día copiado."))
                    } catch { store.report(error) }
                }.disabled(foodRows.isEmpty)
                Button(store.tr("Pegar día copiado")) { if let copiedDay = store.copiedDay { run { try await copy(from: copiedDay) } } }.disabled(store.copiedDay == nil)
                Button(store.tr("Copiar ayer")) { run { try await copy(from: Day.key(Day.add(date, -1))) } }
                Button(store.tr("Importar CSV…")) { run(prepareImport) }
                Divider()
                Button(store.tr("Borrar día"), role: .destructive) { confirmingDeleteDay = true }.disabled(foodRows.isEmpty || store.pending > 0)
            } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel(store.tr("Acciones del día"))
            Button {
                editor = .entry(nil, "", nil, nil)
            } label: { Label(store.tr("Registrar"), systemImage: "plus") }
                .buttonStyle(.borderedProminent).keyboardShortcut("n", modifiers: .command)
        }
        .disabled(busy)
    }

    private var summary: some View {
        Panel(currentTarget.map { $0.text("label") }.flatMap { $0.isEmpty ? nil : $0 } ?? store.tr("Resumen nutricional")) {
            let mode = store.prefs.text("today_view")
            let currentMode = ["estado", "objetivos", "mini"].contains(mode) ? mode : "estado"
            let config = store.prefs.object("today_card").object(currentMode)
            let configured = config.array("items").compactMap(\.string)
            let keys = configured.isEmpty ? Domain.macroKeys + ["sodio_mg", "potasio_mg"] : configured
            let showRanges = config["showRanges"]?.bool ?? false
            HStack {
                Picker(store.tr("Resumen"), selection: Binding(get: { currentMode }, set: { value in
                    run { try await store.patchPrefs(["today_view": .string(value)]) }
                })) {
                    Text(store.tr("Estado")).tag("estado")
                    Text(store.tr("Objetivos")).tag("objetivos")
                    Text(store.tr("Compacto")).tag("mini")
                }
                .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 320)
                Spacer()
                Button { editor = .summary } label: { Image(systemName: "slider.horizontal.3") }
                    .accessibilityLabel(store.tr("Configurar resumen"))
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: currentMode == "mini" ? 115 : 155), spacing: 12)], spacing: 12) {
                ForEach(keys, id: \.self) { key in
                    nutrientTile(key, showRanges: showRanges, compact: currentMode == "mini", mode: config["mode"]?.string ?? (currentMode == "estado" ? "meta" : "delta"))
                }
            }
            if currentTarget?.object("rules").object("transition").text("kind") == "coupled_band" {
                HStack {
                    Text(store.tr("Guía de macros"))
                    TextField(store.tr("Kcal elegidas"), text: $energy).frame(width: 110)
                    if let currentTarget, let kcal = decimal(energy), let guide = Domain.coupledBand(currentTarget, energy: kcal) {
                        Text("\(numberText(guide.number("protein_g"))) g P · \(numberText(guide.number("carbs_g"))) g C · \(numberText(guide.number("fat_g"))) g G")
                            .monospacedDigit()
                    } else if !energy.isEmpty {
                        Text(store.tr("Elige una energía dentro de la banda.")).foregroundStyle(.secondary)
                    }
                }
            }
            if let proposal, day == Day.key(Date()) {
                Label(store.tr("Propuesta para revisar en el plan maestro"), systemImage: "flag").font(.callout.weight(.semibold))
                Text(proposal.reason).font(.callout).foregroundStyle(.secondary)
            }
            DisclosureGroup(store.tr("Micronutrientes y cobertura"), isExpanded: $expandedMicros) {
                let favorite = store.prefs.array("fav_micros").compactMap(\.string)
                let observed = Domain.micros.filter {
                    totals.object("micros")[$0.key] != nil || currentTarget?.object("micros")[$0.key] != nil
                        || currentTarget?.object("bounds")[$0.key] != nil || favorite.contains($0.key)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                    ForEach(observed) { nutrient in
                        nutrientTile(nutrient.key, showRanges: true, compact: true)
                    }
                }.padding(.top, 10)
            }
        }
    }

    private func nutrientTile(_ key: String, showRanges: Bool, compact: Bool, mode: String = "meta") -> some View {
        let micro = Domain.micros.first { $0.key == key }
        let value = Domain.value(totals, key)
        let macroCoverage: Domain.Coverage = value == nil ? .unknown : rows.contains(where: { $0.number(key) == nil }) ? .partial : .complete
        let coverage = micro == nil ? macroCoverage : Domain.coverage(totals, key)
        let coupled = ["carbs_g", "fat_g"].contains(key)
            && currentTarget?.object("rules").object("transition").text("kind") == "coupled_band"
        let point = coupled ? nil : currentTarget.flatMap { Domain.value($0, key) }
        let bounds = Domain.bounds(key, target: currentTarget, bands: activeBands)
        let classification = coverage == .complete && !coupled ? value.flatMap {
            Domain.classify(key, value: $0, target: currentTarget, hasFood: !foodRows.isEmpty, bands: activeBands)
        } : nil
        let sodiumLow = key == "sodio_mg" && !foodRows.isEmpty && value.map { $0 < Domain.sodiumFloor } == true
        let title = store.tr(micro?.label ?? Domain.macroLabels[key] ?? key)
        let unit = micro?.unit ?? (key == "kcal" ? "kcal" : "g")
        return VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(value.map { "\(numberText($0, digits: compact ? 2 : 1)) \(unit)" } ?? store.tr("Sin dato"))
                .font(compact ? .body.weight(.semibold) : .title2.weight(.semibold))
                .monospacedDigit()
            if showRanges, bounds.min != nil || bounds.max != nil {
                Text(range(bounds.min, bounds.max, unit: unit)).font(.caption).foregroundStyle(.secondary)
            } else if let point {
                Text(store.tr("Meta") + " \(numberText(point)) \(unit)").font(.caption).foregroundStyle(.secondary)
            }
            if mode != "meta", coverage == .complete, let value, let point, point > 0 {
                let delta = value - point
                let display = mode == "pct" ? numberText(delta * 100 / point, digits: 0) + "%" : numberText(delta) + " " + unit
                Text((delta > 0 ? "+" : "") + display).font(.caption.monospacedDigit())
            }
            if sodiumLow {
                let warning = store.tr("Sodio bajo")
                Label(coverage == .partial ? warning + " · " + store.tr("Datos parciales") : warning,
                      systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).font(.caption)
            }
            if coverage != .complete && !rows.isEmpty {
                Text(store.tr(coverage == .partial ? "Datos parciales" : "Sin dato"))
                    .font(.caption).foregroundStyle(.secondary)
            } else if let classification {
                Text(store.tr(classification == .ok ? "En rango" : classification == .warn ? "Cerca del rango" : "Fuera de rango"))
                    .font(.caption)
                    .foregroundStyle(classification == .ok ? Color.green : classification == .warn ? Color.orange : Color.red)
            }
        }
        .padding(compact ? 8 : 11)
        .frame(maxWidth: .infinity, minHeight: compact ? 70 : 96, alignment: .topLeading)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 9))
    }

    private func range(_ min: Double?, _ max: Double?, unit: String) -> String {
        if let min, let max { return "\(numberText(min))–\(numberText(max)) \(unit)" }
        if let min { return "≥ \(numberText(min)) \(unit)" }
        if let max { return "≤ \(numberText(max)) \(unit)" }
        return ""
    }

    private var waterPanel: some View {
        let glass = store.prefs.number("water_glass_ml") ?? 1000
        return Panel(store.tr("Agua")) {
            HStack(spacing: 12) {
                Image(systemName: "drop.fill").foregroundStyle(.blue)
                Text(volume(Domain.value(totals, "agua_ml") ?? 0)).font(.title3.monospacedDigit())
                if let target = currentTarget.flatMap({ Domain.value($0, "agua_ml") }) {
                    Text(store.tr("Meta") + " " + volume(target)).foregroundStyle(.secondary)
                }
                Spacer()
                TextField(store.units == "us" ? "fl oz" : "ml", text: $waterAmount).frame(width: 76)
                Button(store.tr("Agregar")) {
                    guard let n = decimal(waterAmount), n > 0 else { store.report(NutriError("Ingresa un volumen válido.")); return }
                    run { try await addWater(n * (store.units == "us" ? Domain.mlPerFluidOunce : 1)); waterAmount = "" }
                }.disabled(waterAmount.isEmpty || busy)
                Button("+ " + volume(glass)) { run { try await addWater(glass) } }.disabled(busy)
                Button {
                    if let row = waterRows.last { remove(row) }
                } label: { Image(systemName: "arrow.uturn.backward") }
                    .accessibilityLabel(store.tr("Quitar último vaso")).disabled(waterRows.isEmpty)
            }
        }
    }

    private func section(_ label: Record?) -> some View {
        let id = label?.text("id") ?? ""
        let known = Set(labels.map { $0.text("id") })
        let entries = foodRows.filter { row in
            let labelID = row.text("meal_label_id")
            return id.isEmpty ? labelID.isEmpty || !known.contains(labelID) : id == labelID
        }.sorted(by: Self.rowOrder)
        return Panel(label.map { store.tr($0.text("name")) } ?? store.tr("Sin etiqueta")) {
            if entries.isEmpty {
                Text(store.tr("Sin registros")).foregroundStyle(.secondary)
            }
            ForEach(Array(entries.enumerated()), id: \.element) { index, row in
                if index > 0 { Divider() }
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(row.text("item")).font(.body.weight(.medium))
                        if !row.text("brand").isEmpty { Text(row.text("brand")).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer(minLength: 12)
                    if row["_pending"]?.bool == true {
                        Image(systemName: "clock").foregroundStyle(.secondary).accessibilityLabel(store.tr("Pendiente"))
                    }
                    Text(weight(row.number("grams") ?? 0)).foregroundStyle(.secondary).monospacedDigit()
                    Text(row.number("kcal").map { "\(numberText($0, digits: 1)) kcal" } ?? store.tr("Sin dato"))
                        .font(.callout.monospacedDigit()).frame(minWidth: 72, alignment: .trailing)
                    Menu {
                        Button(store.tr("Editar")) { editor = .entry(row, id, nil, nil) }
                        Button(store.tr("Mover arriba")) { run { try await reorder(entries, index: index, offset: -1) } }
                            .disabled(index == 0 || store.pending > 0)
                        Button(store.tr("Mover abajo")) { run { try await reorder(entries, index: index, offset: 1) } }
                            .disabled(index + 1 == entries.count || store.pending > 0)
                        Divider()
                        Button(store.tr("Borrar"), role: .destructive) { remove(row) }
                    } label: { Image(systemName: "ellipsis") }.frame(width: 38)
                }
            }
            HStack {
                Button { editor = .entry(nil, id, nil, nil) } label: { Label(store.tr("Agregar"), systemImage: "plus") }
                let recent = frequent(id)
                if !recent.isEmpty {
                    Menu(store.tr("Frecuentes")) {
                        ForEach(recent, id: \.self) { row in
                            Button(row.text("item")) { editor = .entry(nil, id, row, row.number("grams")) }
                        }
                    }.frame(maxWidth: 130)
                }
            }
            .padding(.top, 4)
        }
    }

    private static func rowOrder(_ a: Record, _ b: Record) -> Bool {
        let lhs = a.number("sort_order") ?? .infinity
        let rhs = b.number("sort_order") ?? .infinity
        if lhs != rhs { return lhs < rhs }
        return a.text("created_at") < b.text("created_at")
    }

    private func weight(_ grams: Double) -> String {
        store.units == "us" ? "\(numberText(grams / Domain.gramsPerOunce)) oz" : "\(numberText(grams)) g"
    }

    private func volume(_ ml: Double) -> String {
        store.units == "us" ? "\(numberText(ml / Domain.mlPerFluidOunce)) fl oz" : "\(numberText(ml)) ml"
    }

    private func loadDay() async {
        let key = day
        let query = Store.entriesQuery(key)
        if let cache = store.cached("entry_nutrients", query) { serverRows = cache; loadedDay = key }
        loading = loadedDay != key
        defer { if day == key { loading = false } }
        do {
            let result = try await store.read("entry_nutrients", query)
            if day == key, !Task.isCancelled { serverRows = result; loadedDay = key }
        } catch { store.report(error) }
    }

    private func loadLabels() async {
        let query = ["archived_at": "is.null", "order": "sort_order.asc,name.asc"]
        if let cached = store.cached("meal_labels", query) { labels = cached }
        do { labels = try await store.read("meal_labels", query) } catch { store.report(error) }
    }

    private func loadReference() async {
        await loadLabels()
        let key = day
        let start = Day.key(Day.add(date, -30))
        do {
            async let recent = store.read("entry_nutrients", dateFilter(start, key))
            async let targetRows = store.read("targets", ["order": "valid_from.desc.nullslast,dow.asc"])
            let (loadedHistory, loadedTargets) = try await (recent, targetRows)
            guard day == key, !Task.isCancelled else { return }
            history = loadedHistory
            targets = loadedTargets
            if day == Day.key(Date()) {
                let active = Domain.activePhase(targets, day: day)
                if active.contains(where: { !$0.object("rules").isEmpty || $0.text("goal") == "deficit" }) {
                    let filter = dateFilter(Day.key(Day.add(date, -35)), key)
                    async let body = store.read("body_metrics", filter)
                    async let totals = store.read("daily_totals", filter)
                    let result = try await phaseProposal(targets: targets, phase: active, body: body, totals: totals, today: date)
                    if day == key, !Task.isCancelled { proposal = result }
                }
            }
        } catch { store.report(error) }
    }

    private func frequent(_ label: String) -> [Record] {
        struct Count {
            let row: Record
            var score = 0.0
            var recent = ""
            var amounts: [Double] = []
        }
        let dates = Dictionary(uniqueKeysWithValues: (0...30).map { (Day.key(Day.add(date, -$0)), $0) })
        let existing = Set(rows.map { $0.text("id") })
        let eligible = history.filter {
            dates[$0.text("day")] != nil && !(loadedDay == day && $0.text("day") == day) && !existing.contains($0.text("id"))
        } + rows
        func itemKey(_ row: Record) -> String {
            row.text("food_id").isEmpty ? "recipe:" + row.text("recipe_id") : "food:" + row.text("food_id")
        }
        let repeatIDs = Set(eligible.filter {
            $0.text("day") == day && (label.isEmpty || $0.text("meal_label_id") == label)
        }.map(itemKey))
        var rank: [String: Count] = [:]
        for row in eligible where (label.isEmpty || row.text("meal_label_id") == label) {
            let foodID = row.text("food_id")
            if !foodID.isEmpty && (foodID == waterID || Domain.water(row)) { continue }
            let key = itemKey(row)
            guard !key.hasSuffix(":"), let age = dates[row.text("day")] else { continue }
            rank[key, default: Count(row: row)].score += pow(2, -Double(age) / 7) * (repeatIDs.contains(key) ? 0.25 : 1)
            if rank[key]?.recent ?? "" < row.text("day") { rank[key]?.recent = row.text("day") }
            if let grams = row.number("grams") { rank[key]?.amounts.append(grams) }
        }
        return rank.sorted { a, b in
            if a.value.score != b.value.score { return a.value.score > b.value.score }
            if a.value.recent != b.value.recent { return a.value.recent > b.value.recent }
            return a.key < b.key
        }.prefix(8).map { _, count in
            var result = count.row
            let weights = Dictionary(grouping: count.amounts, by: { $0 }).mapValues(\.count)
            if let grams = count.amounts.max(by: { (weights[$0] ?? 0) < (weights[$1] ?? 0) }) { result["grams"] = .number(grams) }
            return result
        }
    }

    private func openFromFood() {
        guard let food = store.logFood else { return }
        editor = .entry(nil, "", food, nil)
        store.logFood = nil
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { store.report(error) }
        }
    }

    private func addWater(_ ml: Double) async throws {
        let meta: Record = ["kcal": .number(0), "protein_g": .number(0), "carbs_g": .number(0), "fat_g": .number(0),
                            "micros": .object(["agua_ml": .number(100)])]
        var food: Record?
        if !waterID.isEmpty {
            do { food = try await store.read("foods", ["id": "eq." + waterID]).first(where: Domain.water) }
            catch let error as URLError where error.code != .cancelled { food = ["id": .string(waterID)] }
        }
        if food == nil {
            guard let owner = store.owner else { throw CancellationError() }
            let own = try await store.read("foods", ["owner": "eq." + owner, "name": "eq.Agua"])
            if let existing = own.first(where: Domain.water) { food = existing }
            else {
                food = try await store.insert("foods", meta.merging(["name": .string("Agua"), "source": .string("manual")]) { _, new in new })
            }
            if let id = food?.text("id") { try await store.patchPrefs(["water_food_id": .string(id)]) }
        }
        guard let id = food?.text("id"), !id.isEmpty else { throw NutriError("No se encontró el alimento para registrar agua.") }
        let payload: Record = ["id": .string(UUID().uuidString.lowercased()), "day": .string(day), "grams": .number(ml),
                               "food_id": .string(id), "recipe_id": .null, "meal_label_id": .null]
        let row = payload.merging(Domain.scaled(meta, grams: ml)) { _, new in new }
            .merging(["item": .string("Agua"), "created_at": .string(Date.now.ISO8601Format())]) { _, new in new }
        try store.addEntry(payload, row: row)
    }

    private func remove(_ row: Record) {
        do {
            try store.removeEntry(row.text("id"), row: row)
            store.undo(store.tr("Registro borrado")) {
                var payload = entryPayload(row)
                payload["day"] = row["day"]
                payload["id"] = .string(UUID().uuidString.lowercased())
                payload["sort_order"] = row["sort_order"] ?? .null
                try store.addEntry(payload, row: row.merging(payload) { _, new in new })
            }
        } catch { store.report(error) }
    }

    private func reorder(_ entries: [Record], index: Int, offset: Int) async throws {
        var ordered = entries
        let other = index + offset
        guard ordered.indices.contains(other) else { return }
        ordered.swapAt(index, other)
        for (order, row) in ordered.enumerated() where row.number("sort_order") != Double(order) {
            _ = try await store.update("entries", ["id": "eq." + row.text("id")], ["sort_order": .number(Double(order))])
        }
        await loadDay()
    }

    private func copy(from source: String) async throws {
        let sourceRows = try await store.read("entry_nutrients", Store.entriesQuery(source))
        let sourceFood = sourceRows.filter { $0.text("food_id") != waterID || waterID.isEmpty }.filter { !Domain.water($0) }
        guard !sourceFood.isEmpty else { throw NutriError("Ese día no tiene registros.") }
        let payload: [Record] = sourceFood.map { entryPayload($0).merging(["day": .string(day)]) { _, new in new } }
        _ = try await store.insert("entries", payload)
        store.toast("\(payload.count) " + store.tr("registros copiados."))
        await loadDay()
    }

    private func clearDay() async throws {
        let ids = foodRows.map { $0.text("id") }
        guard !ids.isEmpty, store.pending == 0 else { return }
        _ = try await store.delete("entries", ["day": "eq." + day, "id": "in.(" + ids.joined(separator: ",") + ")"])
        await loadDay()
    }

    private func prepareImport() async throws {
        guard let url = openFiles([.commaSeparatedText, .plainText]).first else { return }
        guard let content = String(data: try secureFileData(url), encoding: .utf8) else {
            throw NutriError("El CSV debe estar en UTF-8.")
        }
        let foods = try await store.catalog()
        let parsed = try CSV.parse(content)
        var payloads: [Record] = []
        for (index, row) in parsed.enumerated() {
            let name = cleanText(row["food"] ?? row["name"] ?? "")
            let nameKey = CSV.normalize(name)
            let options = foods.filter {
                let display = $0.text("name") + ($0.text("brand").isEmpty ? "" : " (" + $0.text("brand") + ")")
                return CSV.normalize($0.text("name")) == nameKey || CSV.normalize(display) == nameKey
            }
            guard options.count == 1, let food = options.first, let grams = decimal(row["grams"] ?? ""), grams > 0 else {
                throw NutriError("Fila \(index + 2): alimento ambiguo/inexistente o gramos inválidos.")
            }
            let labelName = CSV.normalize(row["meal"] ?? "")
            let matches = labels.filter { CSV.normalize($0.text("name")) == labelName }
            guard labelName.isEmpty || matches.count == 1 else { throw NutriError("Fila \(index + 2): etiqueta inexistente o ambigua.") }
            let entryDay = cleanText(row["day"] ?? "").isEmpty ? day : cleanText(row["day"] ?? "")
            guard Day.date(entryDay) != nil else { throw NutriError("Fila \(index + 2): fecha inválida.") }
            payloads.append(["day": .string(entryDay), "food_id": .string(food.text("id")), "recipe_id": .null,
                             "meal_label_id": matches.first?["id"] ?? .null, "grams": .number(grams)])
        }
        guard !payloads.isEmpty else { throw NutriError("El CSV no contiene registros.") }
        importRows = payloads
        confirmingImport = true
    }
}

private func entryPayload(_ row: Record) -> Record {
    ["meal_label_id": row["meal_label_id"] ?? .null, "food_id": row["food_id"] ?? .null,
     "recipe_id": row["recipe_id"] ?? .null, "grams": row["grams"] ?? .null]
}

private struct EntryEditor: View {
    @EnvironmentObject private var store: Store
    let row: Record?
    let day: String
    let initialLabel: String
    let initialFood: Record?
    let initialAmount: Double?
    let labels: [Record]
    let frequent: [Record]
    let close: () -> Void
    @State private var foods: [Record] = []
    @State private var recipes: [Record] = []
    @State private var recipeMeta: [Record] = []
    @State private var search = ""
    @State private var selected: Record?
    @State private var unit = "g"
    @State private var amount = ""
    @State private var label = ""
    @State private var searching = false
    @State private var semantic: [Record] = []
    @State private var busy = false

    private var density: Double? { selected?.number("density_g_ml") }
    private var grams: Double? { decimal(amount).flatMap { Domain.grams($0, unit: unit, density: density) } }
    private var isRecipe: Bool { selected?["_recipe"]?.bool == true }
    private var edibleFoods: [Record] { foods.filter { !Domain.water($0) } }
    private var choices: [Record] {
        let query = CSV.normalize(search)
        let lexical = (edibleFoods + recipes).filter { choice in
            query.isEmpty || CSV.normalize(choice.text("name") + " " + choice.text("brand")).contains(query)
        }
        let ids = Set(lexical.map { $0.text("id") })
        return Array((lexical + semantic.filter { !ids.contains($0.text("id")) && !Domain.water($0) }).prefix(75))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            EditorTitle(title: store.tr(row == nil ? "Registrar alimento o receta" : "Editar registro"), close: close)
            if let selected {
                selectionPane(selected)
            } else {
                catalogPane
            }
            HStack {
                Button(store.tr("Cancelar"), action: close).keyboardShortcut(.cancelAction)
                Spacer()
                Button(store.tr(row == nil ? "Registrar" : "Guardar"), action: save)
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(selected == nil || grams == nil || busy)
            }.padding(.top, 6)
        }
        .padding(20).frame(width: 540)
        .task {
            label = row?.text("meal_label_id") ?? initialLabel
            unit = store.units == "us" ? "oz" : "g"
            if let existing = row { selectInitial(existing, suggested: existing.number("grams")) }
            else if let initialFood { selectInitial(initialFood, suggested: initialAmount) }
            do {
                async let foodRows = store.catalog()
                async let recipeRows = store.read("recipes", ["order": "name.asc"])
                async let nutrientRows = store.read("recipe_per_100g")
                let (f, r, m) = try await (foodRows, recipeRows, nutrientRows)
                foods = f
                recipes = r.map { $0.merging(["_recipe": .bool(true)]) { _, new in new } }
                recipeMeta = m
                if let item = selected, let full = (foods + recipes).first(where: { $0.text("id") == item.text("id") }) {
                    selected = full
                }
            } catch { store.report(error) }
        }
        .task(id: search) {
            semantic = []
            let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
            guard query.count >= 2, choices.count < 8, !store.offline else { return }
            do {
                try await Task.sleep(for: .milliseconds(400))
                searching = true
                defer { searching = false }
                let values = try await searchSemanticFoods(store: store, query: query)
                if !Task.isCancelled { semantic = values }
            } catch { }
        }
    }

    private func selectionPane(_ selected: Record) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        HStack {
            VStack(alignment: .leading) {
                Text(selected.text("name")).font(.headline)
                if !selected.text("brand").isEmpty { Text(selected.text("brand")).foregroundStyle(.secondary) }
            }
            Spacer()
            if row == nil { Button(store.tr("Cambiar")) { self.selected = nil } }
        }
        HStack {
            TextField(store.tr("Cantidad"), text: $amount)
            Picker(store.tr("Unidad"), selection: Binding(get: { unit }, set: changeUnit)) {
                Text("g").tag("g")
                Text("oz").tag("oz")
                if let density, density > 0 {
                    Text("ml").tag("ml")
                    Text("fl oz").tag("fl oz")
                }
            }.labelsHidden().frame(width: 75)
            if let grams, unit != "g" { Text("≈ " + numberText(grams) + " g").foregroundStyle(.secondary) }
        }
        if !selected.array("portions").isEmpty {
            Menu(store.tr("Añadir porción")) {
                ForEach(selected.array("portions").compactMap(\.object), id: \.self) { portion in
                    Button(portion.text("name") + " · " + numberText(portion.number("grams")) + " g") {
                        let total = (grams ?? 0) + (portion.number("grams") ?? 0)
                        amount = formText(amountFor(total, unit: unit))
                    }
                }
            }.frame(maxWidth: 180)
        }
        Picker(store.tr("Etiqueta"), selection: $label) {
            Text(store.tr("Sin etiqueta")).tag("")
            if !label.isEmpty, !labels.contains(where: { $0.text("id") == label }) {
                Text(store.tr("Etiqueta archivada")).tag(label)
            }
            ForEach(labels, id: \.self) { label in Text(label.text("name")).tag(label.text("id")) }
        }
        if let grams, let kcal = Domain.scaled(metaFor(selected), grams: grams).number("kcal") {
            Text("\(numberText(kcal, digits: 1)) kcal").monospacedDigit().foregroundStyle(.secondary)
        }
    }
    }

    @ViewBuilder
    private var catalogPane: some View {
    TextField(store.tr("Buscar por nombre o marca"), text: $search, prompt: Text(store.tr("Buscar alimentos y recetas"))).controlSize(.large)
    if searching { ProgressView().controlSize(.small) }
    List {
        if search.isEmpty, !frequent.isEmpty {
            Section(store.tr("Frecuentes")) {
                ForEach(frequent, id: \.self) { item in
                    Button(item.text("item") + " · " + numberText(item.number("grams")) + " g") {
                        selectInitial(item, suggested: item.number("grams"))
                    }.buttonStyle(.plain)
                }
            }
        }
        Section(store.tr("Catálogo")) {
            ForEach(choices, id: \.self) { choice in
                Button {
                    selected = choice
                    amount = ""
                } label: {
                    HStack {
                        Image(systemName: choice["_recipe"]?.bool == true ? "book" : "carrot")
                        Text(choice.text("name"))
                        if !choice.text("brand").isEmpty { Text(choice.text("brand")).foregroundStyle(.secondary) }
                        Spacer()
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
    }
    .frame(minHeight: 270)
    }

    private func selectInitial(_ item: Record, suggested: Double?) {
        let recipe = item.text("recipe_id")
        let food = item.text("food_id")
        let id = recipe.isEmpty ? (food.isEmpty ? item.text("id") : food) : recipe
        let known = (recipes + foods).first { $0.text("id") == id }
        var selected = known ?? item
        selected["id"] = .string(id)
        if !recipe.isEmpty { selected["_recipe"] = .bool(true) }
        if selected.text("name").isEmpty { selected["name"] = item["item"] ?? .null }
        self.selected = selected
        amount = suggested.map { formText(amountFor($0, unit: unit)) } ?? ""
    }

    private func amountFor(_ grams: Double, unit: String) -> Double {
        switch unit {
        case "oz": return grams / Domain.gramsPerOunce
        case "ml": return grams / (density ?? 1)
        case "fl oz": return grams / ((density ?? 1) * Domain.mlPerFluidOunce)
        default: return grams
        }
    }

    private func changeUnit(_ next: String) {
        if let grams { amount = formText(amountFor(grams, unit: next)) }
        unit = next
    }

    private func metaFor(_ selection: Record) -> Record {
        if selection["_recipe"]?.bool == true {
            return recipeMeta.first { $0.text("recipe_id") == selection.text("id") } ?? [:]
        }
        if selection["name"] != nil && selection["item"] != nil { return [:] }
        return selection
    }

    private func save() {
        guard let grams, let selected, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let id = selected.text("id")
            guard UUID(uuidString: id) != nil else { throw NutriError("Elige un alimento o una receta.") }
            let patch: Record = ["grams": .number(grams), "meal_label_id": label.isEmpty ? .null : .string(label)]
            var payload = patch
            payload["day"] = .string(day)
            payload["id"] = row?["id"] ?? .string(UUID().uuidString.lowercased())
            payload["food_id"] = isRecipe ? .null : .string(id)
            payload["recipe_id"] = isRecipe ? .string(id) : .null
            if let row, (row.text("meal_label_id") == label) { payload["sort_order"] = row["sort_order"] }
            let meta = metaFor(selected)
            let nutrients: Record
            if meta.isEmpty, let row, let oldGrams = row.number("grams"), oldGrams == grams {
                nutrients = row.filter { Domain.macroKeys.contains($0.key) || ["micros", "micros_complete"].contains($0.key) }
            } else {
                nutrients = Domain.scaled(meta, grams: grams)
            }
            let created = row?["created_at"] ?? .string(Date.now.ISO8601Format())
            let preview = payload.merging(nutrients) { _, new in new }.merging([
                "item": .string(selected.text("name")), "brand": selected["brand"] ?? .null,
                "created_at": created, "meal": labels.first(where: { $0.text("id") == label })?["name"] ?? .null
            ]) { _, new in new }
            if let row {
                var update = patch
                if row.text("meal_label_id") != label { update["sort_order"] = .null }
                try store.editEntry(row.text("id"), patch: update, row: preview)
            } else {
                try store.addEntry(payload, row: preview)
            }
            close()
        } catch { store.report(error) }
    }
}

private struct MealLabelsView: View {
    @EnvironmentObject private var store: Store
    let close: () -> Void
    @State private var labels: [Record] = []
    @State private var name = ""
    @State private var editID: String?
    @State private var renaming = ""
    @State private var busy = false

    private let query = ["archived_at": "is.null", "order": "sort_order.asc,name.asc"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            EditorTitle(title: store.tr("Etiquetas de sección"), close: close)
            List {
                ForEach(Array(labels.enumerated()), id: \.element) { index, row in
                    HStack {
                        let id = row.text("id")
                        if editID == id {
                            TextField(store.tr("Nombre"), text: $renaming)
                            Button(store.tr("Guardar")) { run { try await rename(row) } }
                        } else {
                            Text(row.text("name"))
                            Spacer()
                            Button { editID = id; renaming = row.text("name") } label: { Image(systemName: "pencil") }
                                .accessibilityLabel(store.tr("Renombrar"))
                        }
                        Button { run { try await move(index, -1) } } label: { Image(systemName: "arrow.up") }
                            .disabled(index == 0).accessibilityLabel(store.tr("Mover arriba"))
                        Button { run { try await move(index, 1) } } label: { Image(systemName: "arrow.down") }
                            .disabled(index == labels.count - 1).accessibilityLabel(store.tr("Mover abajo"))
                        Button(role: .destructive) { run { try await archive(row) } } label: { Image(systemName: "archivebox") }
                            .accessibilityLabel(store.tr("Archivar"))
                    }.buttonStyle(.borderless)
                }
            }
            HStack {
                TextField(store.tr("Nueva etiqueta"), text: $name).onSubmit(add)
                Button(store.tr("Agregar"), action: add).buttonStyle(.borderedProminent).disabled(cleanText(name).isEmpty)
            }
        }
        .padding(20).frame(width: 475, height: 420)
        .disabled(busy)
        .task { do { try await reload() } catch { store.report(error) } }
    }

    private func reload() async throws { labels = try await store.read("meal_labels", query) }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action(); try await reload() } catch { store.report(error) }
        }
    }

    private func add() {
        run {
            let label = cleanText(name)
            guard !label.isEmpty, let owner = store.owner else { return }
            let all = try await store.read("meal_labels", ["owner": "eq." + owner])
            if let same = all.first(where: { $0.text("name") == label }) {
                guard let flag = same["archived_at"], flag != .null else { throw NutriError("Ya existe una etiqueta con ese nombre.") }
                _ = try await store.update("meal_labels", ["id": "eq." + same.text("id")], ["archived_at": .null])
            } else {
                _ = try await store.insert("meal_labels", ["name": .string(label), "sort_order": .number(Double(labels.count))])
            }
            name = ""
        }
    }

    private func rename(_ row: Record) async throws {
        let value = cleanText(renaming)
        guard !value.isEmpty else { throw NutriError("Escribe un nombre.") }
        _ = try await store.update("meal_labels", ["id": "eq." + row.text("id")], ["name": .string(value)])
        editID = nil
    }

    private func archive(_ row: Record) async throws {
        let filter = ["id": "eq." + row.text("id")]
        let timestamp = Date.now.ISO8601Format()
        _ = try await store.update("meal_labels", filter, ["archived_at": .string(timestamp)])
        labels.removeAll { $0.text("id") == row.text("id") }
        store.undo(store.tr("Etiqueta archivada")) {
            _ = try await store.update("meal_labels", filter.merging(["archived_at": "eq." + timestamp]) { _, new in new }, ["archived_at": .null])
            try await reload()
        }
    }

    private func move(_ index: Int, _ offset: Int) async throws {
        var ordered = labels
        guard ordered.indices.contains(index + offset) else { return }
        ordered.swapAt(index, index + offset)
        for (position, label) in ordered.enumerated() where label.number("sort_order") != Double(position) {
            _ = try await store.update("meal_labels", ["id": "eq." + label.text("id")], ["sort_order": .number(Double(position))])
        }
    }
}

private struct MealTemplatesView: View {
    @EnvironmentObject private var store: Store
    let day: String
    let entries: [Record]
    let close: () -> Void
    let reload: () async -> Void
    @State private var name = ""
    @State private var busy = false

    private var templates: [Record] { store.prefs.array("meal_templates").compactMap(\.object) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            EditorTitle(title: store.tr("Plantillas de comida"), close: close)
            List {
                ForEach(templates, id: \.self) { row in
                    HStack {
                        Text(row.text("name"))
                        Text("\(row.array("items").count)").foregroundStyle(.secondary)
                        Spacer()
                        Button(store.tr("Añadir")) { run { try await apply(row) } }
                        Button(role: .destructive) {
                            run { try await remove(row) }
                        } label: { Image(systemName: "trash") }.accessibilityLabel(store.tr("Borrar plantilla"))
                    }.buttonStyle(.borderless)
                }
            }
            HStack {
                TextField(store.tr("Nombre de la plantilla"), text: $name)
                Button(store.tr("Guardar día como plantilla")) { run(save) }
                    .buttonStyle(.borderedProminent).disabled(entries.isEmpty || cleanText(name).isEmpty)
            }
        }.padding(20).frame(width: 520, height: 420).disabled(busy)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { store.report(error) }
        }
    }

    private func write(_ values: [Record]) async throws {
        try await store.patchPrefs(["meal_templates": .array(values.map(JSONValue.object))])
    }

    private func save() async throws {
        let template: Record = ["id": .string(UUID().uuidString.lowercased()), "name": .string(cleanText(name)),
                                "items": .array(entries.map { .object(entryPayload($0)) })]
        try await write(templates + [template])
        name = ""
    }

    private func remove(_ row: Record) async throws {
        try await write(templates.filter { $0.text("id") != row.text("id") })
        store.undo(store.tr("Plantilla borrada")) {
            try await write(templates.filter { $0.text("id") != row.text("id") } + [row])
        }
    }

    private func apply(_ template: Record) async throws {
        async let foodRows = store.catalog()
        async let recipeRows = store.read("recipes", ["select": "id"])
        let (foods, recipes) = try await (foodRows, recipeRows)
        let foodIDs = Set(foods.map { $0.text("id") })
        let recipeIDs = Set(recipes.map { $0.text("id") })
        let items = template.array("items").compactMap(\.object)
        let valid = items.filter { foodIDs.contains($0.text("food_id")) || recipeIDs.contains($0.text("recipe_id")) }
        guard !valid.isEmpty else { throw NutriError("Los alimentos o recetas de la plantilla ya no existen.") }
        _ = try await store.insert("entries", valid.map { item in entryPayload(item).merging(["day": .string(day)]) { _, new in new } })
        if valid.count < items.count { store.toast("\(valid.count) añadidos · \(items.count - valid.count) omitidos") }
        await reload()
        close()
    }
}

private struct SummarySettingsView: View {
    @EnvironmentObject private var store: Store
    let close: () -> Void
    @State private var items: [String] = []
    @State private var showRanges = false
    @State private var synchronize = false
    @State private var mode = "meta"
    @State private var toAdd = "kcal"
    @State private var saving = false
    private let views = ["estado", "objetivos", "mini"]

    private var activeView: String { views.contains(store.prefs.text("today_view")) ? store.prefs.text("today_view") : "estado" }
    private var choices: [String] { (Domain.macroKeys + Domain.micros.map(\.key)).filter { !items.contains($0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            EditorTitle(title: store.tr("Configurar resumen"), close: close)
            Picker(store.tr("Indicador"), selection: $mode) {
                Text(store.tr("Valor y meta")).tag("meta")
                Text(store.tr("Diferencia")).tag("delta")
                Text(store.tr("Diferencia porcentual")).tag("pct")
            }
            Toggle(store.tr("Mostrar rangos"), isOn: $showRanges)
            Toggle(store.tr("Sincronizar vistas"), isOn: $synchronize)
            List {
                ForEach(Array(items.enumerated()), id: \.element) { index, key in
                    HStack {
                        Text(label(key))
                        Spacer()
                        Button { items.swapAt(index, index - 1) } label: { Image(systemName: "arrow.up") }
                            .disabled(index == 0).accessibilityLabel(store.tr("Mover arriba"))
                        Button { items.swapAt(index, index + 1) } label: { Image(systemName: "arrow.down") }
                            .disabled(index == items.count - 1).accessibilityLabel(store.tr("Mover abajo"))
                        Button(role: .destructive) { items.remove(at: index) } label: { Image(systemName: "minus.circle") }
                            .disabled(items.count == 1).accessibilityLabel(store.tr("Quitar"))
                    }.buttonStyle(.borderless)
                }
            }
            HStack {
                if !choices.isEmpty {
                    Picker(store.tr("Nutriente"), selection: $toAdd) {
                        ForEach(choices, id: \.self) { Text(label($0)).tag($0) }
                    }
                    Button(store.tr("Añadir")) {
                        if choices.contains(toAdd) { items.append(toAdd) }
                        toAdd = choices.first ?? ""
                    }
                }
                Spacer()
                Button(store.tr("Guardar"), action: save).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(20).frame(width: 520, height: 480)
        .task {
            let prefs = store.prefs.object("today_card")
            let config = prefs.object(activeView)
            items = config.array("items").compactMap(\.string)
            if items.isEmpty { items = Domain.macroKeys + ["sodio_mg", "potasio_mg"] }
            showRanges = config["showRanges"]?.bool ?? false
            synchronize = prefs["sync"]?.bool ?? false
            mode = config["mode"]?.string ?? (activeView == "estado" ? "meta" : "delta")
            toAdd = choices.first ?? ""
        }
    }

    private func label(_ key: String) -> String {
        store.tr(Domain.macroLabels[key] ?? Domain.micros.first(where: { $0.key == key })?.label ?? key)
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                var prefs = store.prefs.object("today_card")
                prefs["sync"] = .bool(synchronize)
                for view in synchronize ? views : [activeView] {
                    prefs[view] = .object(["mode": .string(mode), "items": .array(items.map(JSONValue.string)), "showRanges": .bool(showRanges)])
                }
                try await store.patchPrefs(["today_card": .object(prefs)])
                close()
            } catch { store.report(error) }
        }
    }
}
