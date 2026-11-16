import NutriCore
import Foundation
import SwiftUI

private let phaseGoals = [
    ("", "Sin tipo"), ("deficit", "Déficit"), ("volumen", "Volumen"),
    ("recomposicion", "Recomposición"), ("mantenimiento", "Mantenimiento")
]
private let orderedWeek = [1, 2, 3, 4, 5, 6, 0]
private let ruleKinds = [
    ("ritmo_alto", "Ritmo alto"), ("estancamiento", "Estancamiento"),
    ("techo_peso", "Techo de peso"), ("ritmo_lento", "Ritmo lento")
]

struct TargetValues: Equatable {
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
        func metadata(_ key: String) -> String { rows.first { !$0.text(key).isEmpty }?.text(key) ?? "" }
        label = metadata("label")
        description = metadata("description")
        goal = metadata("goal")
        rules = rows.first(where: { !$0.object("rules").isEmpty })?.object("rules") ?? [:]
        weekdays = (0...6).map { dow in
            TargetValues((kind == .override ? rows.first : rows.first { $0.number("dow") == Double(dow) }) ?? [:])
        }
    }
}

struct TargetsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.nutriWindowWidth) private var windowWidth
    @State private var rows: [Record] = []
    @State private var draft: PhaseDraft?
    @State private var inlinePhase: PhaseDraft?
    @State private var inlineOverride: PhaseDraft?
    @State private var previewPhase: String?
    @State private var previewOverride: Record?
    @State private var rulesDraft: PhaseDraft?
    @State private var historyOpen = false
    @State private var historyDate: String?
    @State private var deletePhase: String?
    @State private var decision: PhaseDraft?
    #if DEBUG
    @State private var snapshotWizard = false
    #endif
    @State private var loading = true
    @State private var errorText = ""


    private var today: String { Day.key(Date()) }
    private var phaseRows: [Record] { rows.filter { $0.number("dow") != nil } }
    private var byStart: [String: [Record]] { Dictionary(grouping: phaseRows) { $0.text("valid_from") } }
    private var phases: [String] { byStart.keys.sorted(by: >) }
    private var active: String? { phases.first { $0 <= today } }
    private var overrides: [Record] { rows.filter { !$0.text("day").isEmpty }.sorted { $0.text("day") < $1.text("day") } }
    private var historical: [String] { phases.filter { $0 < (active ?? today) } }

    var body: some View {
        Group {
            if loading && rows.isEmpty {
                VStack(spacing: 12) {
                    ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 16).fill(palette.surface).frame(height: 96) }
                    Spacer(minLength: 0)
                }.padding(16).accessibilityLabel(store.tr("Cargando…"))
            } else {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(store.tr("Objetivos")).font(.nutriDisplay(20))
                if !errorText.isEmpty {
                    HStack {
                        Text(errorText).foregroundStyle(palette.danger)
                        Button(store.tr("Reintentar")) { Task { await reload() } }
                            .buttonStyle(NutriButtonStyle(.quiet))
                    }
                }
                if windowWidth >= 1024 {
                    GeometryReader { proxy in
                        HStack(alignment: .top, spacing: 24) {
                            phaseColumn.frame(width: (proxy.size.width - 24) * 7 / 12)
                            overrideColumn.frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .background {
                            GeometryReader { content in
                                Color.clear.onChange(of: content.size.height, initial: true) { _, value in contentHeight = value }
                            }
                        }
                    }.frame(height: contentHeight)
                } else {
                    phaseColumn
                    overrideColumn
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
            }
        }
        .font(.nutriSans(14))
        .foregroundStyle(palette.text)
        .task {
            await reload()
            #if DEBUG
            if let active, let entries = byStart[active] {
                if store.snapshotScenario == "targets-editor" {
                    editPhase(.current, date: active, rows: entries)
                } else if store.snapshotScenario == "targets-rules" {
                    rulesDraft = PhaseDraft(kind: .current, date: active, rows: entries)
                }
            }
            snapshotWizard = store.snapshotScenario == "targets-wizard"
            #endif
        }
        .onReceive(NotificationCenter.default.publisher(for: .nutriTargetsChanged)) { _ in Task { await reload() } }
        .preference(key: NutriPresentedModalKey.self, value: presentedModal)
        .preference(key: NutriModalVisibleKey.self, value: presentedModal != nil)
        .onExitCommand {
            if decision != nil { decision = nil }
            else if rulesDraft != nil { rulesDraft = nil }
            else if deletePhase != nil { deletePhase = nil }
            else if draft != nil { draft = nil }
            else if previewPhase != nil { previewPhase = nil }
            else if previewOverride != nil { previewOverride = nil }
            else if historyOpen { historyOpen = false; historyDate = nil }
            else if inlinePhase != nil { inlinePhase = nil }
            else if inlineOverride != nil { inlineOverride = nil }
        }
    }

    private var presentedModal: NutriPresentedModal? {
        if let date = deletePhase {
            return targetModal("targets-delete", close: { deletePhase = nil }) {
                TargetConfirmBox(
                    title: store.tr("¿Borrar \"%n\"?").replacingOccurrences(of: "%n", with: phaseName(byStart[date] ?? [])),
                    detail: store.tr("Se eliminarán sus 7 objetivos diarios. Esta acción no se puede deshacer."),
                    actionLabel: store.tr("Borrar fase"), destructive: true, close: { deletePhase = nil }
                ) {
                    Task { await removePhase() }
                }
            }
        }
        if let input = decision {
            return targetModal("targets-decision", close: { decision = nil }) {
                TargetDecisionSheet(input: input, close: { decision = nil }) { outgoing, newVersion in
                    try await save(outgoing, newVersion: newVersion)
                    decision = nil
                    inlinePhase = nil
                }
            }
        }
        if let input = rulesDraft {
            return targetModal("targets-rules", close: { rulesDraft = nil }) {
                TargetRulesSheet(input: input, close: { rulesDraft = nil }) { rules in
                    guard let original = input.original else { return }
                    _ = try await store.update("targets", phaseFilter(original), ["rules": .object(rules)])
                    rulesDraft = nil
                    await reload()
                }
            }
        }
        if let input = draft {
            return targetModal("targets-editor", close: { draft = nil }) {
                phaseEditor(input) { draft = nil }
            }
        }
        if let date = previewPhase, let phase = byStart[date] {
            return targetModal("targets-phase", close: { previewPhase = nil }) {
                phaseCard(date, rows: phase, kind: .scheduled)
            }
        }
        if let row = previewOverride {
            return targetModal("targets-override", close: { previewOverride = nil }) { overridePreview(row) }
        }
        if historyOpen {
            return targetModal("targets-history", close: { historyOpen = false; historyDate = nil }) { historyContent }
        }
        #if DEBUG
        if snapshotWizard {
            return NutriPresentedModal("targets-wizard", close: { snapshotWizard = false }) {
                TargetsWizardFromMenu(close: { snapshotWizard = false })
            }
        }
        #endif
        return nil
    }

    private func targetModal<Content: View>(_ id: String, close: @escaping () -> Void, @ViewBuilder content: () -> Content) -> NutriPresentedModal {
        NutriPresentedModal(id, close: close, scrimOpacity: 0.72) {
            TargetSheetContent(close: close, content: content())
        }
    }

    @State private var contentHeight: CGFloat = 600

    private var phaseColumn: some View {
        VStack(alignment: .leading, spacing: 24) {
            if let active, let phase = byStart[active] {
                if let input = inlinePhase, input.kind == .current {
                    phaseEditor(input) { inlinePhase = nil }
                } else {
                    phaseCard(active, rows: phase, kind: .current)
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    TargetKicker(kind: .current)
                    Text(store.tr("Sin fase vigente. Programa una fase para empezar.")).foregroundStyle(palette.text2)
                    Button { openNewPhase() } label: { Text(store.tr("Crear fase")).frame(maxWidth: .infinity) }
                        .buttonStyle(NutriButtonStyle(.primary))
                }.padding(16).nutriCard()
            }
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(store.tr("Fases programadas")).font(.nutriSans(14, weight: .medium))
                    Spacer()
                    accentAction("+ " + store.tr("Programar"), action: openNewPhase)
                }
                let upcoming = phases.filter { $0 > today }.sorted()
                if upcoming.isEmpty {
                    Text(store.tr("Sin fases programadas")).font(.nutriSans(13)).foregroundStyle(palette.text2)
                }
                VStack(spacing: 8) {
                    ForEach(upcoming, id: \.self) { date in
                        let entries = byStart[date] ?? []
                        if let input = inlinePhase, input.kind == .scheduled, input.original == date {
                            phaseEditor(input) { inlinePhase = nil }
                        } else {
                            let days = elapsed(today, date)
                            compactPhase(date, rows: entries, detail: relative("en %n %d", days), kind: .scheduled) {
                                if windowWidth >= 1024 { editPhase(.scheduled, date: date, rows: entries) }
                                else { previewPhase = date }
                            }
                        }
                    }
                }
                if !historical.isEmpty {
                    Button { historyOpen = true } label: {
                        HStack(spacing: 8) {
                            NutriIcon("history", size: 15)
                            Text("\(store.tr("Fases previas")) (\(historical.count))")
                        }.font(.nutriSans(13)).foregroundStyle(palette.text2)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border) }
                    }.buttonStyle(.plain)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var overrideColumn: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(store.tr("Fechas específicas")).font(.nutriSans(14, weight: .medium))
                Spacer()
                accentAction("+ " + store.tr("Añadir")) { editOverride(nil) }
            }
            if let input = inlineOverride, input.recordID.isEmpty {
                phaseEditor(input) { inlineOverride = nil }
            }
            if overrides.isEmpty {
                Text(store.tr("Sin fechas específicas aún")).font(.nutriSans(13)).foregroundStyle(palette.text2)
            }
            VStack(spacing: 8) {
                ForEach(overrides, id: \.self) { row in
                    if let input = inlineOverride, input.recordID == row.text("id") {
                        phaseEditor(input) { inlineOverride = nil }
                    } else {
                        overrideRow(row)
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func phaseEditor(_ input: PhaseDraft, close: @escaping () -> Void) -> some View {
        PhaseEditor(draft: input, activeRows: active.flatMap { byStart[$0] } ?? [], phaseRows: phaseRows,
                    onClose: close, onDecision: { decision = $0 }) { draft, version in
            try await save(draft, newVersion: version)
            previewPhase = nil
            previewOverride = nil
        }.id(input.id)
    }

    private func openNewPhase() { draft = PhaseDraft(kind: .new, date: Day.key(addingDays(1, to: Date()))) }

    private func editPhase(_ kind: PhaseDraft.Kind, date: String, rows: [Record]) {
        let input = PhaseDraft(kind: kind, date: date, rows: rows)
        if kind == .current || windowWidth >= 1024 { inlinePhase = input }
        else { draft = input }
    }

    private func editOverride(_ row: Record?) {
        let input = PhaseDraft(kind: .override, date: row?.text("day") ?? today, rows: row.map { [$0] } ?? [])
        if windowWidth >= 1024 { inlineOverride = input }
        else { draft = input }
    }

    private func phaseName(_ rows: [Record]) -> String {
        rows.first { !$0.text("label").isEmpty }?.text("label") ?? store.tr("Sin nombre")
    }

    private func phaseGoal(_ rows: [Record]) -> String {
        rows.first { !$0.text("goal").isEmpty }?.text("goal") ?? ""
    }

    private func phaseCard(_ date: String, rows: [Record], kind: PhaseDraft.Kind) -> some View {
        let week = PhaseDraft(kind: kind, date: date, rows: rows).weekdays
        let groups = weekGroups(week)
        let rule = rows.first { !$0.text("applied_rule").isEmpty }?.text("applied_rule")
        let config = rows.map { $0.object("rules") }.first {
            !$0.array("items").isEmpty || !$0.text("paused_until").isEmpty || $0.number("kcal_min") != nil || $0.number("kcal_max") != nil
        } ?? [:]
        let description = rows.first { !$0.text("description").isEmpty }?.text("description") ?? ""
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                TargetKicker(kind: kind)
                Spacer()
                if kind == .current {
                    accentAction(store.tr("Editar reglas"), size: 12.5) { rulesDraft = PhaseDraft(kind: .current, date: date, rows: rows) }
                }
                if kind == .current || kind == .scheduled { editPill { editPhase(kind, date: date, rows: rows) } }
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(phaseName(rows)).font(.nutriDisplay(19))
                    if !phaseGoal(rows).isEmpty { TargetChip(text: goalLabel(phaseGoal(rows))) }
                }
                if !description.isEmpty { Text(description).font(.nutriSans(12.5)).foregroundStyle(palette.text2) }
            }
            phaseMeta(date, kind: kind)
            if rule != nil || !config.isEmpty {
                Divider().overlay(palette.border)
                if let rule {
                    HStack { TargetChip(text: store.tr("auto")); Text(rule).font(.nutriSans(12)).foregroundStyle(palette.text2) }
                }
                ForEach(Array(ruleSummary(config).enumerated()), id: \.offset) { _, summary in
                    Text("• " + summary).font(.nutriSans(12)).foregroundStyle(palette.text2)
                }
            }
            Divider().overlay(palette.border)
            HStack {
                Text(store.tr("Semana de la fase")).font(.nutriSans(12, weight: .medium)).foregroundStyle(palette.text2)
                Spacer()
                Text("\(groups.count) \(store.tr(groups.count == 1 ? "tipo de día" : "tipos de día"))")
                    .font(.nutriSans(11)).foregroundStyle(palette.text3)
            }
            VStack(spacing: 8) {
                ForEach(groups, id: \.self) { group in
                    TargetDayBlock(values: week[group[0]], dows: group)
                }
            }
        }.padding(16).nutriCard()
    }

    private func phaseMeta(_ date: String, kind: PhaseDraft.Kind) -> some View {
        let next = nextStart(date)
        let count = next.map { elapsed(date, $0) }
        let index = elapsed(date, today) + 1
        let progress = kind == .history ? 1 : count.map { min(1, max(0, Double(index) / Double(max(1, $0)))) } ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(dateSpan(date))
                Spacer()
                if kind == .current {
                    Text(store.tr("día %n").replacingOccurrences(of: "%n", with: String(index)) + (count.map { " / \($0)" } ?? ""))
                } else if kind == .scheduled {
                    Text(relative("inicia en %n %d", elapsed(today, date)))
                } else if let count {
                    Text(relative("duró %n %d", count))
                }
            }.font(.nutriMono(11)).foregroundStyle(palette.text3)
            GeometryReader { proxy in
                Capsule().fill(palette.surface2)
                    .overlay(alignment: .leading) {
                        Capsule().fill(kind == .history ? palette.text3 : palette.accent)
                            .frame(width: proxy.size.width * progress)
                    }
            }.frame(height: 5)
        }
    }

    private func compactPhase(_ date: String, rows: [Record], detail: String, kind: PhaseDraft.Kind, open: @escaping () -> Void) -> some View {
        TargetListRow(open: open, delete: kind == .scheduled ? { deletePhase = date } : nil,
                      deleteLabel: store.tr("Borrar fase"), vertical: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(phaseName(rows)).font(.nutriSans(14, weight: .medium))
                    if kind == .scheduled && !phaseGoal(rows).isEmpty { TargetChip(text: goalLabel(phaseGoal(rows))) }
                }
                Text(dateSpan(date) + " · " + detail).font(.nutriMono(11.5)).foregroundStyle(palette.text3)
            }
        }
    }

    private func overrideRow(_ row: Record) -> some View {
        let base = Domain.resolveTarget(phaseRows, row.text("day"))
        let delta = row.number("kcal").flatMap { actual in base?.number("kcal").map { actual - $0 } }
        return TargetListRow(open: {
            if windowWidth >= 1024 { editOverride(row) }
            else { previewOverride = row }
        }, delete: { Task { await removeOverride(row) } }, deleteLabel: store.tr("Borrar fecha específica"), vertical: 12) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 3) {
                        Text(shortDate(row.text("day"), weekday: true)).font(.nutriSans(13.5, weight: .medium))
                        if !row.text("label").isEmpty { Text("· " + row.text("label")).foregroundStyle(palette.text2) }
                    }.lineLimit(1)
                    Text((row.number("kcal").map(draftNumber) ?? "–") + " kcal")
                        .font(.nutriMono(11.5)).foregroundStyle(palette.text3)
                }
                Spacer(minLength: 0)
                if let delta { TargetDeltaPill(delta: delta) }
            }
        }
    }

    private func overridePreview(_ row: Record) -> some View {
        let day = row.text("day")
        let base = Domain.resolveTarget(phaseRows, day)
        let delta = row.number("kcal").flatMap { actual in base?.number("kcal").map { actual - $0 } }
        let n = elapsed(today, day)
        let relativeDate = n == 0 ? store.tr("hoy") : n > 0 ? relative("en %n %d", n) : relative("hace %n %d", -n)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                TargetKicker(kind: .override)
                Spacer()
                editPill { editOverride(row) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(row.text("label").isEmpty ? store.tr("Sin motivo") : row.text("label")).font(.nutriDisplay(19))
                if let base, let kcal = base.number("kcal") {
                    let name = base.text("label")
                    Text(store.tr("Sustituye a \"%n\" ese día (%m kcal)")
                        .replacingOccurrences(of: "%n", with: name.isEmpty ? store.tr("la fase") : name)
                        .replacingOccurrences(of: "%m", with: draftNumber(kcal)))
                        .font(.nutriSans(12.5)).foregroundStyle(palette.text2)
                }
            }
            Text(targetDateLabel(day, lang: store.lang, weekday: true, full: true) + " · " + relativeDate)
                .font(.nutriMono(11)).foregroundStyle(palette.text3)
            Divider().overlay(palette.border)
            TargetDayBlock(values: TargetValues(row), dows: [], delta: delta)
        }.padding(16).nutriCard()
    }

    private func editPill(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(store.tr("Editar")).font(.nutriSans(12)).foregroundStyle(palette.accent)
                .padding(.horizontal, 16).frame(minHeight: 44)
                .overlay { Capsule().strokeBorder(palette.accent.opacity(0.55)) }
        }.buttonStyle(.plain)
    }

    private var historyContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let date = historyDate, let rows = byStart[date] {
                Button { historyDate = nil } label: {
                    HStack { NutriIcon("chevron-left", size: 16); Text(store.tr("Fases previas")) }
                }.buttonStyle(NutriButtonStyle(.quiet, horizontal: 0))
                phaseCard(date, rows: rows, kind: .history)
                TargetGoalPicker(goal: Binding(get: { phaseGoal(rows) }, set: { goal in
                    Task {
                        do {
                            _ = try await store.update("targets", phaseFilter(date), ["goal": optionalText(goal)])
                            await reload()
                        } catch { store.report(error) }
                    }
                }))
            } else {
                Text(store.tr("Fases previas")).font(.nutriDisplay(17))
                let groups = Dictionary(grouping: historical) { String($0.prefix(4)) }
                ForEach(groups.keys.sorted(by: >), id: \.self) { year in
                    if let dates = groups[year] {
                        if year == String(today.prefix(4)) {
                            Text(year + "  ·  " + relative("%n %d", dates.count, singular: "fase", plural: "fases")).font(.nutriMono(12)).foregroundStyle(palette.text2)
                            historyRows(dates)
                        } else {
                            DisclosureGroup {
                                historyRows(dates).padding(.vertical, 6)
                            } label: {
                                Text(year + "  ·  " + relative("%n %d", dates.count, singular: "fase", plural: "fases")).font(.nutriMono(12)).foregroundStyle(palette.text2)
                            }
                        }
                    }
                }
            }
        }
    }

    private func historyRows(_ dates: [String]) -> some View {
        VStack(spacing: 8) {
            ForEach(dates, id: \.self) { date in
                let count = nextStart(date).map { elapsed(date, $0) } ?? 0
                compactPhase(date, rows: byStart[date] ?? [], detail: relative("%n %d", count), kind: .history) {
                    historyDate = date
                }
            }
        }
    }

    private func ruleSummary(_ rules: Record) -> [String] {
        var result = rules.array("items").compactMap(\.object).map { ruleProse($0, translate: store.tr) }
        if rules.number("kcal_min") != nil || rules.number("kcal_max") != nil {
            let lower = rules.number("kcal_min").map(draftNumber) ?? "–"
            let upper = rules.number("kcal_max").map(draftNumber) ?? "–"
            result.append(store.tr("Límite kcal") + ": " + lower + "–" + upper)
        }
        if !rules.text("paused_until").isEmpty { result.append(store.tr("Pausadas hasta") + " " + rules.text("paused_until")) }
        return result
    }

    private func accentAction(_ label: String, size: CGFloat = 13, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.nutriSans(size)).foregroundStyle(palette.accent)
                .padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private func goalLabel(_ goal: String) -> String { store.tr(phaseGoals.first { $0.0 == goal }?.1 ?? "Sin tipo") }
    private func nextStart(_ date: String) -> String? { phases.reversed().first { $0 > date } }
    private func dateSpan(_ date: String) -> String {
        shortDate(date) + " → " + (nextStart(date).flatMap(isoDate).map { shortDate(Day.key(addingDays(-1, to: $0))) } ?? store.tr("sin fin"))
    }
    private func shortDate(_ key: String, weekday: Bool = false) -> String { targetDateLabel(key, lang: store.lang, weekday: weekday) }
    private func relative(_ text: String, _ n: Int, singular: String = "día", plural: String = "días") -> String {
        store.tr(text).replacingOccurrences(of: "%n", with: String(n)).replacingOccurrences(of: "%d", with: store.tr(n == 1 ? singular : plural))
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            rows = try await store.read("targets", ["order": "valid_from.desc.nullslast,dow.asc"])
            errorText = ""
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
                guard key == input.original && !newVersion || byStart[key] == nil else {
                    throw FeatureError("Ya existe una fase que aplica desde esa fecha.")
                }
            }
            let validFrom = input.kind == .current && !newVersion ? (input.original ?? key) : key
            let payload = try phasePayload(input, owner: owner, validFrom: validFrom)
            if input.kind == .current && !newVersion {
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
        await reload()
    }

    @MainActor fileprivate static func saveWizard(_ input: PhaseDraft, exceptions: [WizardOverride], confirmed: Bool, rows: [Record], store: Store) async throws {
        let today = Day.key(Date())
        guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
        let start = Day.key(input.date)
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
    }

    private func phaseFilter(_ date: String) -> [String: String] { ["valid_from": "eq.\(date)", "dow": "not.is.null"] }

    private func removePhase() async {
        guard let date = deletePhase, date > today else { return }
        do {
            _ = try await store.delete("targets", phaseFilter(date))
            deletePhase = nil
            await reload()
        } catch { store.report(error) }
    }

    private func removeOverride(_ row: Record) async {
        rows.removeAll { $0.text("id") == row.text("id") }
        do {
            _ = try await store.delete("targets", ["id": "eq.\(row.text("id"))"])
            store.undo(store.tr("Objetivo borrado")) {
                _ = try await store.insert("targets", row)
                await reload()
            }
        } catch {
            if !rows.contains(where: { $0.text("id") == row.text("id") }) { rows.append(row) }
            store.report(error)
        }
    }


}

