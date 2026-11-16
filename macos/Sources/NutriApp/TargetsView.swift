import NutriCore
import SwiftUI

private let phaseGoals = [
    ("", "Sin tipo"), ("deficit", "Déficit"), ("volumen", "Volumen"),
    ("recomposicion", "Recomposición"), ("mantenimiento", "Mantenimiento")
]
private let weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
private let orderedWeek = [1, 2, 3, 4, 5, 6, 0]
private let ruleKinds = [
    ("ritmo_alto", "Ritmo alto"), ("estancamiento", "Estancamiento"),
    ("techo_peso", "Techo de peso"), ("ritmo_lento", "Ritmo lento")
]

struct TargetValues {
    var point: [String: String] = [:]
    var min: [String: String] = [:]
    var max: [String: String] = [:]

    init(_ row: Record = [:]) {
        point = row.object("micros").compactMapValues { $0.number.map(draftNumber) }
        for macro in nutritionMacros { point[macro.key] = row.number(macro.key).map(draftNumber) }
        for (key, value) in row.object("bounds") {
            min[key] = value.object?.number("min").map(draftNumber)
            max[key] = value.object?.number("max").map(draftNumber)
        }
    }

    func encoded() throws -> Record {
        var result: Record = [:]
        var micros: Record = [:]
        var bounds: Record = [:]
        let macroKeys = Set(nutritionMacros.map(\.key))
        let keys = Set(point.keys).union(min.keys).union(max.keys).union(macroKeys)
        for key in keys.sorted() {
            let label = nutritionMacros.first { $0.key == key }?.label ?? Domain.micros.first { $0.key == key }?.label ?? key
            let center = try featureNumber(point[key] ?? "", label: label)
            var lower = try featureNumber(min[key] ?? "", label: "\(label) · mínimo")
            let upper = try featureNumber(max[key] ?? "", label: "\(label) · máximo")
            if key == "sodio_mg", let floor = lower { lower = Swift.max(1500, floor) }
            if let lower, let upper, lower > upper { throw FeatureError("El mínimo supera el máximo · \(label).") }
            if macroKeys.contains(key) { result[key] = center.map(JSONValue.number) ?? .null }
            else { micros[key] = center.map(JSONValue.number) }
            var bound: Record = [:]
            bound["min"] = lower.map(JSONValue.number)
            bound["max"] = upper.map(JSONValue.number)
            if !bound.isEmpty { bounds[key] = .object(bound) }
        }
        result["micros"] = .object(micros)
        result["bounds"] = .object(bounds)
        return result
    }
}

private struct PhaseDraft: Identifiable {
    enum Kind { case new, current, scheduled, history, override }
    let id = UUID()
    let kind: Kind
    let original: String?
    let recordID: String
    var date: Date
    var label: String
    var description: String
    var goal: String
    var weekdays: [TargetValues]
    var rules: Record

    init(kind: Kind, date: String, rows: [Record] = []) {
        self.kind = kind
        self.date = isoDate(date) ?? Date()
        original = kind == .new ? nil : date
        let first = rows.first ?? [:]
        recordID = first.text("id")
        label = first.text("label")
        description = first.text("description")
        goal = first.text("goal")
        rules = rows.first(where: { !$0.object("rules").isEmpty })?.object("rules") ?? [:]
        weekdays = (0...6).map { dow in
            TargetValues((kind == .override ? rows.first : rows.first { $0.number("dow") == Double(dow) }) ?? [:])
        }
    }
}

struct TargetsView: View {
    @EnvironmentObject private var store: Store
    @State private var rows: [Record] = []
    @State private var day = Date()
    @State private var draft: PhaseDraft?
    @State private var deletePhase: String?
    @State private var showDelete = false
    @State private var loading = true
    @State private var errorText = ""
    @State private var proposal: PhaseProposal?
    @State private var checkingRules = false
    @State private var reviewChecked = false
    @State private var energy = ""
    @State private var wizard = false