private func elapsed(_ start: String, _ end: String) -> Int {
    guard let start = isoDate(start), let end = isoDate(end) else { return 0 }
    return Calendar.current.dateComponents([.day], from: start, to: end).day ?? 0
}

private func targetDateLabel(_ key: String, lang: String, weekday: Bool = false, full: Bool = false, withYear: Bool = false) -> String {
    guard let date = isoDate(key) else { return key }
    let locale = Locale(identifier: lang == "en" ? "en_US" : "es_MX")
    let format = DateFormatter()
    format.locale = locale
    format.setLocalizedDateFormatFromTemplate(withYear ? "dMMMy" : full ? "EEEEdMMMM" : weekday ? "EEEdMMM" : "dMMM")
    let label = format.string(from: date).replacingOccurrences(of: ".", with: "")
    let first = weekday ? label.prefix(1).uppercased() + label.dropFirst() : label
    guard !withYear, key.prefix(4) != Day.key(Date()).prefix(4) else { return first }
    return first + (full ? lang == "en" ? ", " : " de " : " ") + key.prefix(4)
}

private func weekGroups(_ week: [TargetValues]) -> [[Int]] {
    var groups: [[Int]] = []
    for dow in orderedWeek {
        if let index = groups.firstIndex(where: { week[$0[0]] == week[dow] }) {
            groups[index].append(dow)
        } else { groups.append([dow]) }
    }
    return groups
}

private func shortWeekday(_ dow: Int, language: String) -> String {
    (language == "en" ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] : ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"])[dow]
}

private func weekLabels(_ dows: [Int], language: String) -> [String] {
    let labels = dows.map { shortWeekday($0, language: language) }
    let indexes = dows.compactMap { orderedWeek.firstIndex(of: $0) }
    if let first = indexes.first, indexes.count > 1, indexes.enumerated().allSatisfy({ $0.element == first + $0.offset }) {
        return [labels[0] + " – " + labels[labels.count - 1]]
    }
    return labels
}

private func ruleProse(_ item: Record, translate: (String) -> String) -> String {
    let kind = item.text("kind")
    let label = translate(ruleKinds.first { $0.0 == kind }?.1 ?? kind)
    let value = item["value"]?.string ?? (item.number("value").map(draftNumber) ?? "–")
    let action = item.number("delta_carbs_g").map { ($0 > 0 ? "+" : "−") + draftNumber(abs($0)) + " g carbs" } ?? ""
    switch kind {
    case "ritmo_alto", "ritmo_lento":
        return "\(label): \(kind == "ritmo_alto" ? ">" : "<")\(value) kg/sem × \(draftNumber(item.number("weeks"))) \(translate("sem")) → \(action)"
    case "estancamiento":
        return "\(label): \(draftNumber(item.number("days"))) \(translate("días")) → \(action)"
    case "techo_peso":
        return "\(label): ≥\(value) kg → \(translate("mantenimiento"))"
    default: return label
    }
}

private struct TargetChip: View {
    @Environment(\.nutriPalette) private var palette
    let text: String
    var body: some View {
        Text(text).font(.nutriSans(11)).foregroundStyle(palette.text2)
            .padding(.horizontal, 8).padding(.vertical, 2).background(palette.surface3, in: Capsule())
    }
}

private struct TargetKicker: View {
    @Environment(\.nutriPalette) private var palette
    @EnvironmentObject private var store: Store
    let kind: PhaseDraft.Kind
    var isNewOverride = false
    var body: some View {
        let title = switch kind {
        case .current: "FASE VIGENTE"
        case .scheduled: "FASE PROGRAMADA"
        case .new: "NUEVA FASE"
        case .history: "FASE PREVIA"
        case .override: isNewOverride ? "NUEVA FECHA" : "FECHA ESPECÍFICA"
        }
        HStack(spacing: 6) {
            Group {
                switch kind {
                case .current: Circle().fill(palette.ok)
                case .override: Circle().fill(palette.warn)
                case .history: Circle().fill(palette.text3)
                default: Circle().strokeBorder(palette.accent, lineWidth: 1.5)
                }
            }.frame(width: 7, height: 7)
            Text(store.tr(title)).font(.nutriSans(11, weight: .medium)).tracking(1.54).foregroundStyle(palette.text2)
        }
    }
}

private struct TargetListRow<Content: View>: View {
    @Environment(\.nutriWindowWidth) private var windowWidth
    @Environment(\.nutriPalette) private var palette
    let open: () -> Void
    let delete: (() -> Void)?
    let deleteLabel: String
    let vertical: CGFloat
    @ViewBuilder let content: () -> Content
    @State private var hovering = false
    @FocusState private var focused: Bool