    private var today: String { Day.key(Date()) }
    private var phaseRows: [Record] { rows.filter { $0.number("dow") != nil } }
    private var byStart: [String: [Record]] { Dictionary(grouping: phaseRows) { $0.text("valid_from") } }
    private var phases: [String] { byStart.keys.sorted(by: >) }
    private var active: String? { phases.first { $0 <= today } }
    private var overrides: [Record] { rows.filter { !$0.text("day").isEmpty }.sorted { $0.text("day") > $1.text("day") } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(store.tr("Objetivos")).font(.largeTitle.bold())
                    Spacer()
                    Button(store.tr("Nueva fase"), systemImage: "plus") {
                        draft = PhaseDraft(kind: .new, date: today)
                    }.buttonStyle(.borderedProminent)
                    Button(store.tr("Asistente de metas"), systemImage: "list.bullet.rectangle") {
                        wizard = true
                    }.disabled(loading || !errorText.isEmpty)
                    Button(store.tr("Fecha específica"), systemImage: "calendar.badge.plus") {
                        let date = Day.key(day)
                        draft = PhaseDraft(kind: .override, date: date, rows: overrides.filter { $0.text("day") == date })
                    }
                }
                if loading { ProgressView().controlSize(.small) }
                if !errorText.isEmpty {
                    HStack {
                        Text(errorText).foregroundStyle(.red)
                        Button(store.tr("Reintentar")) { Task { await reload() } }
                    }
                }
                resolution
                if let active, let phase = byStart[active] {
                    GroupBox(store.tr("Fase vigente")) {
                        VStack(alignment: .leading, spacing: 10) {
                            phaseRow(active, rows: phase, kind: .current)
                            if let rule = phase.first(where: { !$0.text("applied_rule").isEmpty })?.text("applied_rule") {
                                Text(rule).font(.caption).foregroundStyle(.secondary)
                            }
                            ruleStatus
                        }
                    }
                }
                phaseSection("Fases programadas", phases.filter { $0 > today }, kind: .scheduled)
                phaseSection("Fases previas", phases.filter { $0 < (active ?? today) }, kind: .history)
                GroupBox(store.tr("Fechas específicas")) {
                    VStack(alignment: .leading, spacing: 10) {
                        if overrides.isEmpty { Text(store.tr("Sin fechas específicas")).foregroundStyle(.secondary) }
                        ForEach(overrides.indices, id: \.self) { index in
                            let row = overrides[index]
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(row.text("label").isEmpty ? store.tr("Fecha específica") : row.text("label")).font(.headline)
                                    Text("\(row.text("day")) · \(numberText(row.number("kcal"))) kcal").foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(store.tr("Editar")) {
                                    draft = PhaseDraft(kind: .override, date: row.text("day"), rows: [row])
                                }
                                Button(store.tr("Eliminar"), systemImage: "trash", role: .destructive) {
                                    Task { await removeOverride(row) }
                                }.labelStyle(.iconOnly)
                            }
                        }
                    }
                }
            }.padding(24)
        }
        .task { await reload() }
        .sheet(item: $draft) { PhaseEditor(draft: $0, activeRows: active.flatMap { byStart[$0] } ?? [], onSave: save) }
        .sheet(isPresented: $wizard) { TargetWizard(rows: rows, onSave: saveWizard) }
        .confirmationDialog(store.tr("¿Eliminar toda la fase programada?"), isPresented: $showDelete) {
            Button(store.tr("Eliminar fase"), role: .destructive) { Task { await removePhase() } }
        } message: {
            Text(store.tr("Se eliminarán sus siete objetivos semanales."))
        }
    }

    private var resolution: some View {
        GroupBox(store.tr("Objetivo por fecha")) {
            VStack(alignment: .leading, spacing: 10) {
                DatePicker(store.tr("Fecha"), selection: $day, displayedComponents: .date)
                if let target = Domain.resolveTarget(rows, Day.key(day)) {
                    let name = target.text("label")
                    Text(target.text("day").isEmpty ? (name.isEmpty ? target.text("valid_from") : name) : store.tr("Fecha específica") + (name.isEmpty ? "" : " · " + name))
                        .font(.headline)
                    HStack(spacing: 22) {
                        ForEach(nutritionMacros, id: \.key) { field in
                            VStack(alignment: .leading) {
                                Text(store.tr(field.label)).font(.caption)
                                Text(renderTarget(target, key: field.key, unit: field.unit))
                            }
                        }
                    }
                    if target.object("rules").object("transition").text("kind") == "coupled_band" {
                        HStack {
                            TextField(store.tr("Consulta energía en la banda (kcal)"), text: $energy).textFieldStyle(.roundedBorder).frame(maxWidth: 275)
                            if let point = Double(energy.replacingOccurrences(of: ",", with: ".")),
                               let choice = Domain.coupledBand(target, energy: point) {
                                Text("\(numberText(choice.number("carbs_g"))) g \(store.tr("Carbohidratos")) · \(numberText(choice.number("fat_g"))) g \(store.tr("Grasa"))")
                            } else {
                                Text(store.tr("Banda acoplada · elige una energía para consultar")).foregroundStyle(.secondary)
                            }
                        }
                    }
                    let configured = Set(target.object("micros").keys).union(target.object("bounds").keys)
                    let visible = Domain.micros.filter { configured.contains($0.key) }
                    if !visible.isEmpty {
                        DisclosureGroup(store.tr("Micronutrientes")) {
                            ForEach(visible, id: \.key) { item in
                                LabeledContent(store.tr(item.label), value: renderTarget(target, key: item.key, unit: item.unit))
                            }
                        }
                    }
                } else {
                    Text(store.tr("Sin objetivo para esta fecha")).foregroundStyle(.secondary)
                }
            }.padding(5)
        }
    }

    private func renderTarget(_ row: Record, key: String, unit: String) -> String {
        let bounds = row.object("bounds").object(key)
        let floor = bounds.number("min").map { "≥ \(numberText(key == "sodio_mg" ? max(1500, $0) : $0))" }
        let ceiling = bounds.number("max").map { "≤ \(numberText($0))" }
        let range = [floor, ceiling].compactMap { $0 }.joined(separator: " · ")
        let point = nutritionValue(row, key).map { numberText($0) } ?? ""
        let display = [point, range].filter { !$0.isEmpty }.joined(separator: " · ")
        return display.isEmpty ? store.tr("Sin objetivo") : "\(display) \(unit)"
    }

    private func phaseSection(_ title: String, _ dates: [String], kind: PhaseDraft.Kind) -> some View {
        GroupBox(store.tr(title)) {
            VStack(alignment: .leading, spacing: 12) {
                if dates.isEmpty { Text(store.tr("Sin fases")).foregroundStyle(.secondary) }
                ForEach(dates, id: \.self) { date in
                    phaseRow(date, rows: byStart[date] ?? [], kind: kind)
                }
            }.padding(4)
        }
    }

    private func phaseRow(_ date: String, rows: [Record], kind: PhaseDraft.Kind) -> some View {
        let row = rows.first ?? [:]
        let goal = phaseGoals.first { $0.0 == row.text("goal") }?.1 ?? "Sin tipo"
        return DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                if !row.text("description").isEmpty { Text(row.text("description")).foregroundStyle(.secondary) }
                ForEach(orderedWeek, id: \.self) { dow in
                    if let day = rows.first(where: { $0.number("dow") == Double(dow) }) {
                        LabeledContent(store.tr(weekdays[dow])) {
                            Text(nutritionMacros.map { renderTarget(day, key: $0.key, unit: $0.unit) }.joined(separator: " · "))
                                .monospacedDigit()
                        }
                    }
                }
                HStack {
                    Button(store.tr(kind == .history ? "Editar tipo de fase" : "Editar fase")) {
                        draft = PhaseDraft(kind: kind, date: date, rows: rows)
                    }
                    if kind == .scheduled {
                        Button(store.tr("Eliminar fase"), role: .destructive) {
                            deletePhase = date
                            showDelete = true
                        }
                    }
                }
            }.padding(.top, 5)
        } label: {
            Text("\(row.text("label").isEmpty ? store.tr("Fase") : row.text("label")) · \(date) · \(store.tr(goal))")
                .fontWeight(.medium)
        }
    }

    private var ruleStatus: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Button(store.tr("Evaluar reglas"), systemImage: "arrow.trianglehead.clockwise") {
                    Task { await evaluate() }
                }.disabled(checkingRules)
                if checkingRules { ProgressView().controlSize(.small) }
            }
            if let proposal {
                Text(store.tr("Propuesta para revisar en el plan maestro")).font(.headline)
                Text(proposal.reason).foregroundStyle(.secondary)
                ForEach(orderedWeek, id: \.self) { dow in
                    if let adjusted = proposal.rows.first(where: { $0.number("dow") == Double(dow) }) {
                        LabeledContent(store.tr(weekdays[dow]), value: "\(numberText(adjusted.number("kcal"))) kcal · \(numberText(adjusted.number("carbs_g"))) g \(store.tr("Carbohidratos"))")
                    }
                }
            } else if reviewChecked {
                Text(store.tr("Sin propuesta con los datos y reglas actuales.")).foregroundStyle(.secondary)
            }
        }
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            rows = try await store.read("targets", ["order": "valid_from.desc.nullslast,dow.asc"])
            errorText = ""
            proposal = nil
            reviewChecked = false
        } catch {
            if !Task.isCancelled { errorText = error.localizedDescription; store.report(error) }
        }
    }

    private func save(_ input: PhaseDraft, newVersion: Bool) async throws {
        guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
        let key = Day.key(input.date)
        if input.kind == .override {
            var record = try input.weekdays[0].encoded()
            record["day"] = .string(key)
            record["label"] = optionalText(input.label)
            if input.recordID.isEmpty {
                record["owner"] = .string(owner)
                _ = try await store.insert("targets", record)
            } else {
                _ = try await store.update("targets", ["id": "eq.\(input.recordID)"], record)
            }
        } else if input.kind == .history, let original = input.original {
            _ = try await store.update("targets", phaseFilter(original), ["goal": optionalText(input.goal)])
        } else {
            if input.kind == .new || input.kind == .scheduled || newVersion {
                guard key >= today else { throw FeatureError("La fecha debe ser hoy o posterior.") }
                guard key == input.original && !newVersion || byStart[key] == nil else {
                    throw FeatureError("Ya existe una fase que aplica desde esa fecha.")
                }
            }
            let validFrom = input.kind == .current && !newVersion ? (input.original ?? key) : key
            let payload = try phasePayload(input, owner: owner, validFrom: validFrom)
            if let original = input.original, !newVersion,
               input.kind == .current, byStart[original]?.count != 7 {
                // Legacy current versions may omit weekdays. Completing them is the
                // existing correction behavior; the batch upsert is one statement.
                _ = try await store.upsert("targets", payload, onConflict: "owner,dow,valid_from")
            } else if let original = input.original, !newVersion {
                _ = try await store.rpc("replace_phase_atomic", [
                    "p_old_valid_from": .string(original), "p_new_valid_from": .string(validFrom),
                    "p_rows": .array(payload.map(JSONValue.object))
                ])
            } else {
                _ = try await store.insert("targets", payload)
            }
        }
        draft = nil
        await reload()
    }

    private func saveWizard(_ input: PhaseDraft, exceptions: [WizardOverride], confirmed: Bool) async throws {
        guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
        let start = Day.key(input.date)
        guard start >= today else { throw FeatureError("La fecha debe ser hoy o posterior.") }
        let days = exceptions.map { Day.key($0.date) }
        guard Set(days).count == days.count else { throw FeatureError("Hay fechas específicas repetidas.") }
        let live = try await store.read("targets")
        let phase = live.filter { $0.text("valid_from") == start && $0.number("dow") != nil }
        let existingDays = Dictionary(live.filter { days.contains($0.text("day")) }.map { ($0.text("day"), $0) }, uniquingKeysWith: { first, _ in first })
        let displayedIDs = Set(rows.filter { row in
            (row.text("valid_from") == start && row.number("dow") != nil) || days.contains(row.text("day"))
        }.map { $0.text("id") })
        let liveIDs = Set((phase + Array(existingDays.values)).map { $0.text("id") })
        guard liveIDs == displayedIDs else { throw FeatureError("Los objetivos cambiaron. Cierra el asistente, recarga y revisa las fechas.") }
        if !liveIDs.isEmpty && !confirmed { throw FeatureError("Confirma las fechas que se reemplazarán.") }

        var phaseRecords = try phasePayload(input, owner: owner, validFrom: start)
        for index in phaseRecords.indices {
            let previous = phase.first { $0.number("dow") == Double(index) }
            phaseRecords[index]["id"] = previous?["id"] ?? .string(UUID().uuidString.lowercased())
            phaseRecords[index]["day"] = .null
            phaseRecords[index]["applied_rule"] = previous?["applied_rule"] ?? .null
        }
        let overrideRecords = try exceptions.map { item -> Record in
            let key = Day.key(item.date)
            let previous = existingDays[key]
            var row = try item.values.encoded()
            row["id"] = previous?["id"] ?? .string(UUID().uuidString.lowercased())
            row["owner"] = .string(owner)
            row["day"] = .string(key)
            row["dow"] = .null
            row["valid_from"] = previous?["valid_from"] ?? .string(today)
            row["label"] = optionalText(item.label)
            row["description"] = previous?["description"] ?? .null
            row["goal"] = previous?["goal"] ?? .null
            row["rules"] = previous?["rules"] ?? .object([:])
            row["applied_rule"] = previous?["applied_rule"] ?? .null
            return row
        }
        // All wizard dates share a single statement. A collision on another unique key
        // rolls the entire submission back instead of leaving phase-only writes.
        _ = try await store.upsert("targets", phaseRecords + overrideRecords, onConflict: "id")
        wizard = false
        await reload()
    }

    private func phaseFilter(_ date: String) -> [String: String] { ["valid_from": "eq.\(date)", "dow": "not.is.null"] }

    private func removePhase() async {
        guard let date = deletePhase, date > today else { return }
        do {
            _ = try await store.delete("targets", phaseFilter(date))
            await reload()
        } catch { store.report(error) }
    }

    private func removeOverride(_ row: Record) async {
        do {
            _ = try await store.delete("targets", ["id": "eq.\(row.text("id"))"])
            rows.removeAll { $0.text("id") == row.text("id") }
            store.undo(store.tr("Fecha específica eliminada")) {
                _ = try await store.insert("targets", row)
                await reload()
            }
        } catch { store.report(error) }
    }

    private func evaluate() async {
        guard let active, let phase = byStart[active], let cfg = phase.first else { return }
        checkingRules = true
        defer { checkingRules = false }
        do {
            let rules = cfg.object("rules")
            let longest = rules.array("items").compactMap { $0.object }.map {
                min(365, max($0.number("days") ?? 0, ($0.number("weeks") ?? 0) * 7))
            }.max() ?? 0
            let lookback = max(21, Int(longest) + 7)
            let filter = dateFilter(Day.key(addingDays(-lookback, to: Date())), today)
            async let body = store.read("body_metrics", filter.merging(["select": "day,metrics"]) { _, new in new })
            async let totals = store.read("daily_totals", filter.merging(["select": "day,kcal"]) { _, new in new })
            proposal = try await phaseProposal(targets: rows, phase: phase, body: body, totals: totals, today: Date())
            reviewChecked = true
        } catch { store.report(error) }
    }
}