    var body: some View {
        if windowWidth < 1024 && delete != nil {
            CatalogSwipeCard(open: open, delete: delete, radius: 12, padding: 14) { content() }
        } else {
            Button(action: open) {
                content().frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14).padding(.vertical, vertical).nutriCard(radius: 12)
            }.buttonStyle(.plain).focused($focused)
                .onHover { hovering = $0 }
                .overlay(alignment: .trailing) {
                    if let delete, hovering || focused {
                        Button(action: delete) {
                            NutriIcon("trash-2", size: 16).frame(width: 36, height: 36)
                                .background(palette.surface, in: RoundedRectangle(cornerRadius: 8)).foregroundStyle(palette.text2)
                        }.buttonStyle(.plain).accessibilityLabel(deleteLabel).padding(.trailing, 10)
                    }
                }
                .contextMenu {
                    if let delete { Button(deleteLabel, role: .destructive, action: delete) }
                }
        }
    }
}

private struct TargetDeltaPill: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let delta: Double
    var body: some View {
        Text((delta > 0 ? "+" : "−") + draftNumber(abs(delta)) + " " + store.tr("vs fase"))
            .font(.nutriMono(11)).foregroundStyle(palette.warn)
            .padding(.horizontal, 8).padding(.vertical, 4).background(palette.warn.opacity(0.14), in: RoundedRectangle(cornerRadius: 6))
    }
}

private struct TargetDayBlock: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let values: TargetValues
    let dows: [Int]
    var delta: Double? = nil
    var body: some View {
        let keys = ["protein_g", "carbs_g", "fat_g"]
        let grams = keys.map { Double(values.point[$0] ?? "") }
        let calories = zip(grams, [4.0, 4.0, 9.0]).map { ($0 ?? 0) * $1 }
        let total = calories.reduce(0, +)
        let colors = [palette.protein, palette.carbs, palette.fat]
        let boundKeys = Set(values.min.filter { !$0.value.isEmpty }.keys).union(values.max.filter { !$0.value.isEmpty }.keys)
        let macroRanges = zip(["kcal"] + keys, ["kcal", "P", "C", "G"]).compactMap { key, short -> String? in
            guard boundKeys.contains(key) else { return nil }
            let lower = values.min[key].flatMap { $0.isEmpty ? nil : $0 }
            let upper = values.max[key].flatMap { $0.isEmpty ? nil : $0 }
            if let lower, let upper { return "\(short) \(lower)–\(upper)" }
            if let lower { return "\(short) ≥\(lower)" }
            if let upper { return "\(short) ≤\(upper)" }
            return nil
        }
        let microCount = boundKeys.subtracting(["kcal"] + keys).count
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 6) {
                if dows.isEmpty { TargetChip(text: store.tr("DÍA ÚNICO")) }
                else { ForEach(weekLabels(dows, language: store.lang), id: \.self) { TargetChip(text: $0) } }
                Spacer()
                if let delta { TargetDeltaPill(delta: delta) }
                Text(values.point["kcal"].flatMap { $0.isEmpty ? nil : $0 } ?? "–").font(.nutriMono(15))
            }
            if total > 0 && grams.allSatisfy({ $0 != nil }) {
                GeometryReader { proxy in
                    HStack(spacing: 0) {
                        ForEach(keys.indices, id: \.self) { index in
                            colors[index].frame(width: proxy.size.width * calories[index] / total)
                        }
                    }.clipShape(Capsule())
                }.frame(height: 6).accessibilityHidden(true)
            }
            HStack(spacing: 5) {
                ForEach(keys.indices, id: \.self) { index in
                    if index > 0 { Text("·").foregroundStyle(palette.text3) }
                    Text(["P", "C", "G"][index] + " " + (grams[index].map(draftNumber) ?? "–")).foregroundStyle(colors[index])
                }
            }.font(.nutriMono(11.5))
            if !boundKeys.isEmpty {
                let detail = macroRanges + (microCount == 0 ? [] : ["+\(microCount) " + store.tr(microCount == 1 ? "micro" : "micros")])
                Text(store.tr("mín/máx") + ": " + detail.joined(separator: " · "))
                    .font(.nutriMono(11)).foregroundStyle(palette.text3)
            }
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct TargetGoalPicker: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var goal: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr("Régimen")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            NutriSelect(value: goal, select: { goal = $0 }, options: phaseGoals.map {
                ($0.0, store.tr($0.0.isEmpty ? "Sin régimen" : $0.1))
            }).accessibilityLabel(store.tr("Régimen"))
        }
    }
}

private struct TargetSheetContent<Content: View>: View {
    @Environment(\.nutriPalette) private var palette
    let close: () -> Void
    let content: Content

    var body: some View {
        ViewThatFits(in: .vertical) {
            paper.fixedSize(horizontal: false, vertical: true)
            ScrollView { paper }
        }
        .background(palette.bg, in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .onExitCommand(perform: close)
    }

    private var paper: some View {
        VStack(spacing: 4) {
            Capsule().fill(palette.surface3).frame(width: 36, height: 4).padding(.top, 10).padding(.bottom, 4)
            content.frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
        }
    }
}

private struct TargetDecisionSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let input: PhaseDraft
    let close: () -> Void
    let onSave: (PhaseDraft, Bool) async throws -> Void
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Guardar cambios")).font(.nutriDisplay(19))
            choice("Corregir la fase", note: store.tr("Reescribe el objetivo desde el %n. La adherencia pasada se recalcula.")
                .replacingOccurrences(of: "%n", with: targetDateLabel(input.original ?? "", lang: store.lang)), color: palette.warn, version: false)
            choice("Nueva fase desde hoy", note: store.tr("Conserva el histórico intacto."), color: palette.text2, version: true)
            if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
            Button(action: close) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                .buttonStyle(NutriButtonStyle(.quiet))
        }.disabled(busy)
    }

    private func choice(_ title: String, note: String, color: Color, version: Bool) -> some View {
        Button {
            Task {
                busy = true
                error = ""
                defer { busy = false }
                do {
                    var outgoing = input
                    if version { outgoing.date = Date(); outgoing.rules = [:] }
                    try await onSave(outgoing, version)
                } catch { self.error = error.localizedDescription }
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.tr(title)).font(.nutriSans(14, weight: .medium))
                Text(note).font(.nutriSans(12)).foregroundStyle(color)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(14).nutriCard(radius: 12, fill: palette.bg)
        }.buttonStyle(.plain)
    }
}

private struct TargetConfirmBox: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let title: String
    let detail: String
    let actionLabel: String
    let destructive: Bool
    let close: () -> Void
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.nutriDisplay(19))
            Text(detail).font(.nutriSans(14)).foregroundStyle(palette.text2)
            HStack(spacing: 8) {
                Button(action: close) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.secondary))
                Button(action: action) {
                    Text(actionLabel).frame(maxWidth: .infinity)
                }.buttonStyle(NutriButtonStyle(destructive ? .danger : .primary))
            }
        }.padding(16).nutriCard()
    }
}