private struct PhaseEditor: View {
    @EnvironmentObject private var store: Store
    @State var draft: PhaseDraft
    let activeRows: [Record]
    let onSave: (PhaseDraft, Bool) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected = 1
    @State private var newVersion = false
    @State private var newVersionRules: Record = [:]
    @State private var error = ""
    @State private var busy = false

    private var title: String {
        switch draft.kind {
        case .new: "Nueva fase"
        case .override: "Fecha específica"
        case .history: "Tipo de fase previa"
        case .current, .scheduled: "Editar fase"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr(title)).font(.title2.bold())
            Form {
                if draft.kind != .history {
                    Section(store.tr("Datos generales")) {
                        if draft.kind != .current || newVersion {
                            DatePicker(store.tr(draft.kind == .override ? "Fecha" : "Vigente desde"), selection: $draft.date, displayedComponents: .date)
                        } else if let original = draft.original {
                            LabeledContent(store.tr("Vigente desde"), value: original)
                        }
                        if draft.kind == .current {
                            Picker(store.tr("Cambios"), selection: $newVersion) {
                                Text(store.tr("Corregir fase vigente")).tag(false)
                                Text(store.tr("Crear nueva versión")).tag(true)
                            }.onChange(of: newVersion) { _, value in
                                draft.date = value ? Date() : (isoDate(draft.original ?? "") ?? Date())
                            }
                            if !newVersion {
                                Text(store.tr("Corregir la fase actualiza los objetivos de sus fechas anteriores.")).foregroundStyle(.secondary)
                            }
                        }
                        TextField(store.tr(draft.kind == .override ? "Motivo" : "Nombre de fase"), text: $draft.label)
                        if draft.kind != .override { TextField(store.tr("Descripción"), text: $draft.description, axis: .vertical) }
                    }
                }
                if draft.kind != .override {
                    Picker(store.tr("Tipo de fase"), selection: $draft.goal) {
                        ForEach(phaseGoals, id: \.0) { value, label in Text(store.tr(label)).tag(value) }
                    }
                }
                if draft.kind != .history {
                    if draft.kind == .override {
                        TargetFields(values: $draft.weekdays[0])
                    } else {
                        Section(store.tr("Objetivos semanales")) {
                            Picker(store.tr("Día"), selection: $selected) {
                                ForEach(orderedWeek, id: \.self) { dow in Text(store.tr(weekdays[dow])).tag(dow) }
                            }
                            Menu(store.tr("Copiar objetivos")) {
                                Button(store.tr("Este día a toda la semana")) {
                                    draft.weekdays = Array(repeating: draft.weekdays[selected], count: 7)
                                }
                                if !activeRows.isEmpty {
                                    Button(store.tr("Semana de la fase vigente")) {
                                        draft.weekdays = (0...6).map { dow in
                                            TargetValues(activeRows.first { $0.number("dow") == Double(dow) } ?? [:])
                                        }
                                    }
                                }
                                ForEach(orderedWeek.filter { $0 != selected }, id: \.self) { dow in
                                    Button(store.tr(weekdays[dow])) { draft.weekdays[selected] = draft.weekdays[dow] }
                                }
                            }
                            TargetFields(values: $draft.weekdays[selected])
                        }
                        Section(store.tr("Reglas de ajuste")) {
                            PhaseRulesEditor(rules: newVersion ? $newVersionRules : $draft.rules)
                        }
                    }
                }
            }.formStyle(.grouped).disabled(busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            HStack {
                Button(store.tr("Cancelar")) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(store.tr("Guardar")) {
                    Task {
                        busy = true
                        error = ""
                        defer { busy = false }
                        do {
                            var outgoing = draft
                            if newVersion { outgoing.rules = newVersionRules }
                            try await onSave(outgoing, newVersion)
                            dismiss()
                        }
                        catch { self.error = error.localizedDescription }
                    }
                }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            }.disabled(busy)
        }.padding(18).frame(minWidth: 650, idealWidth: 760, minHeight: 580)
            .interactiveDismissDisabled(busy)
    }
}

private struct TargetFields: View {
    @EnvironmentObject private var store: Store
    @Binding var values: TargetValues
    @State private var expand = false
    @State private var filter = ""

    var body: some View {
        ForEach(nutritionMacros, id: \.key) { field in targetField(field.key, field.label, field.unit) }
        DisclosureGroup(store.tr("Micronutrientes y rangos"), isExpanded: $expand) {
            TextField(store.tr("Buscar nutriente"), text: $filter)
            let term = CSV.normalize(filter)
            ForEach(Domain.micros.filter { term.isEmpty || CSV.normalize($0.label).contains(term) || $0.key.contains(term) }, id: \.key) { field in
                targetField(field.key, field.label, field.unit)
            }
        }
    }

    private func targetField(_ key: String, _ label: String, _ unit: String) -> some View {
        LabeledContent("\(store.tr(label)) · \(unit)") {
            HStack {
                TextField(store.tr("Objetivo"), text: field($values.point, key)).accessibilityLabel("\(store.tr(label)) · \(store.tr("Objetivo"))")
                TextField(store.tr("Mín."), text: field($values.min, key)).accessibilityLabel("\(store.tr(label)) · \(store.tr("Mín."))")
                TextField(store.tr("Máx."), text: field($values.max, key)).accessibilityLabel("\(store.tr(label)) · \(store.tr("Máx."))")
            }.textFieldStyle(.roundedBorder)
        }
    }