private struct PhaseEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State var draft: PhaseDraft
    let activeRows: [Record]
    let phaseRows: [Record]
    let onClose: () -> Void
    let onDecision: (PhaseDraft) -> Void
    let onSave: (PhaseDraft, Bool) async throws -> Void
    @State private var groups: [[Int]] = []
    @State private var expanded: Int?
    @State private var splitting = false
    @State private var error = ""
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TargetKicker(kind: draft.kind, isNewOverride: draft.recordID.isEmpty)
            if draft.kind == .override {
                targetDateField(store.tr("Fecha"), selection: $draft.date)
                targetInput(store.tr("Motivo"), text: $draft.label, placeholder: store.tr("p. ej. Cumpleaños"))
                let phase = Domain.resolveTarget(phaseRows, Day.key(draft.date))
                if let base = phase?.number("kcal"), let entered = Double(draft.weekdays[0].point["kcal"] ?? "") {
                    let delta = entered - base
                    Text((delta > 0 ? "+" : "−") + draftNumber(abs(delta)) + " " + store.tr("kcal vs fase ese día"))
                        .font(.nutriMono(11)).foregroundStyle(palette.warn)
                }
                TargetFields(values: $draft.weekdays[0], goal: phase?.text("goal") ?? "")
            } else {
                targetInput(store.tr("Nombre de fase"), text: $draft.label, placeholder: store.tr("p. ej. Bulk único"))
                targetInput(store.tr("Descripción"), text: $draft.description, placeholder: store.tr("Objetivo de la fase"))
                TargetGoalPicker(goal: $draft.goal)
                if draft.kind != .current { targetDateField(store.tr("Aplica desde"), selection: $draft.date) }
                Divider().overlay(palette.border)
                HStack {
                    Text(store.tr("Semana de la fase")).font(.nutriSans(12, weight: .medium)).foregroundStyle(palette.text2)
                    Spacer()
                    if draft.kind == .new && !activeRows.isEmpty {
                        Button(store.tr("Copiar semana vigente")) {
                            draft.weekdays = PhaseDraft(kind: .current, date: Day.key(draft.date), rows: activeRows).weekdays
                            groups = weekGroups(draft.weekdays)
                            expanded = nil
                        }.buttonStyle(NutriButtonStyle(.quiet, horizontal: 0))
                    }
                }
                ForEach(groups, id: \.self) { group in
                    if let dow = group.first { groupEditor(group, dow: dow) }
                }
            }
            if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
            HStack(spacing: 8) {
                Button(action: onClose) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.secondary)).keyboardShortcut(.cancelAction)
                Button {
                    if draft.kind == .current { onDecision(draft) }
                    else { submit() }
                } label: { Text(store.tr(busy ? "Guardando…" : "Guardar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.primary))
            }
        }
        .padding(16).nutriCard().disabled(busy)
        .onAppear { groups = weekGroups(draft.weekdays) }
    }

    private func groupEditor(_ group: [Int], dow: Int) -> some View {
        VStack(spacing: 0) {
            Button {
                expanded = expanded == dow ? nil : dow
                splitting = false
            } label: { TargetDayBlock(values: draft.weekdays[dow], dows: group) }.buttonStyle(.plain)
            if expanded == dow {
                VStack(alignment: .leading, spacing: 12) {
                    TargetFields(values: Binding(get: { draft.weekdays[dow] }, set: { value in
                        for day in group { draft.weekdays[day] = value }
                    }), goal: draft.goal)
                    if group.count > 1 {
                        Button(store.tr("Separar un día")) { splitting.toggle() }
                            .buttonStyle(NutriButtonStyle(.quiet, horizontal: 0))
                        if splitting {
                            HStack {
                                ForEach(group, id: \.self) { day in
                                    Button(shortWeekday(day, language: store.lang)) {
                                        groups.removeAll { $0 == group }
                                        groups.append(group.filter { $0 != day })
                                        groups.append([day])
                                        groups.sort { (orderedWeek.firstIndex(of: $0[0]) ?? 0) < (orderedWeek.firstIndex(of: $1[0]) ?? 0) }
                                        expanded = nil
                                        splitting = false
                                    }.buttonStyle(NutriButtonStyle(.secondary, radius: 22))
                                }
                            }
                        }
                    }
                }.padding(12)
            }
        }.background(palette.surface3, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.accent.opacity(0.45), lineWidth: 1.5).allowsHitTesting(false) }
    }

    private func submit() {
        Task {
            busy = true
            error = ""
            defer { busy = false }
            do {
                try await onSave(draft, false)
                onClose()
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct TargetFields: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var values: TargetValues
    var goal = ""
    var macrosOnly = false
    @State private var range = false
    private var locked: Bool { values.min.values.contains { !$0.isEmpty } || values.max.values.contains { !$0.isEmpty } }

    var body: some View {
        let showRange = !macrosOnly && (range || locked)
        VStack(alignment: .leading, spacing: 8) {
            fields([("kcal", "Kcal"), ("protein_g", "Prot"), ("carbs_g", "Carbs"), ("fat_g", "Grasa")], showRange: showRange)
            if !macrosOnly {
                Button {
                    range.toggle()
                } label: {
                    HStack {
                        NutriIcon("chevron-down", size: 14).rotationEffect(.degrees(showRange ? 180 : 0))
                        Text(store.tr(showRange ? "Mín/máx por nutriente" : "Ajustar mín/máx por nutriente"))
                    }
                }.buttonStyle(NutriButtonStyle(.quiet, horizontal: 0)).disabled(locked)
                if showRange {
                    Text(store.tr("Vacío = el límite que la app asume hoy (en gris) y que sigue aplicando. Hoy y el Dashboard clasifican contra tu mín/máx cuando lo fijas."))
                        .font(.nutriSans(11)).foregroundStyle(palette.text3)
                }
                DisclosureGroup(store.tr("Micros")) {
                    ForEach(Domain.categories, id: \.self) { category in
                        Text(store.tr(category).uppercased()).font(.nutriSans(12)).tracking(0.4).foregroundStyle(palette.text3)
                            .padding(.top, 12)
                        fields(Domain.micros.filter { $0.category == category }.map { ($0.key, $0.label) }, showRange: showRange)
                    }
                }.font(.nutriSans(12)).foregroundStyle(palette.text3).padding(.vertical, 8)
            }
        }
    }

    private func fields(_ fields: [(String, String)], showRange: Bool) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 4), spacing: 8) {
            ForEach(fields, id: \.0) { key, label in
                TargetNumberField(key: key, label: label, goal: goal, range: showRange, values: $values)
            }
        }
    }
}

private struct TargetNumberField: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let key: String
    let label: String
    let goal: String
    let range: Bool
    @Binding var values: TargetValues

    var body: some View {
        let lo = Double(values.min[key] ?? "")
        let hi = Double(values.max[key] ?? "")
        let point = Double(values.point[key] ?? "")
        let bounds = Domain.impliedBounds(key, target: point.map { point in
            let values: Record = Domain.macroKeys.contains(key) ? [key: .number(point)] : ["micros": .object([key: .number(point)])]
            return values.merging(["goal": .string(goal)]) { _, new in new }
        }, bands: store.prefs.object("adherence_bands"))
        let reversed = lo.flatMap { lower in hi.map { lower > $0 } } ?? false
        let outside = point.map { $0 < (lo ?? -.infinity) || $0 > (hi ?? .infinity) } ?? false
        let warning: String? =
            key == "sodio_mg" && (lo ?? Domain.sodiumFloor) < Domain.sodiumFloor ? "piso médico 1,500 mg: no baja" :
            reversed ? "mín > máx" : outside ? "objetivo fuera del rango" : nil
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                Text(store.tr(label)).lineLimit(1)
                if lo != nil || hi != nil { Text("•").foregroundStyle(palette.accent) }
            }.font(.nutriSans(12)).foregroundStyle(palette.text3)
            TextField("", text: field($values.point)).font(.nutriMono(14)).nutriInput().accessibilityLabel(store.tr(label))
            if range {
                TextField(bounds.min.map { "≥ " + draftNumber(Domain.round($0, 1)) } ?? "—", text: field($values.min))
                    .font(.nutriMono(12)).nutriInput().accessibilityLabel(store.tr(label) + " " + store.tr("mín"))
                TextField(bounds.max.map { "≤ " + draftNumber(Domain.round($0, 1)) } ?? "—", text: field($values.max))
                    .font(.nutriMono(12)).nutriInput().accessibilityLabel(store.tr(label) + " " + store.tr("máx"))
                if let warning {
                    Text("⚠ " + store.tr(warning)).font(.nutriSans(10)).foregroundStyle(palette.warn)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func field(_ map: Binding<[String: String]>) -> Binding<String> {
        Binding(get: { map.wrappedValue[key] ?? "" }, set: { map.wrappedValue[key] = $0 })
    }
}

private func targetInput(_ label: String, text: Binding<String>, placeholder: String = "") -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.nutriSans(12)).foregroundStyle(.secondary)
        TextField(placeholder, text: text).nutriInput().accessibilityLabel(label)
    }
}

private func targetDateField(_ label: String, selection: Binding<Date>) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(label).font(.nutriSans(12)).foregroundStyle(.secondary)
        DatePicker(label, selection: selection, displayedComponents: .date)
            .labelsHidden().frame(maxWidth: .infinity, alignment: .leading).nutriInput()
    }
}

private struct TargetRulesSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @State private var rules: Record
    let scopes: [(String, [Int])]
    let close: () -> Void
    let onSave: (Record) async throws -> Void
    @State private var busy = false
    @State private var error = ""

    init(input: PhaseDraft, close: @escaping () -> Void, onSave: @escaping (Record) async throws -> Void) {
        _rules = State(initialValue: input.rules)
        scopes = weekGroups(input.weekdays).map { ("", $0) }
        self.close = close
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
                Text(store.tr("Reglas de fase")).font(.nutriDisplay(19))
                PhaseRulesEditor(rules: $rules, scopes: scopes)
                if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
                HStack {
                    Button(action: close) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                        .buttonStyle(NutriButtonStyle(.secondary))
                    Button {
                        Task {
                            busy = true
                            defer { busy = false }
                            do { try await onSave(normalizedRules(rules)) }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        Text(store.tr(busy ? "Guardando…" : "Guardar")).frame(maxWidth: .infinity)
                    }.buttonStyle(NutriButtonStyle(.primary))
                }
        }.disabled(busy)
    }
}