    private func field(_ map: Binding<[String: String]>, _ key: String) -> Binding<String> {
        Binding(get: { map.wrappedValue[key] ?? "" }, set: { map.wrappedValue[key] = $0 })
    }
}

private struct PhaseRulesEditor: View {
    @EnvironmentObject private var store: Store
    @Binding var rules: Record
    @State private var show = false

    private var items: [JSONValue] { rules.array("items") }

    var body: some View {
        DisclosureGroup(store.tr("Configurar reglas"), isExpanded: $show) {
            Text(store.tr("La evaluación genera propuestas para revisar en el plan maestro.")).foregroundStyle(.secondary)
            TextField(store.tr("Pausa hasta (AAAA-MM-DD)"), text: textBinding("paused_until"))
            HStack {
                TextField(store.tr("Mínimo kcal"), text: numericBinding("kcal_min"))
                TextField(store.tr("Máximo kcal"), text: numericBinding("kcal_max"))
            }
            ForEach(items.indices, id: \.self) { index in
                if let row = items[index].object {
                    ruleEditor(row, index: index)
                }
            }
            Menu(store.tr("Añadir regla"), systemImage: "plus") {
                ForEach(ruleKinds, id: \.0) { kind, label in
                    Button(store.tr(label)) { add(kind) }
                }
            }
        }
    }

    private func ruleEditor(_ row: Record, index: Int) -> some View {
        let kind = row.text("kind")
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(store.tr(ruleKinds.first { $0.0 == kind }?.1 ?? kind)).font(.headline)
                Spacer()
                Button(store.tr("Quitar regla"), systemImage: "trash", role: .destructive) {
                    var list = items
                    let removed = list.remove(at: index)
                    rules["items"] = .array(list)
                    store.undo(store.tr("Regla quitada")) {
                        var list = items
                        list.insert(removed, at: min(index, list.count))
                        rules["items"] = .array(list)
                    }
                }.labelStyle(.iconOnly).buttonStyle(.borderless)
            }
            HStack {
                if kind == "estancamiento" {
                    TextField(store.tr("Días"), text: itemNumber(index, "days"))
                } else {
                    TextField(store.tr(kind == "techo_peso" ? "Umbral (kg)" : "Cambio (kg/sem)"), text: itemNumber(index, "value"))
                    if kind != "techo_peso" { TextField(store.tr("Semanas"), text: itemNumber(index, "weeks")) }
                }
                if kind != "techo_peso" {
                    TextField(store.tr("Ajuste carbs (g)"), text: itemNumber(index, "delta_carbs_g"))
                }
            }.textFieldStyle(.roundedBorder)
            if kind != "techo_peso" {
                Menu(store.tr("Días de ajuste")) {
                    ForEach(orderedWeek, id: \.self) { dow in
                        Toggle(store.tr(weekdays[dow]), isOn: Binding(
                            get: { scope(index).contains(dow) },
                            set: { enabled in
                                var chosen = scope(index)
                                if enabled { chosen.insert(dow) } else { chosen.remove(dow) }
                                writeItem(index, "scope", value: chosen.count == 7 ? .null : .array(chosen.sorted().map { .number(Double($0)) }))
                            }
                        ))
                    }
                }
            }
        }.padding(.vertical, 5)
    }

    private func add(_ kind: String) {
        var row: Record = ["id": .string(UUID().uuidString), "kind": .string(kind), "auto": .bool(false)]
        switch kind {
        case "estancamiento":
            row["days"] = .number(10)
            row["delta_carbs_g"] = .number(25)
        case "techo_peso":
            row["value"] = .number(90)
        default:
            row["value"] = .number(kind == "ritmo_alto" ? 0.3 : 0.2)
            row["weeks"] = .number(2)
            row["delta_carbs_g"] = .number(-25)
        }
        rules["items"] = .array(items + [.object(row)])
    }

    private func textBinding(_ key: String) -> Binding<String> {
        Binding(get: { rules.text(key) }, set: { rules[key] = $0.isEmpty ? nil : .string($0) })
    }

    private func numericBinding(_ key: String) -> Binding<String> {
        Binding(get: { rules[key]?.string ?? draftNumber(rules.number(key)) },
                set: { rules[key] = $0.isEmpty ? nil : .string($0) })
    }

    private func itemNumber(_ index: Int, _ key: String) -> Binding<String> {
        Binding(get: {
            guard items.indices.contains(index) else { return "" }
            let row = items[index].object ?? [:]
            return row[key]?.string ?? draftNumber(row.number(key))
        }, set: { writeItem(index, key, value: $0.isEmpty ? nil : .string($0)) })
    }

    private func writeItem(_ index: Int, _ key: String, value: JSONValue?) {
        var list = items
        guard list.indices.contains(index), var row = list[index].object else { return }
        row[key] = value
        list[index] = .object(row)
        rules["items"] = .array(list)
    }

    private func scope(_ index: Int) -> Set<Int> {
        guard items.indices.contains(index), let list = items[index].object?["scope"]?.array else { return Set(0...6) }
        return Set(list.compactMap { $0.number }.filter { $0 >= 0 && $0 <= 6 }.map(Int.init))
    }
}

private func phasePayload(_ input: PhaseDraft, owner: String, validFrom: String) throws -> [Record] {
    let rules = try normalizedRules(input.rules)
    return try input.weekdays.enumerated().map { dow, values in
        var row = try values.encoded()
        row["dow"] = .number(Double(dow))
        row["owner"] = .string(owner)
        row["valid_from"] = .string(validFrom)
        row["label"] = optionalText(input.label)
        row["description"] = optionalText(input.description)
        row["goal"] = optionalText(input.goal)
        row["rules"] = .object(rules)
        return row
    }
}

private struct WizardOverride: Identifiable {
    let id = UUID()
    var date = Date()
    var label = ""
    var values = TargetValues()
}

private struct TargetWizard: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let rows: [Record]
    let onSave: (PhaseDraft, [WizardOverride], Bool) async throws -> Void
    @State private var draft = PhaseDraft(kind: .new, date: Day.key(Date()))
    @State private var exceptions: [WizardOverride] = []
    @State private var step = 0
    @State private var assignments = Array(repeating: 0, count: 7)
    @State private var typeNames = ["Entreno", "Entreno largo", "Descanso"]
    @State private var values = Array(repeating: TargetValues(), count: 3)
    @State private var sharedMicros = TargetValues()
    @State private var error = ""
    @State private var busy = false
    @State private var confirm = false

    private var stageNames: [String] { ["Fase", "Patrón semanal", "Macros", "Agua y electrolitos", "Límites", "Reglas", "Fechas específicas", "Revisión"] }
    private var usedGroups: [Int] { (0..<3).filter { assignments.contains($0) } }
    private var conflicts: [String] {
        let start = Day.key(draft.date)
        let days = Set(exceptions.map { Day.key($0.date) })
        let active = rows.filter { $0.number("dow") != nil && $0.text("valid_from") == start }.map { $0.text("valid_from") }
        let specials = rows.map { $0.text("day") }.filter { days.contains($0) }
        return Array(Set(active + specials)).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.tr("Asistente de metas")).font(.title2.bold())
            ProgressView(value: Double(step + 1), total: Double(stageNames.count))
                .accessibilityLabel(store.tr(stageNames[step]))
            Form {
                Section(store.tr(stageNames[step])) { fields }
            }.formStyle(.grouped).disabled(busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            HStack {
                Button(store.tr("Cancelar")) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if step > 0 { Button(store.tr("Atrás")) { error = ""; step -= 1 } }
                if busy { ProgressView().controlSize(.small) }
                if step < stageNames.count - 1 {
                    Button(store.tr("Siguiente"), action: advance).buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                } else {
                    Button(store.tr("Guardar configuración")) {
                        if conflicts.isEmpty { perform() } else { confirm = true }
                    }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
            }.disabled(busy)
        }
        .padding(18).frame(width: 660, height: 580).interactiveDismissDisabled(busy)
        .confirmationDialog(store.tr("¿Sobrescribir lo existente?"), isPresented: $confirm) {
            Button(store.tr("Sobrescribir y guardar")) { perform(confirmed: true) }
        } message: { Text(conflicts.joined(separator: " · ")) }
    }

    @ViewBuilder private var fields: some View {
        switch step {
        case 0:
            Text(store.tr("Registra valores aprobados en el plan maestro.")).foregroundStyle(.secondary)
            Picker(store.tr("Tipo de fase"), selection: $draft.goal) {
                ForEach(phaseGoals, id: \.0) { value, label in Text(store.tr(label)).tag(value) }
            }
            DatePicker(store.tr("Vigente desde"), selection: $draft.date, displayedComponents: .date)
            TextField(store.tr("Nombre de fase"), text: $draft.label)
            TextField(store.tr("Descripción"), text: $draft.description, axis: .vertical)
            let starts = Set(rows.filter { $0.number("dow") != nil }.map { $0.text("valid_from") }).sorted(by: >)
            if !starts.isEmpty {
                DisclosureGroup(store.tr("Fases existentes")) {
                    ForEach(starts, id: \.self) { date in
                        Text(date + " · " + (rows.first { $0.text("valid_from") == date }?.text("label") ?? ""))
                    }
                }
            }
        case 1:
            ForEach(0..<3) { group in TextField(store.tr("Nombre del tipo de día"), text: $typeNames[group]) }
            ForEach(orderedWeek, id: \.self) { dow in
                Picker(store.tr(weekdays[dow]), selection: $assignments[dow]) {
                    ForEach(0..<3) { group in Text(store.tr(typeNames[group])).tag(group) }
                }
            }
        case 2:
            ForEach(usedGroups, id: \.self) { group in
                Text(store.tr(typeNames[group])).font(.headline)
                Text(orderedWeek.filter { assignments[$0] == group }.map { store.tr(weekdays[$0]) }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
                TargetFields(values: $values[group])
            }
        case 3:
            sharedField("agua_ml", "Agua (ml)")
            sharedField("potasio_mg", "Potasio (mg)")
            sharedField("magnesio_mg", "Magnesio (mg)")
            Button(store.tr("Rellenar valores de referencia")) {
                sharedMicros.point["agua_ml"] = draft.goal == "deficit" ? "3500" : draft.goal == "volumen" ? "3200" : "3000"
                sharedMicros.point["potasio_mg"] = draft.goal == "deficit" ? "3200" : "3000"
                sharedMicros.point["magnesio_mg"] = "350"
            }
            Text("\(store.tr("Piso de sodio")) · \(numberText(Domain.sodiumFloor)) mg").foregroundStyle(.secondary)
        case 4:
            sharedField("grasa_sat_g", "Grasa saturada (g)")
            sharedField("azucar_anadido_g", "Azúcar añadido (g)")
            sharedField("alcohol_g", "Alcohol (g)")
        case 5:
            PhaseRulesEditor(rules: $draft.rules)
        case 6:
            ForEach($exceptions) { $exception in
                DatePicker(store.tr("Fecha"), selection: $exception.date, displayedComponents: .date)
                TextField(store.tr("Motivo"), text: $exception.label)
                TargetFields(values: $exception.values)
                Button(store.tr("Quitar fecha"), role: .destructive) {
                    guard let index = exceptions.firstIndex(where: { $0.id == exception.id }) else { return }
                    let removed = exceptions.remove(at: index)
                    store.undo(store.tr("Fecha quitada")) {
                        exceptions.insert(removed, at: min(index, exceptions.count))
                    }
                }
            }
            Button(store.tr("Añadir fecha especial"), systemImage: "plus") { exceptions.append(WizardOverride()) }
        default:
            LabeledContent(store.tr("Nombre de fase"), value: cleanText(draft.label).isEmpty ? store.tr("Sin nombre") : draft.label)
            LabeledContent(store.tr("Vigente desde"), value: Day.key(draft.date))
            ForEach(usedGroups, id: \.self) { group in
                let days = orderedWeek.filter { assignments[$0] == group }.map { store.tr(weekdays[$0]) }.joined(separator: " · ")
                let macros = nutritionMacros.map { (values[group].point[$0.key] ?? "—") + " " + $0.unit }.joined(separator: " · ")
                LabeledContent(store.tr(typeNames[group]) + " · " + days, value: macros)
            }
            ForEach(exceptions) { item in LabeledContent(Day.key(item.date), value: item.label) }
            if !conflicts.isEmpty { Text(store.tr("Fechas que se reemplazarán") + " · " + conflicts.joined(separator: ", ")).foregroundStyle(.orange) }
        }
    }

    private func sharedField(_ key: String, _ title: String) -> some View {
        TextField(store.tr(title), text: Binding(
            get: { sharedMicros.point[key] ?? "" },
            set: { sharedMicros.point[key] = $0 }
        ))
    }

    private func advance() {
        error = ""
        do {
            if step == 0, Day.key(draft.date) < Day.key(Date()) { throw FeatureError("La fecha debe ser hoy o posterior.") }
            if step == 2 {
                for group in usedGroups {
                    let row = try values[group].encoded()
                    guard let kcal = row.number("kcal"), kcal > 0 else { throw FeatureError("Cada tipo de día necesita kcal mayores a 0.") }
                }
            }
            if step == 3 || step == 4 { _ = try sharedMicros.encoded() }
            if step == 5 { _ = try normalizedRules(draft.rules) }
            if step == 6 {
                let dates = exceptions.map { Day.key($0.date) }
                guard Set(dates).count == dates.count else { throw FeatureError("Hay fechas específicas repetidas.") }
                for exception in exceptions { _ = try exception.values.encoded() }
            }
            step += 1
        } catch { self.error = error.localizedDescription }
    }

    private func perform(confirmed: Bool = false) {
        busy = true
        error = ""
        Task {
            defer { busy = false }
            do {
                var phase = draft
                phase.weekdays = assignments.map { group in
                    var day = values[group]
                    day.point.merge(sharedMicros.point.filter { !cleanText($0.value).isEmpty }) { _, shared in shared }
                    return day
                }
                try await onSave(phase, exceptions, confirmed)
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

private func normalizedRules(_ raw: Record) throws -> Record {
    var rules = raw
    let paused = cleanText(rules.text("paused_until"))
    if !paused.isEmpty && isoDate(paused) == nil { throw FeatureError("Fecha de pausa inválida.") }
    rules["paused_until"] = paused.isEmpty ? nil : .string(paused)
    for key in ["kcal_min", "kcal_max"] {
        let number = try featureNumber(rules[key]?.string ?? draftNumber(rules.number(key)), label: key)
        rules[key] = number.map(JSONValue.number)
    }
    if let lower = rules.number("kcal_min"), let upper = rules.number("kcal_max"), lower > upper {
        throw FeatureError("El mínimo de energía supera el máximo.")
    }
    let items = try rules.array("items").map { value -> JSONValue in
        guard var row = value.object else { return value }
        let kind = row.text("kind")
        guard ruleKinds.contains(where: { $0.0 == kind }) else { return value }
        let entries = kind == "estancamiento" ? ["days"] : kind == "techo_peso" ? ["value"] : ["value", "weeks"]
        for key in entries + (kind == "techo_peso" ? [] : ["delta_carbs_g"]) {
            let raw = row[key]?.string ?? draftNumber(row.number(key))
            let isLength = ["days", "weeks"].contains(key)
            let minimum = key == "delta_carbs_g" ? -Double.greatestFiniteMagnitude : isLength ? 1 : 0
            let number = try featureNumber(raw, label: key, minimum: minimum)
            if key != "delta_carbs_g", number == nil { throw FeatureError("Falta un valor en la regla · \(kind)") }
            if isLength, let number, number != number.rounded() || number > (key == "weeks" ? 52 : 365) {
                throw FeatureError("Ventana inválida · \(kind)")
            }
            row[key] = number.map(JSONValue.number)
        }
        return .object(row)
    }
    rules["items"] = .array(items)
    return rules
}

struct PhaseProposal {
    let reason: String
    let rows: [Record]
}

func phaseProposal(targets: [Record], phase: [Record], body: [Record], totals: [Record], today: Date) -> PhaseProposal? {
    guard let first = phase.first, let from = isoDate(first.text("valid_from")) else { return nil }
    let todayKey = Day.key(today)
    let config = first.object("rules")
    guard config.text("paused_until") < todayKey else { return nil }
    let transition = config.object("transition").text("kind") == "coupled_band"
    let weights = Dictionary(body.compactMap { row in row.object("metrics").number("peso_kg").map { (row.text("day"), $0) } }, uniquingKeysWith: { first, _ in first })
    let energy = Dictionary(totals.compactMap { row in row.number("kcal").map { (row.text("day"), $0) } }, uniquingKeysWith: { first, _ in first })

    func dateKey(_ daysAgo: Int) -> String { Day.key(addingDays(-daysAgo, to: today)) }

    func averageWeight(_ offset: Int) -> Double? {
        let values = (offset..<(offset + 7)).compactMap { weights[dateKey($0)] }
        return values.count >= 5 ? values.reduce(0, +) / Double(values.count) : nil
    }

    func cooldown(_ id: String, window: Int) -> Bool {
        targets.contains {
            $0.number("dow") != nil && $0.text("valid_from") > dateKey(window) &&
            $0.text("applied_rule").hasPrefix(id + " ")
        }
    }

    func adhered(_ window: Int) -> Bool {
        var actual: [Double] = []
        var refs: [Double] = []
        for index in 0..<window {
            let day = dateKey(index)
            guard let value = energy[day], value > 0, let target = Domain.resolveTarget(targets, day) else { continue }
            let band = target.object("bounds").object("kcal")
            if let lower = band.number("min"), let upper = band.number("max"), lower <= upper {
                refs.append(max(lower, min(upper, value)))
            } else if let reference = target.number("kcal") {
                refs.append(reference)
            } else { continue }
            actual.append(value)
        }
        let sum = refs.reduce(0, +)
        return actual.count >= Int((Double(window) * 5 / 7).rounded()) && sum > 0 &&
            abs(actual.reduce(0, +) - sum) / sum <= 0.07
    }

    func proposal(_ reason: String, delta: Double? = nil, maintenance: Double? = nil, scope: [JSONValue]? = nil) -> PhaseProposal? {
        var changed = false
        let tomorrow = Day.key(addingDays(1, to: today))
        let rows = phase.map { source -> Record in
            var row = source
            row["valid_from"] = .string(tomorrow)
            row["id"] = nil
            row["created_at"] = nil
            row["applied_rule"] = nil
            if let maintenance {
                let old = row.number("kcal")
                changed = changed || old != maintenance
                row["kcal"] = .number(maintenance)
                row["goal"] = .string("mantenimiento")
                if let carbs = row.number("carbs_g"), let old {
                    row["carbs_g"] = .number(((carbs + (maintenance - old) / 4) * 100).rounded() / 100)
                }
            } else if let delta, let kcal = row.number("kcal"), let carbs = row.number("carbs_g"),
                      scope == nil || scope?.compactMap(\.number).contains(row.number("dow") ?? -1) == true {
                var next = ((kcal + 4 * delta) * 10).rounded() / 10
                if let min = config.number("kcal_min") { next = max(next, min) }
                if let max = config.number("kcal_max") { next = Swift.min(next, max) }
                changed = changed || next != kcal
                row["kcal"] = .number(next)
                row["carbs_g"] = .number(((carbs + (next - kcal) / 4) * 100).rounded() / 100)
            }
            return row
        }
        return changed ? PhaseProposal(reason: reason, rows: rows) : nil
    }

    guard let current = averageWeight(0), current > 0 else { return nil }
    if first.text("goal") == "deficit" {
        let weeks = transition && todayKey <= Day.key(addingDays(13, to: from)) ? 1 : 2
        let window = weeks * 7
        if first.text("valid_from") <= dateKey(transition ? window - 1 : window),
           !cooldown("proteccion-ritmo", window: window), adhered(window),
           let past = averageWeight(window) {
            let percent = (current - past) / Double(weeks) / current * 100
            if percent <= -0.5 {
                if transition {
                    return PhaseProposal(reason: "\(numberText(percent)) %/sem · Revisar la banda y la ingesta en el plan maestro.", rows: [])
                }
                if let result = proposal("\(numberText(percent)) %/sem · +25 g de carbohidratos", delta: 25) { return result }
            }
        }
    }

    for item in config.array("items").compactMap(\.object) {
        let kind = item.text("kind")
        guard ruleKinds.contains(where: { $0.0 == kind }) else { continue }
        if transition && ["estancamiento", "ritmo_lento"].contains(kind) { continue }
        let days = item.number("days") ?? 0
        let weeks = item.number("weeks") ?? 0
        let length = kind == "techo_peso" ? 14 : kind == "estancamiento" ? days : weeks * 7
        guard length >= 1, length <= 365, length == length.rounded() else { continue }
        let window = Int(length)
        guard first.text("valid_from") <= dateKey(window), !cooldown(item["id"]?.string ?? draftNumber(item.number("id")), window: window),
              let past = averageWeight(window) else { continue }
        let threshold = item.number("value")
        if kind == "techo_peso" {
            guard let threshold else { continue }
            let consumed = (0..<window).compactMap { energy[dateKey($0)] }.filter { $0 > 0 }
            guard current >= threshold, !consumed.isEmpty else { continue }
            let maintenance = ((consumed.reduce(0, +) / Double(consumed.count) - (current - past) / 2 * 1100) / 10).rounded() * 10
            if let result = proposal("Techo de peso alcanzado · \(numberText(maintenance)) kcal de referencia", maintenance: maintenance) { return result }
            continue
        }
        guard let delta = item.number("delta_carbs_g"), adhered(window) else { continue }
        let reason: String
        if kind == "estancamiento" {
            guard current <= past + 0.1 else { continue }
            reason = "Estancamiento · \(window) días"
        } else {
            guard let threshold else { continue }
            let rate = (current - past) / weeks
            guard (kind == "ritmo_alto" && rate > threshold) || (kind == "ritmo_lento" && -rate < threshold) else { continue }
            reason = "\(numberText(rate)) kg/sem · \(Int(weeks)) semanas"
        }
        let text = "\(reason) · \(delta > 0 ? "+" : "")\(numberText(delta)) g de carbohidratos"
        if let result = proposal(text, delta: delta, scope: item["scope"]?.array) { return result }
    }
    return nil
}