private struct PhaseRulesEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var rules: Record
    let scopes: [(String, [Int])]
    @State private var removed: JSONValue?
    @State private var removedIndex = 0
    @State private var undoTimer: Task<Void, Never>?

    private var items: [JSONValue] { rules.array("items") }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            caption("Añadir regla")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 135), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(ruleKinds, id: \.0) { kind, label in
                    Button("+ " + store.tr(label)) { add(kind) }
                        .buttonStyle(NutriButtonStyle(.secondary, radius: 22))
                }
            }
            if items.isEmpty {
                Text(store.tr("Sin reglas configuradas.")).font(.nutriSans(12.5)).foregroundStyle(palette.text2)
            }
            ForEach(items.indices, id: \.self) { index in
                if let row = items[index].object { ruleEditor(row, index: index) }
            }
            Divider().overlay(palette.border)
            caption("Límites de la fase")
            HStack {
                targetInput(store.tr("Kcal mín."), text: numericBinding("kcal_min"), placeholder: "0")
                targetInput(store.tr("Kcal máx."), text: numericBinding("kcal_max"), placeholder: "0")
            }
            targetInput(store.tr("Pausar reglas hasta"), text: textBinding("paused_until"), placeholder: "AAAA-MM-DD")
            if let removed {
                HStack {
                    Text(store.tr("Regla borrada"))
                    Spacer()
                    Button(store.tr("Deshacer")) {
                        undoTimer?.cancel()
                        var list = items
                        list.insert(removed, at: min(removedIndex, list.count))
                        rules["items"] = .array(list)
                        self.removed = nil
                    }.buttonStyle(NutriButtonStyle(.quiet, horizontal: 0))
                }.padding(.horizontal, 12).nutriCard(radius: 12, fill: palette.surface3)
            }
        }
    }

    private func caption(_ title: String) -> some View {
        Text(store.tr(title).uppercased()).font(.nutriSans(11, weight: .medium)).tracking(0.5).foregroundStyle(palette.text3)
    }

    private func ruleEditor(_ row: Record, index: Int) -> some View {
        let kind = row.text("kind")
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(store.tr(ruleKinds.first { $0.0 == kind }?.1 ?? kind)).font(.nutriSans(13.5, weight: .medium))
                Spacer()
                Button {
                    var list = items
                    removed = list.remove(at: index)
                    removedIndex = index
                    rules["items"] = .array(list)
                    undoTimer?.cancel()
                    undoTimer = Task {
                        try? await Task.sleep(for: .seconds(5))
                        if !Task.isCancelled { removed = nil }
                    }
                } label: { NutriIcon("x", size: 16) }
                    .buttonStyle(NutriButtonStyle(.quiet, horizontal: 8)).accessibilityLabel(store.tr("Borrar regla"))
            }
            Text(ruleHelp(row)).font(.nutriSans(11.5)).foregroundStyle(palette.text3)
            HStack(alignment: .top, spacing: 8) {
                if kind == "estancamiento" {
                    targetInput(store.tr("Días"), text: itemNumber(index, "days"), placeholder: "0")
                } else {
                    targetInput(store.tr(kind == "techo_peso" ? "Peso (kg)" : "kg/sem"), text: itemNumber(index, "value"), placeholder: "0")
                    if kind != "techo_peso" { targetInput(store.tr("Semanas"), text: itemNumber(index, "weeks"), placeholder: "0") }
                }
                if kind != "techo_peso" {
                    targetInput(store.tr("Δ carbs (g)"), text: itemNumber(index, "delta_carbs_g"), placeholder: "0")
                }
            }
            if kind != "techo_peso" && !scopes.isEmpty { scopePicker(index) }
            Text(store.tr("Propuesta para revisar en el plan maestro; no modifica objetivos automáticamente."))
                .font(.nutriSans(12.5)).foregroundStyle(palette.text2)
        }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
    }

    private func ruleHelp(_ item: Record) -> String {
        let kind = item.text("kind")
        let format = switch kind {
        case "ritmo_alto": "Si el peso sube más de %v kg/sem durante %w semanas, %d."
        case "ritmo_lento": "Si el peso baja menos de %v kg/sem durante %w semanas, %d."
        case "estancamiento": "Si el peso no baja en %n días, %d."
        default: "Si el peso llega a %v kg, se propone revisar las kcal de mantenimiento."
        }
        let delta = item.number("delta_carbs_g").map { ($0 > 0 ? "+" : $0 < 0 ? "−" : "") + draftNumber(abs($0)) + " g " + store.tr("de carbs") }
        func number(_ key: String) -> String { item[key]?.string ?? item.number(key).map(draftNumber) ?? "–" }
        return store.tr(format).replacingOccurrences(of: "%v", with: number("value"))
            .replacingOccurrences(of: "%w", with: number("weeks")).replacingOccurrences(of: "%n", with: number("days"))
            .replacingOccurrences(of: "%d", with: delta ?? store.tr("se propone revisar los carbos"))
    }

    private func scopePicker(_ index: Int) -> some View {
        let current = scope(index)
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 6)], alignment: .leading, spacing: 6) {
            Button(store.tr("Todos")) { writeItem(index, "scope", value: .null) }
                .buttonStyle(NutriButtonStyle(current == nil ? .primary : .secondary, radius: 22))
            ForEach(scopes, id: \.1) { name, days in
                let selected = current.map { $0.isSuperset(of: days) } ?? false
                Button(name.isEmpty ? weekLabels(days, language: store.lang).joined(separator: " ") : name) {
                    var next = current ?? []
                    if selected { next.subtract(days) } else { next.formUnion(days) }
                    writeItem(index, "scope", value: next.isEmpty ? .null : .array(next.sorted().map { .number(Double($0)) }))
                }.buttonStyle(NutriButtonStyle(selected ? .primary : .secondary, radius: 22))
            }
        }
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

    private func scope(_ index: Int) -> Set<Int>? {
        guard items.indices.contains(index), let list = items[index].object?["scope"]?.array else { return nil }
        return Set(list.compactMap { $0.number }.filter { $0 >= 0 && $0 <= 6 }.map(Int.init))
    }
}

private func phasePayload(_ input: PhaseDraft, owner: String, validFrom: String) throws -> [Record] {
    let rules = normalizedRules(input.rules)
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

struct TargetsWizardFromMenu: View {
    @EnvironmentObject private var store: Store
    @State private var rows: [Record] = []
    @State private var unavailable = false
    let close: () -> Void

    var body: some View {
        TargetWizard(rows: rows, unavailable: unavailable, close: close) { phase, exceptions, confirmed in
            try await TargetsView.saveWizard(phase, exceptions: exceptions, confirmed: confirmed, rows: rows, store: store)
            NotificationCenter.default.post(name: .nutriTargetsChanged, object: nil)
        }.task {
            do { rows = try await store.read("targets") }
            catch {
                if !Task.isCancelled { unavailable = true; store.report(error) }
            }
        }
    }
}

extension Notification.Name {
    static let nutriTargetsChanged = Notification.Name("nutri.targetsChanged")
}

private struct TargetWizard: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let rows: [Record]
    let unavailable: Bool
    let close: () -> Void
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
    @State private var saved = false

    private var colors: [Color] { [palette.protein, palette.carbs, palette.fat] }
    private var usedGroups: [Int] { (0..<3).filter { assignments.contains($0) } }
    private var phases: [String: [Record]] {
        Dictionary(grouping: rows.filter { $0.number("dow") != nil }) { $0.text("valid_from") }
    }
    private var phaseConflict: Bool { phases[Day.key(draft.date)] != nil }
    private var overrideConflicts: Int {
        let days = Set(exceptions.map { Day.key($0.date) })
        return rows.filter { days.contains($0.text("day")) }.count
    }
    private let lastStep = 8
    private let ceilings = [("grasa_sat_g", "Grasa sat. (g)"), ("azucar_anadido_g", "Az. añadido (g)"), ("alcohol_g", "Alcohol (g)")]
    private let electrolytes = [("agua_ml", "Agua (ml)"), ("potasio_mg", "Potasio (mg)"), ("magnesio_mg", "Magnesio (mg)")]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(store.tr("Asistente de metas")).font(.nutriDisplay(19))
                Spacer()
                Button(action: close) { NutriIcon("x", size: 16) }
                    .buttonStyle(NutriButtonStyle(.quiet, height: 36))
                    .accessibilityLabel(store.tr("Cerrar")).keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 20).padding(.vertical, 12)
            Rectangle().fill(palette.border).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if saved { savedState }
                    else {
                        HStack(spacing: 4) {
                            ForEach(0...lastStep, id: \.self) { index in
                                Capsule().fill(index <= step ? palette.accent : palette.surface3)
                                    .frame(height: 4)
                            }
                        }.accessibilityLabel("\(step + 1) / \(lastStep + 1)")
                        fields
                        if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
                    }
                }.padding(.horizontal, 20).padding(.vertical, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: 550).fixedSize(horizontal: false, vertical: true)
            Rectangle().fill(palette.border).frame(height: 1)
            footer.padding(.horizontal, 20).padding(.vertical, 12)
        }
        .font(.nutriSans(14)).foregroundStyle(palette.text).nutriGlass()
        .onAppear { setElectrolytes(); typeNames = typeNames.map(store.tr) }
        .onChange(of: draft.goal) { _, _ in setElectrolytes() }
        .overlay {
            if confirm {
                ZStack {
                    Color.black.opacity(0.4).onTapGesture { confirm = false }
                    TargetConfirmBox(title: store.tr("¿Sobrescribir lo existente?"), detail: conflictDescription,
                        actionLabel: store.tr("Sobrescribir y guardar"), destructive: false, close: { confirm = false }) {
                        confirm = false
                        perform(confirmed: true)
                    }.padding(16)
                }.clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private var conflictDescription: String {
        let phase = phaseConflict ? store.tr("Ya hay una fase que aplica desde el %n; se reemplazará.")
            .replacingOccurrences(of: "%n", with: targetDateLabel(Day.key(draft.date), lang: store.lang, withYear: true)) : ""
        let days = overrideConflicts > 0 ? store.tr("%n fecha(s) especial(es) ya existen y se reemplazarán.")
            .replacingOccurrences(of: "%n", with: String(overrideConflicts)) : ""
        return [phase, days].filter { !$0.isEmpty }.joined(separator: " ")
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if saved {
                Button(action: close) { Text(store.tr("Cerrar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.primary, height: 46))
            } else {
                Button(store.tr(step == 0 ? "Cancelar" : "Atrás")) {
                    if step == 0 { close() } else { error = ""; step -= 1 }
                }.buttonStyle(NutriButtonStyle(.secondary, height: 46))
                Button {
                    if step < lastStep { advance() }
                    else if phaseConflict || overrideConflicts > 0 { confirm = true }
                    else { perform() }
                } label: {
                    Text(store.tr(step == 0 ? "Comenzar" : step < lastStep ? "Siguiente" : busy ? "Guardando…" : "Guardar configuración"))
                        .frame(maxWidth: .infinity)
                }.buttonStyle(NutriButtonStyle(.primary, height: 46)).keyboardShortcut(.defaultAction)
                    .disabled(busy || (unavailable && step == lastStep))
            }
        }.disabled(busy)
    }

    @ViewBuilder private var fields: some View {
        switch step {
        case 0: intro
        case 1: settings
        case 2: pattern
        case 3:
            ForEach(usedGroups, id: \.self) { group in
                VStack(alignment: .leading, spacing: 8) {
                    groupTitle(group)
                    TargetFields(values: $values[group], macrosOnly: true)
                }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
            }
        case 4:
            Text(store.tr("Se aplican a todos los tipos de día. Valores de referencia — ajústalos a tu plan.")).foregroundStyle(palette.text2)
            sharedFields(electrolytes)
            Text(store.tr("Sodio: piso médico %f mg y techo %c mg, fijos en la app.")
                .replacingOccurrences(of: "%f", with: numberText(Domain.sodiumFloor, digits: 0))
                .replacingOccurrences(of: "%c", with: numberText(Domain.sodiumCeiling, digits: 0)))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
        case 5:
            Text(store.tr("Máximos a no rebasar. Opcionales: déjalos vacíos si no los usas.")).foregroundStyle(palette.text2)
            sharedFields(ceilings)
            Button(store.tr("Omitir (dejar sin techos)")) {
                for (key, _) in ceilings { sharedMicros.point[key] = nil }
            }.buttonStyle(NutriButtonStyle(.quiet, horizontal: 0))
        case 6:
            Text(store.tr("Opcional: propuestas de carbohidratos según la evolución de tu peso, sujetas a revisión en el plan maestro.")).foregroundStyle(palette.text2)
            PhaseRulesEditor(rules: $draft.rules, scopes: usedGroups.map { (typeNames[$0].isEmpty ? store.tr("Tipo de día") : typeNames[$0], days($0)) })
        case 7: specificDates
        default: summary
        }
    }

    private var savedState: some View {
        VStack(spacing: 12) {
            NutriIcon("check", size: 28).foregroundStyle(palette.ok).frame(width: 56, height: 56)
                .background(palette.ok.opacity(0.18), in: Circle())
            Text(store.tr("Configuración guardada")).font(.nutriDisplay(19))
            Text(store.tr("Tu fase y fechas especiales ya están en Metas.")).foregroundStyle(palette.text2)
        }.frame(maxWidth: .infinity).padding(.vertical, 24)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Configura tus metas paso a paso")).font(.nutriDisplay(18))
            Text(store.tr("Te guiaré para crear una fase: régimen, patrón semanal (entreno / descanso), kcal y macros por tipo de día, agua y electrolitos, y fechas especiales.")).foregroundStyle(palette.text2)
            if !phases.isEmpty {
                wizardCaption("Fases existentes")
                let today = Day.key(Date())
                ForEach(phases.keys.sorted(), id: \.self) { date in
                    let phase = phases[date] ?? []
                    let name = phase.first { !$0.text("label").isEmpty }?.text("label") ?? store.tr("Sin nombre")
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(.nutriSans(13.5, weight: .medium))
                            Text(targetDateLabel(date, lang: store.lang, withYear: true)).font(.nutriMono(11)).foregroundStyle(palette.text3)
                        }
                        Spacer()
                        if let goal = phase.first(where: { !$0.text("goal").isEmpty })?.text("goal") { TargetChip(text: goalName(goal)) }
                        Text(store.tr(date <= today ? "vigente" : "programada")).font(.nutriSans(11))
                            .foregroundStyle(date <= today ? palette.ok : palette.accent)
                    }.padding(.horizontal, 12).padding(.vertical, 8).nutriCard(radius: 12, fill: palette.surface2)
                }
            }
            Text(store.tr("Escribir una fase en una fecha ya ocupada la sobrescribe."))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            wizardCaption("Régimen")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(phaseGoals, id: \.0) { value, title in
                    Button { draft.goal = value } label: {
                        Text(store.tr(value.isEmpty ? "Sin régimen" : title)).font(.nutriSans(13)).lineLimit(1)
                    }.buttonStyle(NutriButtonStyle(draft.goal == value ? .primary : .secondary, horizontal: 10, radius: 22))
                }
            }
            let nuance = draft.goal == "deficit" ? "En déficit tolera menos el exceso de calorías." :
                draft.goal == "volumen" ? "En volumen tolera menos el defecto de calorías." : "Bandas simétricas alrededor de tu objetivo."
            Text(store.tr("Tus márgenes de cumplimiento se ajustan solos a este régimen.") + " " + store.tr(nuance))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
            targetInput(store.tr("Nombre de fase"), text: $draft.label, placeholder: store.tr("p. ej. Bulk único"))
            targetDateField(store.tr("Aplica desde"), selection: $draft.date)
            targetInput(store.tr("Descripción"), text: $draft.description, placeholder: store.tr("Objetivo de la fase"))
        }
    }

    private var pattern: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Toca cada día para asignarlo a un tipo. Un tipo sin días se descarta.")).foregroundStyle(palette.text2)
            HStack(spacing: 6) {
                ForEach(orderedWeek, id: \.self) { dow in
                    Button { assignments[dow] = (assignments[dow] + 1) % 3 } label: {
                        VStack(spacing: 4) {
                            Text(shortWeekday(dow, language: store.lang)).font(.nutriMono(11)).foregroundStyle(palette.text2)
                            Circle().fill(colors[assignments[dow]]).frame(width: 10, height: 10)
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(NutriButtonStyle(.secondary, height: 52, horizontal: 0))
                }
            }
            wizardCaption("Tipos de día")
            ForEach(0..<3, id: \.self) { group in
                let count = days(group).count
                HStack(spacing: 8) {
                    Circle().fill(colors[group]).frame(width: 12, height: 12)
                    TextField(store.tr("Nombre del tipo de día"), text: $typeNames[group]).nutriInput()
                    Text("\(count) " + store.tr(count == 1 ? "día" : "días")).font(.nutriMono(11))
                        .foregroundStyle(palette.text3).frame(width: 62, alignment: .trailing)
                }.opacity(count == 0 ? 0.45 : 1)
            }
        }
    }

    private var specificDates: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Días que sustituyen a la fase (cumpleaños, día pico…). Opcional.")).foregroundStyle(palette.text2)
            ForEach($exceptions) { $exception in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        DatePicker(store.tr("Fecha"), selection: $exception.date, displayedComponents: .date)
                            .labelsHidden().frame(maxWidth: .infinity, alignment: .leading).nutriInput()
                        Button {
                            exceptions.removeAll { $0.id == exception.id }
                        } label: { NutriIcon("x", size: 16) }.buttonStyle(NutriButtonStyle(.secondary))
                            .accessibilityLabel(store.tr("Quitar"))
                    }
                    TextField(store.tr("p. ej. Cumpleaños"), text: $exception.label).nutriInput()
                    TargetFields(values: $exception.values, macrosOnly: true)
                }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
            }
            Button("+ " + store.tr("Añadir fecha especial")) { exceptions.append(WizardOverride()) }
                .buttonStyle(NutriButtonStyle(.secondary))
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(cleanText(draft.label).isEmpty ? store.tr("Sin nombre") : draft.label).font(.nutriDisplay(16))
                    if !draft.goal.isEmpty { TargetChip(text: goalName(draft.goal)) }
                }
                Text(store.tr("Aplica desde") + " " + targetDateLabel(Day.key(draft.date), lang: store.lang, withYear: true))
                    .font(.nutriMono(11.5)).foregroundStyle(palette.text3)
                if !draft.description.isEmpty { Text(draft.description).font(.nutriSans(12)).foregroundStyle(palette.text2) }
                if phaseConflict {
                    Text(store.tr("Sobrescribe la fase existente de esa fecha.")).font(.nutriSans(12)).foregroundStyle(palette.warn)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(12).nutriCard(radius: 12, fill: palette.surface2)
            wizardCaption("Tipos de día")
            ForEach(usedGroups, id: \.self) { group in
                VStack(alignment: .leading, spacing: 4) {
                    groupTitle(group)
                    let macros = [("kcal", ""), ("protein_g", "P "), ("carbs_g", "C "), ("fat_g", "G ")]
                    Text(macros.map { $0.1 + (values[group].point[$0.0].flatMap { $0.isEmpty ? nil : $0 } ?? "–") + ($0.0 == "kcal" ? " kcal" : "") }.joined(separator: " · "))
                        .font(.nutriMono(11.5)).foregroundStyle(palette.text2)
                }.padding(.horizontal, 12).padding(.vertical, 8).nutriCard(radius: 12, fill: palette.surface2)
            }
            VStack(alignment: .leading, spacing: 4) {
                wizardCaption("Agua y electrolitos")
                let water = sharedMicros.point["agua_ml"] ?? "–"
                let potassium = sharedMicros.point["potasio_mg"] ?? "–"
                let magnesium = sharedMicros.point["magnesio_mg"] ?? "–"
                Text(store.tr("Agua") + " \(water) ml · K \(potassium) mg · Mg \(magnesium) mg")
                    .font(.nutriMono(11.5)).foregroundStyle(palette.text2)
                let list = ceilings.compactMap { key, label in
                    sharedMicros.point[key].flatMap { $0.isEmpty ? nil : store.tr(label) + " " + $0 }
                }
                if !list.isEmpty { Text(store.tr("Techos") + ": " + list.joined(separator: " · ")).font(.nutriMono(11.5)).foregroundStyle(palette.text3) }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(12).nutriCard(radius: 12, fill: palette.surface2)
            if !exceptions.isEmpty {
                wizardCaption("Fechas especiales")
                ForEach(exceptions) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label.isEmpty ? store.tr("Sin motivo") : item.label).font(.nutriSans(12.5, weight: .medium))
                            Text(targetDateLabel(Day.key(item.date), lang: store.lang, withYear: true)).font(.nutriMono(11)).foregroundStyle(palette.text3)
                        }
                        Spacer()
                        Text((item.values.point["kcal"] ?? "–") + " kcal").font(.nutriMono(12)).foregroundStyle(palette.text2)
                    }.padding(.horizontal, 12).padding(.vertical, 8).nutriCard(radius: 12, fill: palette.surface2)
                }
            }
        }
    }

    private func days(_ group: Int) -> [Int] { orderedWeek.filter { assignments[$0] == group } }
    private func goalName(_ goal: String) -> String { store.tr(phaseGoals.first { $0.0 == goal }?.1 ?? goal) }
    private func wizardCaption(_ text: String) -> some View {
        Text(store.tr(text).uppercased()).font(.nutriSans(11, weight: .medium)).tracking(0.5).foregroundStyle(palette.text3)
    }

    private func groupTitle(_ group: Int) -> some View {
        HStack(spacing: 6) {
            Circle().fill(colors[group]).frame(width: 10, height: 10)
            Text(typeNames[group].isEmpty ? store.tr("Tipo de día") : typeNames[group]).font(.nutriSans(13, weight: .medium))
            Spacer()
            Text(days(group).map { shortWeekday($0, language: store.lang) }.joined(separator: " "))
                .font(.nutriMono(11)).foregroundStyle(palette.text3)
        }
    }

    private func sharedFields(_ entries: [(String, String)]) -> some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(entries, id: \.0) { key, title in
                TargetNumberField(key: key, label: title, goal: draft.goal, range: false, values: $sharedMicros)
            }
        }
    }

    private func setElectrolytes() {
        sharedMicros.point["agua_ml"] = draft.goal == "deficit" ? "3500" : draft.goal == "volumen" ? "3200" : "3000"
        sharedMicros.point["potasio_mg"] = draft.goal == "deficit" ? "3200" : "3000"
        sharedMicros.point["magnesio_mg"] = "350"
    }

    private func advance() {
        error = ""
        if step == 3 && !usedGroups.allSatisfy({ (Double(values[$0].point["kcal"] ?? "") ?? 0) > 0 }) {
            error = store.tr("Cada tipo de día necesita kcal mayores a 0.")
            return
        }
        step += 1
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
                saved = true
            } catch { self.error = error.localizedDescription }
        }
    }
}

private func normalizedRules(_ raw: Record) -> Record {
    var result: Record = [:]
    func iso(_ value: JSONValue?) -> JSONValue? {
        guard let text = value?.string, text.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        return value
    }
    for (key, kind) in [("transition", "coupled_band"), ("review", "energy_reference")] {
        let meta = raw.object(key)
        if meta.text("kind") == kind {
            var clean: Record = ["kind": .string(kind), "review_dates": .array(meta.array("review_dates").compactMap(iso))]
            clean["decision_date"] = iso(meta["decision_date"])
            if let version = meta["plan_version"]?.string { clean["plan_version"] = .string(version) }
            result[key] = .object(clean)
        }
    }
    for key in ["kcal_min", "kcal_max"] { result[key] = raw.number(key).map(JSONValue.number) }
    if !raw.text("paused_until").isEmpty { result["paused_until"] = raw["paused_until"] }
    result["items"] = .array(raw.array("items").compactMap { value in
        guard let row = value.object else { return nil }
        let kind = row.text("kind")
        guard ruleKinds.contains(where: { $0.0 == kind }) else { return nil }
        let fields = kind == "estancamiento" ? ["days"] : kind == "techo_peso" ? ["value"] : ["value", "weeks"]
        let id = row["id"]?.string ?? draftNumber(row.number("id"))
        var item: Record = ["id": .string(id), "kind": .string(kind), "auto": .bool(row["auto"]?.bool == true)]
        for field in fields {
            guard let number = row.number(field) else { return nil }
            item[field] = .number(number)
        }
        if kind != "techo_peso" {
            item["delta_carbs_g"] = row.number("delta_carbs_g").map(JSONValue.number)
            item["scope"] = row["scope"]?.array.map { values in
                .array(values.compactMap { raw in
                    guard let number = raw.number, number >= 0, number <= 6, number == floor(number) else { return nil }
                    return .number(number)
                })
            } ?? .null
        }
        return .object(item)
    })
    return result
}

struct PhaseProposal {
    let reason: String
    let rows: [Record]
}

func phaseProposal(targets: [Record], phase: [Record], body: [Record], totals: [Record], today: Date) -> PhaseProposal? {
    let phaseRows = phase.sorted { ($0.number("dow") ?? 8) < ($1.number("dow") ?? 8) }
    guard let first = phaseRows.first, let from = isoDate(first.text("valid_from")) else { return nil }
    let todayKey = Day.key(today)
    let config = normalizedRules(first.object("rules"))
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

    func round(_ value: Double, _ digits: Int) -> Double {
        let scale = pow(10.0, Double(digits))
        return floor(value * scale + 0.5) / scale
    }
    func signed(_ value: Double, _ digits: Int) -> String {
        let rounded = round(value, digits)
        return (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + draftNumber(abs(rounded))
    }

    func proposal(_ reason: String, id: String, delta: Double? = nil, maintenance: Double? = nil, scope: [JSONValue]? = nil) -> PhaseProposal? {
        var changed = false
        let tomorrow = Day.key(addingDays(1, to: today))
        let rows = phaseRows.map { source -> Record in
            var row = source
            row["valid_from"] = .string(tomorrow)
            row["id"] = nil
            row["created_at"] = nil
            row["applied_rule"] = .string(id + " · " + reason)
            if let maintenance {
                let old = row.number("kcal")
                changed = changed || old != maintenance
                row["kcal"] = .number(maintenance)
                row["goal"] = .string("mantenimiento")
                if let carbs = row.number("carbs_g"), let old {
                    row["carbs_g"] = .number(round(carbs + round((maintenance - old) / 4, 2), 2))
                }
            } else if let delta, let kcal = row.number("kcal"), let carbs = row.number("carbs_g"),
                      scope == nil || scope?.compactMap(\.number).contains(row.number("dow") ?? -1) == true {
                var next = round(kcal + 4 * delta, 1)
                if let min = config.number("kcal_min") { next = max(next, min) }
                if let max = config.number("kcal_max") { next = Swift.min(next, max) }
                changed = changed || next != kcal
                row["kcal"] = .number(next)
                row["carbs_g"] = .number(round(carbs + (next - kcal) / 4, 2))
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
                    return PhaseProposal(reason: "\(signed(percent, 2)) %/sem · Revisar el plan y elevar la ingesta; la banda necesita revisión.", rows: [])
                }
                if let result = proposal("\(signed(percent, 2)) %/sem × 2 sem · +25 g carbs", id: "proteccion-ritmo", delta: 25) { return result }
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
            let maintenance = round((consumed.reduce(0, +) / Double(consumed.count) - (current - past) / 2 * 1100) / 10, 0) * 10
            if let result = proposal("techo de peso alcanzado · mantenimiento \(draftNumber(maintenance)) kcal", id: item.text("id"), maintenance: maintenance) { return result }
            continue
        }
        guard let delta = item.number("delta_carbs_g"), adhered(window) else { continue }
        let reason: String
        if kind == "estancamiento" {
            guard current <= past + 0.1 else { continue }
            reason = "estancamiento \(draftNumber(days)) días"
        } else {
            guard let threshold else { continue }
            let rate = (current - past) / weeks
            guard (kind == "ritmo_alto" && rate > threshold) || (kind == "ritmo_lento" && -rate < threshold) else { continue }
            reason = "\(signed(rate, 2)) kg/sem × \(draftNumber(weeks)) sem"
        }
        let text = "\(reason) · \(signed(delta, 0)) g carbs"
        if let result = proposal(text, id: item.text("id"), delta: delta, scope: item["scope"]?.array) { return result }
    }
    return nil
}


#if DEBUG
func checkTargetParity() throws {
    let first = TargetValues(["kcal": .number(2200), "bounds": .object(["kcal": .object(["min": .number(2100)])])])
    let rest = TargetValues(["kcal": .number(2200), "bounds": .object(["kcal": .object(["min": .number(2000)])])])
    var week = Array(repeating: first, count: 7)
    week[6] = rest
    week[0] = rest
    guard weekGroups(week) == [[1, 2, 3, 4, 5], [6, 0]], weekLabels([6, 0], language: "es") == ["SÁB – DOM"] else {
        throw FeatureError("Module check failed · web weekday grouping and contiguous chips")
    }
    let rules = normalizedRules([
        "transition": .object(["kind": .string("coupled_band"), "review_dates": .array([.string("2026-11-16"), .string("invalid")]),
                               "plan_version": .string("approved")]),
        "items": .array([
            .object(["id": .number(7), "kind": .string("ritmo_alto"), "weeks": .number(2), "value": .number(0.3),
                     "delta_carbs_g": .number(-25), "scope": .array([.string("1"), .number(4), .number(8)])]),
            .object(["kind": .string("ritmo_lento"), "weeks": .number(2)])
        ])
    ])
    let cleaned = rules.array("items").first?.object
    guard rules.object("transition").array("review_dates") == [.string("2026-11-16")],
          cleaned?.text("id") == "7", cleaned?.array("scope") == [.number(1), .number(4)],
          rules.array("items").count == 1 else {
        throw FeatureError("Module check failed · web rule cleanup and declared transition")
    }
}
#endif
