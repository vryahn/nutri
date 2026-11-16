import AppKit
import Charts
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

private let dashboardPresets = [("Hoy", 1), ("Semana", 7), ("Mes", 30), ("Trimestre", 90), ("Año", 365)]
private let macroKeys = Set(nutritionMacros.map(\.key))
private let dailyCeilings = Set(["grasa_sat_g", "grasa_trans_g", "azucar_anadido_g", "alcohol_g", "colesterol_mg"])
private let dashboardGoals = [("deficit", "Déficit"), ("volumen", "Volumen"), ("recomposicion", "Recomposición"), ("mantenimiento", "Mantenimiento")]

private struct DashboardVariable: Identifiable {
    let id: String
    let label: String
    let unit: String
    let source: Source
    enum Source { case macro, micro, body, derived }
    var stock: Bool { source == .body || source == .derived }

    static let nutrition = nutritionMacros.map { Self(id: $0.key, label: $0.label, unit: $0.unit, source: .macro) } +
        Domain.micros.filter { $0.key != "agua_ml" }.map { Self(id: $0.key, label: $0.label, unit: $0.unit, source: .micro) }
    static let all = nutrition + BodyMetric.fields.filter { $0.key != "sueno_corto" }.map {
        Self(id: $0.key, label: $0.label, unit: $0.unit, source: .body)
    } + BodyMetric.derived.map { Self(id: $0.key, label: $0.label, unit: $0.unit, source: .derived) }

    func observed(on day: DashboardDay, body: Record, height: Double?) -> Double? {
        switch source {
        case .macro: day.registered ? day.total.number(id) : nil
        case .micro: day.registered && day.coverage(id) == .complete ? nutritionValue(day.total, id) : nil
        case .body: body.number(id)
        case .derived: derivedBody(body, heightCm: height).number(id)
        }
    }
}

enum DashboardCalculation: String, CaseIterable, Identifiable {
    case average, sum, median, standardDeviation, trend, bayes
    var id: String { rawValue }
    var label: String {
        switch self {
        case .average: "Promedio"
        case .sum: "Suma"
        case .median: "Mediana + IQR"
        case .standardDeviation: "Desv. estándar + CV"
        case .trend: "Tendencia"
        case .bayes: "Adherencia bayesiana"
        }
    }

    var minimum: Int {
        switch self {
        case .average, .sum: 1
        case .standardDeviation: 2
        case .median, .trend, .bayes: 3
        }
    }
}

private enum DayCompleteness {
    case missing, partial, complete, unknown
    var label: String {
        switch self {
        case .missing: "Sin registro"
        case .partial: "Incompleto"
        case .complete: "Completo"
        case .unknown: "Sin evaluar"
        }
    }
    var color: Color {
        switch self {
        case .missing: .secondary.opacity(0.18)
        case .partial: .orange
        case .complete: .teal
        case .unknown: .secondary
        }
    }
}

private struct DashboardDay: Identifiable {
    var id: String { Day.key(date) }
    let date: Date
    let offset: Int
    let total: Record
    let target: Record?
    let completeness: DayCompleteness
    var registered: Bool { (total.number("kcal") ?? 0) > 0 }
    func coverage(_ key: String) -> Domain.Coverage {
        if macroKeys.contains(key) {
            return total.number(key) == nil ? .unknown : .complete
        }
        return Domain.coverage(total, key)
    }
}

private struct DashboardPeriod: Equatable, Hashable {
    let windows: [ClosedRange<String>]
    var start: String { windows.first?.lowerBound ?? "" }
    var end: String { windows.last?.upperBound ?? "" }
    var union: Bool { windows.count > 1 }

    func contains(_ key: String) -> Bool { windows.contains { $0.contains(key) } }

    var dates: [Date] {
        guard let startDate = isoDate(start), let endDate = isoDate(end) else { return [] }
        let n = Calendar.current.dateComponents([.day], from: startDate, to: endDate).day ?? -1
        guard (0...1830).contains(n) else { return [] }
        return (0...n).map { addingDays($0, to: startDate) }.filter { contains(Day.key($0)) }
    }

    var prior: DashboardPeriod? {
        guard !union, let date = isoDate(start) else { return nil }
        let previousEnd = Day.key(addingDays(-1, to: date))
        let previousStart = Day.key(addingDays(-dates.count, to: date))
        return Self(windows: [previousStart...previousEnd])
    }
}

private struct DashboardPhase: Identifiable {
    var id: String { range.lowerBound }
    let range: ClosedRange<String>
    let label: String
    let goal: String

    static func list(_ targets: [Record], end: String) -> [Self] {
        let rows = targets.filter { $0.number("dow") != nil && isoDate($0.text("valid_from")) != nil }
        let groups = Dictionary(grouping: rows) { $0.text("valid_from") }
        let keys = groups.keys.sorted()
        return keys.enumerated().compactMap { index, start in
            guard start <= end, let rows = groups[start] else { return nil }
            let next = index + 1 < keys.count ? isoDate(keys[index + 1]) : nil
            let phaseEnd = next.map { min(end, Day.key(addingDays(-1, to: $0))) } ?? end
            guard start <= phaseEnd else { return nil }
            return Self(range: start...phaseEnd, label: rows.first(where: { !$0.text("label").isEmpty })?.text("label") ?? start,
                        goal: rows.first(where: { !$0.text("goal").isEmpty })?.text("goal") ?? "")
        }
    }
}

private struct DashboardSnapshot {
    let period: DashboardPeriod
    let entries: [Record]
    let days: [DashboardDay]
    let previous: [Record]
    let body: [String: Record]
    let advanced: [DashboardDay]

    var logged: [DashboardDay] { days.filter(\.registered) }
    var complete: [DashboardDay] { days.filter { $0.registered && $0.completeness != .partial } }

    init(period: DashboardPeriod, entries: [Record], totals: [Record], prior: [Record], weights: [Record], history: [Record], targets: [Record], phases: [DashboardPhase]) {
        self.period = period
        self.entries = entries.filter { period.contains($0.text("day")) }
        previous = prior.filter { ($0.number("kcal") ?? 0) > 0 }
        body = Dictionary(weights.map { ($0.text("day"), $0.object("metrics")) }, uniquingKeysWith: { first, _ in first })
        let totalsByDay = Dictionary(totals.map { ($0.text("day"), $0) }, uniquingKeysWith: { first, _ in first })
        let entriesByDay = Dictionary(grouping: self.entries) { $0.text("day") }
        let historyKcals = history.compactMap { $0.number("kcal") }.filter { $0 > 0 }
        let historyMedian = historyKcals.count >= 7 ? dashboardQuantile(historyKcals, 0.5) : nil
        let mealsByDay = entriesByDay.mapValues { rows in Set(rows.map { $0.text("meal") }).count }
        let mealMedian = dashboardQuantile(totals.filter { period.contains($0.text("day")) && ($0.number("kcal") ?? 0) > 0 }
            .map { Double(mealsByDay[$0.text("day")] ?? 0) }, 0.5) ?? 0
        let start = isoDate(period.start)
        days = period.dates.map { date in
            let key = Day.key(date)
            let target = Domain.resolveTarget(targets, key)
            let row = totalsByDay[key] ?? [:]
            let kcal = row.number("kcal") ?? 0
            let completeness: DayCompleteness
            if kcal <= 0 { completeness = .missing }
            else if kcal < 500 { completeness = .partial }
            else if let historyMedian {
                let mealWarning = mealMedian >= 3 && (mealsByDay[key] ?? 0) <= 1
                completeness = !mealWarning && kcal >= 0.6 * historyMedian ? .complete : .partial
            } else if let kcalTarget = target?.number("kcal") {
                completeness = kcal >= 0.6 * kcalTarget ? .complete : .partial
            } else { completeness = .unknown }
            let offset = start.flatMap { Calendar.current.dateComponents([.day], from: $0, to: date).day } ?? 0
            return DashboardDay(date: date, offset: offset, total: row, target: target, completeness: completeness)
        }
        let intersected = phases.filter { phase in period.windows.contains { $0.overlaps(phase.range) } }
        if !period.union, intersected.count > 1, let last = intersected.last {
            advanced = days.filter { last.range.contains($0.id) && $0.registered && $0.completeness != .partial }
        } else {
            advanced = days.filter { $0.registered && $0.completeness != .partial }
        }
    }

    func enabled(_ mode: DashboardCalculation) -> Bool {
        switch mode {
        case .average, .sum: return !logged.isEmpty
        case .bayes:
            return complete.count >= 3 && complete.contains { $0.target != nil }
        default: return advanced.count >= mode.minimum
        }
    }
}

private struct DashboardSummary: Identifiable {
    var id: String { variable.id }
    let variable: DashboardVariable
    let value: Double?
    let detail: String
    let objective: Double?
    let ratio: Double?
    let coverage: Domain.Coverage
    let status: Domain.Adherence?
    let delta: Double?
    let percent: Bool
    let objectiveRange: String

    var display: String {
        guard let value else { return "" }
        return "\(numberText(value)) \(percent ? "%" : variable.unit)"
    }
}

func dashboardQuantile(_ values: [Double], _ fraction: Double) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    let index = Double(sorted.count - 1) * fraction
    let lo = Int(index.rounded(.down)), hi = Int(index.rounded(.up))
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - Double(lo))
}

private func mean(_ values: [Double]) -> Double? {
    values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
}

private func sampleDeviation(_ values: [Double]) -> Double? {
    guard values.count >= 2, let average = mean(values) else { return nil }
    return sqrt(values.reduce(0) { $0 + pow($1 - average, 2) } / Double(values.count - 1))
}

private func slope(_ points: [(Double, Double)]) -> Double? {
    guard points.count >= 2, let x = mean(points.map(\.0)), let y = mean(points.map(\.1)) else { return nil }
    let variance = points.reduce(0) { $0 + pow($1.0 - x, 2) }
    guard variance > 0 else { return 0 }
    return points.reduce(0) { $0 + ($1.0 - x) * ($1.1 - y) } / variance
}

func dashboardPosterior(successes: Int, count: Int) -> (mean: Double, low: Double, high: Double) {
    // Beta(1+s, 1+n-s) CDF equals the right tail of Binomial(n+1, x).
    let a = successes + 1
    let n = count + 1
    var logFactorial = [0.0]
    for index in 1...n { logFactorial.append(logFactorial[index - 1] + log(Double(index))) }
    let coefficients = (a...n).map { logFactorial[n] - logFactorial[$0] - logFactorial[n - $0] }
    func inverse(_ probability: Double) -> Double {
        var low = 0.0
        var high = 1.0
        for _ in 0..<45 {
            let mid = (low + high) / 2
            let logX = log(mid)
            let logRest = log1p(-mid)
            let cdf = coefficients.enumerated().reduce(0.0) { sum, pair in
                let k = a + pair.offset
                return sum + exp(pair.element + Double(k) * logX + Double(n - k) * logRest)
            }
            if cdf < probability { low = mid } else { high = mid }
        }
        return (low + high) / 2
    }
    return (Double(a) / Double(count + 2), inverse(0.025), inverse(0.975))
}

private func dashboardSummary(_ variable: DashboardVariable, mode: DashboardCalculation, data: DashboardSnapshot, bands: Record) -> DashboardSummary {
    let key = variable.id
    let registered = data.logged
    let values = registered.compactMap { nutritionValue($0.total, key) }
    let coverage: Domain.Coverage = values.isEmpty ? .unknown : registered.allSatisfy { $0.coverage(key) == .complete } ? .complete : .partial
    let advanced = data.advanced.compactMap { day -> (Double, Double)? in
        guard day.coverage(key) == .complete, let value = nutritionValue(day.total, key) else { return nil }
        return (Double(day.offset), value)
    }
    let observed = advanced.map(\.1)
    let points = data.days.compactMap { $0.target.flatMap { nutritionValue($0, key) } }
    let defined = data.days.compactMap(\.target)
    func periodLimit(_ edge: String) -> Double? {
        let values = defined.compactMap { $0.object("bounds").object(key).number(edge) }
        if key == "sodio_mg" {
            return edge == "min" ? Domain.sodiumFloor : values.count == defined.count ? mean(values) ?? Domain.sodiumCeiling : Domain.sodiumCeiling
        }
        return values.count == defined.count ? mean(values) : nil
    }
    let multiplier = mode == .sum ? Double(key == "sodio_mg" ? registered.count : defined.count) : 1
    let lower = periodLimit("min").map { $0 * multiplier }
    let upper = periodLimit("max").map { $0 * multiplier }
    let rangeLabel = [lower.map { "≥ \(numberText($0))" }, upper.map { "≤ \(numberText($0))" }].compactMap { $0 }.joined(separator: " · ")
    var value: Double?
    var score = ""
    var objective: Double?
    var delta: Double?
    var status: Domain.Adherence?
    var ratio: Double?

    switch mode {
    case .sum:
        value = values.isEmpty ? nil : values.reduce(0, +)
        objective = points.isEmpty ? nil : points.reduce(0, +)
    case .average:
        value = mean(values)
        objective = mean(points)
    case .median:
        if observed.count >= 3 {
            value = dashboardQuantile(observed, 0.5)
            score = "P25–P75 \(numberText(dashboardQuantile(observed, 0.25)))–\(numberText(dashboardQuantile(observed, 0.75)))"
        }
        objective = dashboardQuantile(points, 0.5)
    case .standardDeviation:
        value = sampleDeviation(observed)
        if let value, let average = mean(observed), average > 0 { score = "CV \(numberText(100 * value / average, digits: 0))%" }
    case .trend:
        if advanced.count >= 3 { value = slope(advanced); score = "\(variable.unit)/día" }
    case .bayes:
        objective = mean(points)
        if coverage == .complete {
            let passes = data.complete.compactMap { day -> Bool? in
                guard let actual = nutritionValue(day.total, key), day.coverage(key) == .complete else { return nil }
                let bounds = day.target?.object("bounds").object(key) ?? [:]
                if key == "sodio_mg" || bounds.number("min") != nil || bounds.number("max") != nil {
                    return Domain.classify(key, value: actual, target: day.target, bands: bands) == .ok
                }
                guard let target = day.target.flatMap({ nutritionValue($0, key) }) else { return nil }
                if ["kcal", "carbs_g", "fat_g"].contains(key) { return target > 0 ? abs(actual - target) / target <= 0.1 : actual == 0 }
                return dailyCeilings.contains(key) ? actual <= target : actual >= target
            }
            if passes.count >= 3 {
                let posterior = dashboardPosterior(successes: passes.filter { $0 }.count, count: passes.count)
                value = posterior.mean * 100
                score = "IC95 \(numberText(100 * posterior.low, digits: 0))–\(numberText(100 * posterior.high, digits: 0))% · n=\(passes.count)"
            }
        }
    }

    if mode == .sum || mode == .average {
        let previous = data.previous.compactMap { nutritionValue($0, key) }
        if coverage == .complete, !data.period.union, !previous.isEmpty, let value,
           macroKeys.contains(key) || data.previous.allSatisfy({ Domain.coverage($0, key) == .complete }) {
            let prior = mode == .sum ? previous.reduce(0, +) : mean(previous) ?? 0
            if prior > 0 { delta = 100 * (value - prior) / prior }
        }
    }
    if coverage == .complete, let value, mode == .average || mode == .sum || mode == .median {
        if let objective, objective > 0 { ratio = 100 * value / objective }
        var reference: Record = [:]
        if let goal = data.days.last?.target?["goal"] { reference["goal"] = goal }
        if let objective {
            if macroKeys.contains(key) { reference[key] = .number(objective) }
            else { reference["micros"] = .object([key: .number(objective)]) }
        }
        var limits: Record = [:]
        limits["min"] = lower.map(JSONValue.number)
        limits["max"] = upper.map(JSONValue.number)
        if !limits.isEmpty { reference["bounds"] = .object([key: .object(limits)]) }
        status = Domain.classify(key, value: value, target: reference, bands: bands)
    }
    return DashboardSummary(variable: variable, value: value, detail: score, objective: objective, ratio: ratio,
                            coverage: coverage, status: status, delta: delta, percent: mode == .bayes, objectiveRange: rangeLabel)
}

private struct SavedDashboardRange: Codable, Identifiable {
    var id = UUID()
    var name: String
    var start: String
    var end: String?
}

struct DashboardView: View {
    @EnvironmentObject private var store: Store
    @AppStorage("nutri.dashboard.calculation") private var calculation = DashboardCalculation.average
    @AppStorage("nutri.dashboard.trend") private var trendKey = "protein_g"
    @State private var preset = "Semana"
    @State private var phaseSelection = "current"
    @State private var start = addingDays(-7, to: Date())
    @State private var end = addingDays(-1, to: Date())
    @State private var rollingEnd = false
    @State private var rangeName = ""
    @State private var ranges: [SavedDashboardRange] = []
    @State private var activeRange: UUID?
    @State private var targets: [Record] = []
    @State private var snapshot: DashboardSnapshot?
    @State private var loading = true
    @State private var failure = ""
    @State private var refreshKey = UUID()
    @State private var topMetric = "kcal"
    @State private var tab = "standard"
    @State private var microFilter = ""
    @State private var showOtherMicros = false
    @State private var chartDraft: DashboardChartDraft?
    @State private var ask = false

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private var closed: Date { addingDays(-1, to: today) }
    private var phases: [DashboardPhase] { DashboardPhase.list(targets, end: Day.key(closed)) }
    private var selectedPhases: [DashboardPhase] {
        if phaseSelection == "current" { return phases.suffix(1).map { $0 } }
        if phaseSelection == "previous" { return phases.dropLast().suffix(1).map { $0 } }
        if phaseSelection.hasPrefix("goal:") { return phases.filter { $0.goal == String(phaseSelection.dropFirst(5)) } }
        return phases.filter { $0.id == phaseSelection }
    }
    private var period: DashboardPeriod {
        if preset == "Fase" { return DashboardPeriod(windows: selectedPhases.map(\.range)) }
        let lower: String
        let upper: String
        if preset == "Personalizado" {
            lower = Day.key(start)
            upper = Day.key(rollingEnd ? closed : min(end, closed))
        } else {
            let anchor = preset == "Hoy" ? today : closed
            let count = dashboardPresets.first { $0.0 == preset }?.1 ?? 7
            lower = Day.key(addingDays(1 - count, to: anchor))
            upper = Day.key(anchor)
        }
        return DashboardPeriod(windows: lower <= upper ? [lower...upper] : [])
    }
    private var request: String {
        period.windows.map { "\($0.lowerBound):\($0.upperBound)" }.joined(separator: "|") + refreshKey.uuidString
    }
    private var data: DashboardSnapshot? { snapshot?.period == period ? snapshot : nil }
    private var bands: Record { store.prefs.object("adherence_bands") }
    private var dashboardRows: [Record] { store.prefs.array("dashboards").compactMap(\.object) }
    private var favorites: [String] { store.prefs.array("fav_micros").compactMap(\.string) }
    private var waterFoodID: String { store.prefs.text("water_food_id") }
    private var height: Double? { store.prefs.object("profile").number("height_cm") }
    private var activeCalculation: DashboardCalculation {
        guard let data, data.enabled(calculation) else { return .average }
        return calculation
    }
    private var trend: DashboardVariable {
        DashboardVariable.nutrition.first { $0.id == trendKey } ?? DashboardVariable.nutrition[1]
    }
    private var rangeStorageKey: String { "nutri.dashboard.ranges." + (store.owner ?? "none") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                rangeInputs
                if loading { ProgressView().controlSize(.small) }
                if !failure.isEmpty {
                    HStack {
                        Text(failure).foregroundStyle(.red)
                        Button(store.tr("Reintentar")) { refreshKey = UUID() }
                    }
                }
                if let data {
                    if data.logged.isEmpty {
                        Text(store.tr("Sin registros de alimentos en el periodo")).foregroundStyle(.secondary)
                    }
                    Picker(store.tr("Vista"), selection: $tab) {
                        Text(store.tr("Resumen")).tag("standard")
                        Text(store.tr("Mis gráficas")).tag("charts")
                    }.pickerStyle(.segmented).labelsHidden()
                    if tab == "charts" { customCharts(data) }
                    else { overview(data) }
                }
            }.padding(24)
        }
        .task(id: store.owner) {
            if let raw = UserDefaults.standard.data(forKey: rangeStorageKey),
               let saved = try? JSONDecoder().decode([SavedDashboardRange].self, from: raw) { ranges = saved }
            do { targets = try await store.read("targets") }
            catch { if !Task.isCancelled { store.report(error) } }
        }
        .task(id: request) { await reload(period) }
        .sheet(isPresented: $ask) { AskLogView(targets: targets) }
        .sheet(item: $chartDraft) { draft in
            DashboardChartEditor(draft: draft) { record in
                var updated = dashboardRows
                if let index = updated.firstIndex(where: { $0.text("id") == record.text("id") }) { updated[index] = record }
                else { updated.append(record) }
                try await saveCharts(updated)
                chartDraft = nil
            }
        }
    }

    private var header: some View {
        HStack {
            Text(store.tr("Dashboard")).font(.largeTitle.bold())
            Spacer()
            Button(store.tr("Preguntar"), systemImage: "bubble.left.and.text.bubble.right") { ask = true }
            Menu(store.tr("Exportar"), systemImage: "square.and.arrow.up") {
                Button(store.tr("Registros día por día (CSV)")) { export(.entries) }
                    .disabled(data?.entries.isEmpty != false)
                Button(store.tr("Resumen del periodo (CSV)")) { export(.summary) }
                Button(store.tr("Informe del periodo (PDF)")) { export(.report) }
            }.disabled(data == nil)
        }
    }

    private var rangeInputs: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Picker(store.tr("Periodo"), selection: $preset) {
                        ForEach(dashboardPresets, id: \.0) { name, _ in Text(store.tr(name)).tag(name) }
                        Text(store.tr("Fase")).tag("Fase")
                        Text(store.tr("Personalizado")).tag("Personalizado")
                    }.frame(maxWidth: 260)
                    if !period.start.isEmpty { Text("\(period.start) – \(period.end)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
                    Spacer()
                }
                if preset == "Personalizado" {
                    HStack {
                        DatePicker(store.tr("Desde"), selection: $start, displayedComponents: .date)
                        DatePicker(store.tr("Hasta"), selection: $end, displayedComponents: .date).disabled(rollingEnd)
                        Toggle(store.tr("Hasta hoy"), isOn: $rollingEnd)
                    }
                    HStack {
                        TextField(store.tr("Nombre del periodo"), text: $rangeName).textFieldStyle(.roundedBorder).frame(maxWidth: 240)
                        Button(store.tr("Guardar periodo")) { saveRange() }.disabled(period.dates.isEmpty)
                        Menu(store.tr("Periodos guardados")) {
                            ForEach(ranges) { range in
                                Button(range.name.isEmpty ? "\(range.start) – \(range.end ?? store.tr("Hasta hoy"))" : range.name) { applyRange(range) }
                            }
                            if ranges.isEmpty { Text(store.tr("Sin periodos guardados")) }
                        }
                        if activeRange != nil {
                            Button(store.tr("Nuevo periodo")) { activeRange = nil; rangeName = "" }
                            Button(store.tr("Eliminar periodo"), role: .destructive) { removeRange() }
                        }
                    }
                }
                if preset == "Fase" {
                    Picker(store.tr("Fase"), selection: $phaseSelection) {
                        Text(store.tr("Fase actual")).tag("current")
                        Text(store.tr("Fase previa")).tag("previous")
                        ForEach(phases.reversed()) { phase in Text(phase.label + " · " + phase.id).tag(phase.id) }
                        ForEach(dashboardGoals, id: \.0) { key, label in
                            if phases.contains(where: { $0.goal == key }) { Text(store.tr(label)).tag("goal:" + key) }
                        }
                    }.frame(maxWidth: 520)
                }
                if preset == "Personalizado" && (rollingEnd || end >= today) {
                    Text(store.tr("El periodo termina ayer para usar días cerrados.")).font(.caption).foregroundStyle(.secondary)
                }
            }.padding(4)
        }
    }

    private func overview(_ data: DashboardSnapshot) -> some View {
        let mode = activeCalculation
        let macros = DashboardVariable.nutrition.prefix(4).map { dashboardSummary($0, mode: mode, data: data, bands: bands) }
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Picker(store.tr("Cálculo"), selection: $calculation) {
                    ForEach(DashboardCalculation.allCases) { item in
                        Text(store.tr(item.label) + (data.enabled(item) ? "" : " · " + store.tr("datos insuficientes")))
                            .tag(item).disabled(!data.enabled(item))
                    }
                }.frame(maxWidth: 350)
                Text("\(data.logged.count)/\(data.days.count) \(store.tr("días registrados")) · \(data.complete.count) \(store.tr("completos"))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            HStack(alignment: .top, spacing: 10) {
                ForEach(macros) { row in
                    GroupBox {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(store.tr(row.variable.label)).font(.caption).foregroundStyle(.secondary)
                            Text(row.display.isEmpty ? store.tr("Sin datos") : row.display).font(.title3.bold()).monospacedDigit()
                                .foregroundStyle(adherenceColor(row.status))
                            if !row.detail.isEmpty { Text(row.detail).font(.caption).foregroundStyle(.secondary) }
                            if let delta = row.delta { Text("\(delta >= 0 ? "+" : "")\(numberText(delta, digits: 1))% · \(store.tr("periodo previo"))").font(.caption) }
                            if !row.objectiveRange.isEmpty { Text(row.objectiveRange).font(.caption).foregroundStyle(.secondary) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(4)
                    }
                }
            }
            waterAndSodium(data)
            if data.advanced.count < data.complete.count {
                Text(store.tr("Las estadísticas avanzadas descriptivas usan la última fase del periodo."))
                    .font(.caption).foregroundStyle(.secondary)
            }
            heatmap(data)
            GroupBox(store.tr("Kcal por día")) { DashboardEnergyPlot(days: data.days).padding(5) }
            macroDistribution(data)
            nutrientFootprint(data)
            trendPanel(data)
            weeklyProtein(data)
            sodiumTrend(data)
            topFoods(data)
            micronutrients(data)
        }
    }

    private func waterAndSodium(_ data: DashboardSnapshot) -> some View {
        let observed = data.days.filter { !$0.total.isEmpty }
        let water = observed.compactMap { nutritionValue($0.total, "agua_ml") }
        let partial = observed.contains { $0.coverage("agua_ml") != .complete }
        let simple = data.entries.filter { !waterFoodID.isEmpty && $0.text("food_id") == waterFoodID }
        let simpleTotal = simple.compactMap { $0.number("grams") }.reduce(0, +)
        let sodium = dashboardSummary(DashboardVariable(id: "sodio_mg", label: "Sodio", unit: "mg", source: .micro), mode: .average, data: data, bands: bands)
        return GroupBox {
            VStack(alignment: .leading, spacing: 5) {
                LabeledContent(store.tr("Agua simple registrada"), value: waterFoodID.isEmpty ? store.tr("Agua simple sin configurar") :
                               simple.isEmpty ? store.tr("Sin registro") : formatWater(simpleTotal))
                LabeledContent(store.tr("Agua total observada"), value: water.isEmpty ? store.tr("Sin datos") :
                               formatWater(water.reduce(0, +)) + (partial ? " · " + store.tr("Datos parciales") : ""))
                if sodium.coverage == .complete, let value = sodium.value, value < Domain.sodiumFloor {
                    Label("\(store.tr("Sodio promedio")) < \(numberText(Domain.sodiumFloor, digits: 0)) mg", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                } else if sodium.coverage == .complete, sodium.status == .danger, let value = sodium.value {
                    Label("\(store.tr("Sodio promedio")) · \(numberText(value)) mg", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                } else if sodium.coverage == .partial {
                    Text(store.tr("Sodio · datos parciales")).foregroundStyle(.orange)
                }
            }.padding(5)
        }
    }

    private func formatWater(_ ml: Double) -> String {
        store.units == "us" ? "\(numberText(ml / Domain.mlPerFluidOunce)) fl oz" : "\(numberText(ml)) ml"
    }

    private func heatmap(_ data: DashboardSnapshot) -> some View {
        GroupBox(store.tr("Registro por día")) {
            VStack(alignment: .leading, spacing: 8) {
                ScrollView(.horizontal) {
                    DashboardHeatmap(days: data.days, bands: bands, square: 15, spacing: 4, translate: store.tr)
                        .padding(2)
                }
                Text(store.tr("Pasa el puntero sobre un día para ver su estado.")).font(.caption).foregroundStyle(.secondary)
            }.padding(5)
        }
    }

    private func trendPanel(_ data: DashboardSnapshot) -> some View {
        GroupBox(store.tr("Tendencia por nutriente")) {
            VStack(alignment: .leading, spacing: 8) {
                Picker(store.tr("Nutriente"), selection: $trendKey) {
                    ForEach(DashboardVariable.nutrition) { variable in Text(store.tr(variable.label)).tag(variable.id) }
                }.frame(maxWidth: 310)
                let spec = DashboardChartDraft(title: "", type: "line", variables: [trendKey], aggregation: "dia", reducer: "promedio")
                DashboardPlot(definition: spec, data: data, heightCm: height)
            }.padding(4)
        }
    }

    private func macroDistribution(_ data: DashboardSnapshot) -> some View {
        GroupBox(store.tr("Distribución de macros (kcal)")) {
            let factors = [("protein_g", "Proteína", 4.0), ("carbs_g", "Carbohidratos", 4.0), ("fat_g", "Grasa", 9.0)]
            if data.logged.isEmpty {
                Text(store.tr("Sin registros en el rango")).foregroundStyle(.secondary).padding(5)
            } else if data.logged.count < 3 {
                let summary = factors.map { key, label, factor in
                    (store.tr(label), data.logged.compactMap { $0.total.number(key) }.reduce(0, +) * factor)
                }
                let total = summary.map(\.1).reduce(0, +)
                if total > 0 {
                    VStack(alignment: .leading, spacing: 8) {
                        Chart(summary.indices, id: \.self) { index in
                            BarMark(x: .value("kcal", summary[index].1), y: .value("Periodo", store.tr("Periodo")))
                                .foregroundStyle(by: .value("Macro", summary[index].0))
                        }.chartYAxis(.hidden).chartXAxis(.hidden).frame(height: 66)
                        Text(summary.map { "\($0.0) \(numberText(100 * $0.1 / total, digits: 0))%" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(5)
                } else {
                    Text(store.tr("Sin datos de macros")).foregroundStyle(.secondary).padding(5)
                }
            } else {
                Chart {
                    ForEach(data.logged) { day in
                        ForEach(factors, id: \.0) { key, label, factor in
                            if let value = day.total.number(key) {
                                BarMark(x: .value("Fecha", day.date), y: .value("kcal", value * factor))
                                    .foregroundStyle(by: .value("Macro", store.tr(label)))
                            }
                        }
                    }
                }.frame(height: 180).padding(5)
            }
        }
    }

    private func nutrientFootprint(_ data: DashboardSnapshot) -> some View {
        let favorites = Set(DashboardVariable.nutrition.filter { $0.source == .micro }.prefix(8).map(\.id)).union(favorites)
        let points = DashboardVariable.nutrition.filter { favorites.contains($0.id) }.compactMap { item -> (String, Double)? in
            let score = dashboardSummary(item, mode: .average, data: data, bands: bands)
            return score.ratio.map { (store.tr(item.label), $0) }
        }
        return GroupBox(store.tr("Huella nutricional (micros vs. objetivo)")) {
            if points.isEmpty {
                Text(store.tr("Faltan objetivos o cobertura completa")).foregroundStyle(.secondary).padding(5)
            } else {
                Chart {
                    RuleMark(x: .value("Objetivo", 100)).foregroundStyle(Color.teal).lineStyle(StrokeStyle(dash: [4, 3]))
                    ForEach(points.indices, id: \.self) { index in
                        BarMark(x: .value("%", points[index].1), y: .value("Nutriente", points[index].0))
                            .foregroundStyle(Color.blue.opacity(0.75))
                            .accessibilityLabel(points[index].0)
                            .accessibilityValue("\(numberText(points[index].1, digits: 0))%")
                    }
                }.frame(height: max(130, CGFloat(points.count) * 23)).padding(5)
            }
        }
    }

    private func sodiumTrend(_ data: DashboardSnapshot) -> some View {
        let spec = DashboardChartDraft(title: "", type: "line", variables: ["sodio_mg"], aggregation: "dia", reducer: "promedio")
        return GroupBox(store.tr("Sodio diario vs piso y techo")) {
            DashboardPlot(definition: spec, data: data, heightCm: height).padding(4)
        }
    }

    private func weeklyProtein(_ data: DashboardSnapshot) -> some View {
        let spec = DashboardChartDraft(title: "", type: "bar", variables: ["protein_g"], aggregation: "semana", reducer: "promedio")
        return GroupBox(store.tr("Proteína semanal")) {
            DashboardPlot(definition: spec, data: data, heightCm: height).padding(4)
        }
    }

    private func topFoods(_ data: DashboardSnapshot) -> some View {
        let rows = data.entries.filter { waterFoodID.isEmpty || $0.text("food_id") != waterFoodID }
        let groups = Dictionary(grouping: rows) { $0.text("food_id").isEmpty ? $0.text("recipe_id") : $0.text("food_id") }
        let totals = groups.values.compactMap { entries -> (String, Double)? in
            guard let first = entries.first, !first.text("item").isEmpty else { return nil }
            let selected = entries.compactMap { $0.number(topMetric) }
            guard !selected.isEmpty else { return nil }
            return (first.text("item"), selected.reduce(0, +))
        }.sorted { $0.1 > $1.1 }
        let top = Array(totals.prefix(10))
        return GroupBox(store.tr("Alimentos principales")) {
            VStack(alignment: .leading, spacing: 8) {
                Picker(store.tr("Ordenar por"), selection: $topMetric) {
                    Text(store.tr("Energía")).tag("kcal")
                    Text(store.tr("Proteína")).tag("protein_g")
                }.frame(maxWidth: 230)
                if top.isEmpty {
                    Text(store.tr("Sin alimentos en el periodo")).foregroundStyle(.secondary)
                } else {
                    ForEach(top.indices, id: \.self) { index in
                        HStack {
                            Text(top[index].0).frame(minWidth: 130, idealWidth: 180, alignment: .leading).lineLimit(1)
                            ProgressView(value: top[index].1, total: max(1, top[0].1)).tint(.teal)
                            Text("\(numberText(top[index].1, digits: 1)) \(topMetric == "kcal" ? "kcal" : "g")").monospacedDigit()
                                .frame(minWidth: 100, alignment: .trailing)
                        }
                    }
                }
            }.padding(5)
        }
    }

    private func micronutrients(_ data: DashboardSnapshot) -> some View {
        let micros = DashboardVariable.nutrition.filter { $0.source == .micro }
        let defaultKeys = Set(micros.prefix(8).map(\.id)).union(favorites)
        let term = CSV.normalize(microFilter)
        let filtered = micros.filter {
            if !term.isEmpty { return CSV.normalize(store.tr($0.label)).contains(term) || $0.id.contains(term) }
            return showOtherMicros || defaultKeys.contains($0.id)
        }
        return GroupBox(store.tr("Micronutrientes")) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    TextField(store.tr("Buscar nutriente"), text: $microFilter).textFieldStyle(.roundedBorder).frame(maxWidth: 280)
                    Toggle(store.tr("Mostrar todos"), isOn: $showOtherMicros)
                }
                ForEach(filtered) { item in
                    let row = dashboardSummary(item, mode: activeCalculation, data: data, bands: bands)
                    summaryRow(row)
                }
                if filtered.isEmpty { Text(store.tr("Sin coincidencias")).foregroundStyle(.secondary) }
            }.padding(5)
        }
    }

    private func summaryRow(_ row: DashboardSummary) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(store.tr(row.variable.label)).frame(minWidth: 130, alignment: .leading)
            Spacer()
            if row.coverage == .partial { Text(store.tr("Parcial")).font(.caption).foregroundStyle(.orange) }
            Text(row.display.isEmpty ? store.tr("Sin datos") : row.display).monospacedDigit().foregroundStyle(adherenceColor(row.status))
            if !row.detail.isEmpty { Text(row.detail).font(.caption).foregroundStyle(.secondary) }
            if let ratio = row.ratio { Text("\(numberText(ratio, digits: 0))%").font(.caption).foregroundStyle(.secondary) }
            if !row.objectiveRange.isEmpty { Text(row.objectiveRange).font(.caption).foregroundStyle(.secondary) }
            if let objective = row.objective {
                Text("\(store.tr("Objetivo")) \(numberText(objective)) \(row.variable.unit)").font(.caption).foregroundStyle(.secondary)
            }
            if row.variable.source == .micro {
                Button {
                    let next = favorites.contains(row.id) ? favorites.filter { $0 != row.id } : favorites + [row.id]
                    Task {
                        do { try await store.patchPrefs(["fav_micros": .array(next.map(JSONValue.string))]) }
                        catch { store.report(error) }
                    }
                } label: {
                    Image(systemName: favorites.contains(row.id) ? "star.fill" : "star")
                }.buttonStyle(.borderless).accessibilityLabel(store.tr("Favorito"))
            }
        }
    }

    private func customCharts(_ data: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(store.tr("Mis gráficas")).font(.headline)
                Spacer()
                Button(store.tr("Nueva gráfica"), systemImage: "plus") { chartDraft = DashboardChartDraft() }
                    .buttonStyle(.borderedProminent)
            }
            if dashboardRows.isEmpty {
                Text(store.tr("Elige nutrientes y medidas para seguir sus tendencias.")).foregroundStyle(.secondary)
            }
            ForEach(dashboardRows.indices, id: \.self) { index in
                let draft = DashboardChartDraft(dashboardRows[index])
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(draft.title.isEmpty ? draft.variables.joined(separator: " + ") : draft.title).font(.headline)
                            Spacer()
                            Menu(store.tr("Opciones")) {
                                Button(store.tr("Editar")) { chartDraft = draft }
                                Button(store.tr("Mover arriba")) { moveChart(index, index - 1) }.disabled(index == 0)
                                Button(store.tr("Mover abajo")) { moveChart(index, index + 1) }.disabled(index == dashboardRows.count - 1)
                                Button(store.tr("Eliminar"), role: .destructive) { removeChart(index) }
                            }
                        }
                        DashboardPlot(definition: draft, data: data, heightCm: height)
                    }.padding(5)
                }
            }
        }
    }

    private func adherenceColor(_ status: Domain.Adherence?) -> Color {
        switch status {
        case .ok: .teal
        case .warn: .orange
        case .danger: .red
        case nil: .primary
        }
    }

    private func reload(_ requested: DashboardPeriod) async {
        let token = request
        loading = true
        failure = ""
        defer { if token == request { loading = false } }
        let dates = requested.dates
        guard !dates.isEmpty else {
            if preset == "Fase" && phases.isEmpty { failure = store.tr("Sin fases con días cerrados") }
            else if preset == "Fase" { failure = store.tr("Sin fases para la selección") }
            else { failure = store.tr("Elige un periodo válido de hasta cinco años.") }
            return
        }
        do {
            let range = dateFilter(requested.start, requested.end)
            let lastClosed = Day.key(closed)
            let historyFilter = dateFilter(Day.key(addingDays(-89, to: closed)), lastClosed)
            async let totalRows = paged("daily_totals", range)
            async let entryRows = paged("entry_nutrients", range.merging(["order": "day.asc,id.asc"]) { _, new in new })
            async let bodyRows = paged("body_metrics", range.merging(["select": "day,metrics"]) { _, new in new })
            async let historyRows = store.read("daily_totals", historyFilter.merging(["select": "day,kcal"]) { _, new in new })
            async let targetRows = store.read("targets")
            async let previous = previousRows(requested.prior)
            let (totals, entries, weights, history, allTargets, prior) = try await (totalRows, entryRows, bodyRows, historyRows, targetRows, previous)
            guard !Task.isCancelled, token == request else { return }
            targets = allTargets
            snapshot = DashboardSnapshot(period: requested, entries: entries, totals: totals, prior: prior, weights: weights,
                                         history: history, targets: allTargets, phases: DashboardPhase.list(allTargets, end: lastClosed))
            if let data, !data.enabled(calculation) { calculation = .average }
        } catch {
            if !Task.isCancelled && token == request { failure = error.localizedDescription; store.report(error) }
        }
    }

    private func previousRows(_ period: DashboardPeriod?) async throws -> [Record] {
        guard let period else { return [] }
        return try await paged("daily_totals", dateFilter(period.start, period.end))
    }

    private func paged(_ table: String, _ query: [String: String]) async throws -> [Record] {
        try await dashboardPage(store: store, table: table, query: query)
    }

    private func saveRange() {
        let item = SavedDashboardRange(id: activeRange ?? UUID(), name: cleanText(rangeName), start: Day.key(start), end: rollingEnd ? nil : Day.key(end))
        if let index = ranges.firstIndex(where: { $0.id == item.id }) { ranges[index] = item }
        else { ranges.append(item) }
        activeRange = item.id
        persistRanges()
    }

    private func applyRange(_ range: SavedDashboardRange) {
        guard let date = isoDate(range.start) else { return }
        activeRange = range.id
        rangeName = range.name
        start = date
        end = range.end.flatMap(isoDate) ?? closed
        rollingEnd = range.end == nil
        preset = "Personalizado"
    }

    private func removeRange() {
        guard let activeRange, let index = ranges.firstIndex(where: { $0.id == activeRange }) else { return }
        let row = ranges.remove(at: index)
        self.activeRange = nil
        persistRanges()
        store.undo(store.tr("Periodo eliminado")) {
            ranges.insert(row, at: min(index, ranges.count))
            persistRanges()
            applyRange(row)
        }
    }

    private func persistRanges() {
        do { UserDefaults.standard.set(try JSONEncoder().encode(ranges), forKey: rangeStorageKey) }
        catch { store.report(error) }
    }

    private func saveCharts(_ rows: [Record]) async throws {
        try await store.patchPrefs(["dashboards": .array(rows.map(JSONValue.object))])
    }

    private func removeChart(_ index: Int) {
        Task {
            var rows = dashboardRows
            guard rows.indices.contains(index) else { return }
            let row = rows.remove(at: index)
            do {
                try await saveCharts(rows)
                store.undo(store.tr("Gráfica eliminada")) {
                    var updated = dashboardRows
                    updated.insert(row, at: min(index, updated.count))
                    try await saveCharts(updated)
                }
            } catch { store.report(error) }
        }
    }

    private func moveChart(_ index: Int, _ to: Int) {
        Task {
            var rows = dashboardRows
            guard rows.indices.contains(index), rows.indices.contains(to) else { return }
            rows.swapAt(index, to)
            do { try await saveCharts(rows) } catch { store.report(error) }
        }
    }

    private enum Export { case entries, summary, report }

    private func export(_ kind: Export) {
        guard let data else { return }
        let slug = data.period.start + "_" + data.period.end
        do {
            switch kind {
            case .entries:
                let keys = ["day", "meal_label", "tipo", "item", "grams", "kcal", "protein_g", "carbs_g", "fat_g"]
                let microKeys = Domain.micros.map(\.key)
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys]
                let lines = try data.entries.map { row in
                    let coverage = try encoder.encode(JSONValue.object(row.object("micros_complete")))
                    let initial = [row.text("day"), row.text("meal"), row.text("food_id").isEmpty ? "recipe" : "food", row.text("item")]
                    let macros = keys.dropFirst(4).map { draftNumber(row.number($0)) }
                    return initial + macros + microKeys.map { draftNumber(nutritionValue(row, $0)) } + [String(decoding: coverage, as: UTF8.self)]
                }
                try saveFeatureFile(Data(("\u{FEFF}" + CSV.encode([keys + microKeys + ["micros_complete"]] + lines)).utf8),
                                    name: "nutri_entries_\(slug).csv", type: .commaSeparatedText)
            case .summary, .report:
                let summaries = DashboardVariable.nutrition.map { dashboardSummary($0, mode: activeCalculation, data: data, bands: bands) }
                if kind == .summary {
                    let headers = ["nutrient", "key", "unit", "value", "detail", "target", "percent_of_target", "coverage", "range"]
                    let lines = summaries.map { [
                        store.tr($0.variable.label), $0.id, $0.percent ? "%" : $0.variable.unit,
                        draftNumber($0.value), $0.detail, draftNumber($0.objective), draftNumber($0.ratio),
                        $0.coverage.rawValue, $0.objectiveRange
                    ] }
                    try saveFeatureFile(Data(("\u{FEFF}" + CSV.encode([headers] + lines)).utf8),
                                        name: "nutri_resumen_\(slug).csv", type: .commaSeparatedText)
                } else {
                    let report = try dashboardPDF(data, summaries: summaries, calculation: activeCalculation, waterFoodID: waterFoodID, bands: bands, store: store)
                    try saveFeatureFile(report, name: "nutri_informe_\(slug).pdf", type: .pdf)
                }
            }
        } catch { store.report(error) }
    }
}

@MainActor
private func dashboardPage(store: Store, table: String, query: [String: String]) async throws -> [Record] {
    let limit = 1000
    var result: [Record] = []
    while true {
        try Task.checkCancellation()
        let page = try await store.read(table, query.merging(["limit": String(limit), "offset": String(result.count)]) { _, new in new })
        result += page
        if page.count < limit { return result }
    }
}

private struct DashboardChartDraft: Identifiable {
    let id: String
    var title: String
    var type: String
    var variables: [String]
    var aggregation: String
    var reducer: String

    init(title: String = "", type: String = "line", variables: [String] = [], aggregation: String = "auto", reducer: String = "promedio") {
        id = UUID().uuidString
        self.title = title
        self.type = type
        self.variables = variables
        self.aggregation = aggregation
        self.reducer = reducer
    }

    init(_ row: Record) {
        id = row.text("id").isEmpty ? UUID().uuidString : row.text("id")
        title = row.text("title")
        type = row.text("type") == "bar" ? "bar" : "line"
        variables = row.array("vars").compactMap(\.string)
        aggregation = row.text("agg").isEmpty ? "auto" : row.text("agg")
        reducer = row.text("reducer").isEmpty ? "promedio" : row.text("reducer")
    }

    var fields: [DashboardVariable] { variables.compactMap { key in DashboardVariable.all.first { $0.id == key } } }
    var units: [String] { fields.map(\.unit).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } } }
    var stock: Bool { fields.contains(where: \.stock) }
    var effectiveReducer: String { stock && reducer == "suma" ? "promedio" : reducer }

    func record(title defaultTitle: String) -> Record {
        ["id": .string(id), "title": .string(cleanText(title).isEmpty ? defaultTitle : cleanText(title)),
         "type": .string(type), "vars": .array(variables.map(JSONValue.string)), "agg": .string(aggregation),
         "reducer": .string(effectiveReducer)]
    }
}

private struct DashboardChartEditor: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State var draft: DashboardChartDraft
    let onSave: (Record) async throws -> Void
    @State private var query = ""
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.tr("Configurar gráfica")).font(.title2.bold())
            Form {
                TextField(store.tr("Título"), text: $draft.title)
                Picker(store.tr("Tipo"), selection: $draft.type) {
                    Text(store.tr("Línea")).tag("line")
                    Text(store.tr("Barras")).tag("bar")
                }.pickerStyle(.segmented)
                Picker(store.tr("Agrupar por"), selection: $draft.aggregation) {
                    Text(store.tr("Automático")).tag("auto")
                    Text(store.tr("Día")).tag("dia")
                    Text(store.tr("Semana")).tag("semana")
                    Text(store.tr("Mes")).tag("mes")
                }
                if draft.aggregation != "dia" {
                    Picker(store.tr("Cálculo"), selection: $draft.reducer) {
                        Text(store.tr("Promedio")).tag("promedio")
                        Text(store.tr("Mediana")).tag("mediana")
                        if !draft.stock { Text(store.tr("Suma")).tag("suma") }
                    }.onChange(of: draft.stock) { _, hasStock in
                        if hasStock && draft.reducer == "suma" { draft.reducer = "promedio" }
                    }
                }
                Section(store.tr("Variables")) {
                    Text(store.tr("Hasta cuatro variables y dos unidades por gráfica.")).foregroundStyle(.secondary)
                    if !draft.fields.isEmpty {
                        Text(draft.fields.map { store.tr($0.label) }.joined(separator: " · ")).fontWeight(.medium)
                    }
                    TextField(store.tr("Buscar nutriente o medida"), text: $query)
                    let term = CSV.normalize(query)
                    ForEach(DashboardVariable.all.filter {
                        term.isEmpty || $0.id.contains(term) || CSV.normalize(store.tr($0.label)).contains(term)
                    }) { item in
                        Toggle("\(store.tr(item.label)) · \(item.unit)", isOn: Binding(
                            get: { draft.variables.contains(item.id) },
                            set: { enabled in
                                if enabled { draft.variables.append(item.id) }
                                else { draft.variables.removeAll { $0 == item.id } }
                            }
                        )).disabled(!draft.variables.contains(item.id) && (
                            draft.variables.count >= 4 || (!draft.units.contains(item.unit) && draft.units.count >= 2)
                        ))
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
                        defer { busy = false }
                        do {
                            let title = draft.fields.map { store.tr($0.label) }.joined(separator: " + ")
                            try await onSave(draft.record(title: title))
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                    }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(draft.variables.isEmpty)
            }.disabled(busy)
        }.padding(18).frame(width: 610, height: 600).interactiveDismissDisabled(busy)
    }
}

private struct DashboardPlot: View {
    @EnvironmentObject private var store: Store
    let definition: DashboardChartDraft
    let data: DashboardSnapshot
    let heightCm: Double?
    @State private var hovered: Date?

    private struct Point: Identifiable {
        var id: String { key + Day.key(date) }
        let date: Date
        let value: Double
        let key: String
        let label: String
        let unit: String
        let reference: Bool
    }

    private var aggregation: String {
        if definition.aggregation != "auto" { return definition.aggregation }
        if data.days.count <= 45 { return "dia" }
        return data.days.count <= 182 ? "semana" : "mes"
    }

    private func bucket(_ date: Date) -> Date {
        switch aggregation {
        case "semana":
            let dow = Calendar.current.component(.weekday, from: date)
            return addingDays(-((dow + 5) % 7), to: date)
        case "mes":
            return Calendar.current.dateInterval(of: .month, for: date)?.start ?? date
        default: return date
        }
    }

    private func reduce(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        switch definition.effectiveReducer {
        case "suma": return values.reduce(0, +)
        case "mediana": return dashboardQuantile(values, 0.5)
        default: return mean(values)
        }
    }

    private var points: [Point] {
        let grouped = Dictionary(grouping: data.days) { bucket($0.date) }
        let fields = definition.fields
        return grouped.keys.sorted().flatMap { date -> [Point] in
            let days = grouped[date] ?? []
            var result = fields.compactMap { variable -> Point? in
                guard let value = reduce(days.compactMap { day in
                    variable.observed(on: day, body: data.body[day.id] ?? [:], height: heightCm)
                }) else { return nil }
                return Point(date: date, value: value, key: variable.id, label: store.tr(variable.label), unit: variable.unit, reference: false)
            }
            if fields.count == 1, let variable = fields.first, !variable.stock {
                let targetPoints = days.compactMap { $0.target.flatMap { nutritionValue($0, variable.id) } }
                if let target = reduce(targetPoints) {
                    result.append(Point(date: date, value: target, key: "target", label: store.tr("Objetivo"), unit: variable.unit, reference: true))
                }
                for side in ["min", "max"] {
                    let bounds: [Double] = days.compactMap { day in
                        let bound = day.target?.object("bounds").object(variable.id) ?? [:]
                        if variable.id == "sodio_mg" {
                            return side == "min" ? max(Domain.sodiumFloor, bound.number(side) ?? Domain.sodiumFloor) :
                                bound.number(side) ?? Domain.sodiumCeiling
                        }
                        return bound.number(side)
                    }
                    if bounds.count == days.count, let value = reduce(bounds) {
                        result.append(Point(date: date, value: value, key: side,
                            label: store.tr(side == "min" ? "Mínimo" : "Máximo"), unit: variable.unit, reference: true))
                    }
                }
            }
            return result
        }
    }

    var body: some View {
        let rows = points
        let distinctUnits = definition.units
        if !rows.contains(where: { !$0.reference }) {
            Text(store.tr("Sin datos para esta gráfica")).foregroundStyle(.secondary).padding(.vertical, 10)
        } else {
            let left = distinctUnits.first ?? ""
            let right = distinctUnits.dropFirst().first
            let leftMax = rows.filter { $0.unit == left }.map(\.value).max() ?? 0
            let rightMax = rows.filter { $0.unit == right }.map(\.value).max() ?? 0
            let peak = max(leftMax, 1) * 1.08
            let rightPeak = max(rightMax, 1) * 1.08
            let values = (0...4).map { peak * Double($0) / 4 }
            let seriesCounts = Dictionary(grouping: rows, by: \.key).mapValues(\.count)
            let selected = hovered.flatMap { closest($0, rows: rows) }
            VStack(alignment: .leading, spacing: 7) {
                Chart(rows) { point in
                    let positioned = point.unit == right ? point.value * peak / rightPeak : point.value
                    if point.reference {
                        LineMark(x: .value("Fecha", point.date), y: .value(left, positioned), series: .value("Variable", point.key))
                            .foregroundStyle(Color.teal).lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 3]))
                        if seriesCounts[point.key] == 1 {
                            PointMark(x: .value("Fecha", point.date), y: .value(left, positioned)).foregroundStyle(Color.teal)
                        }
                    } else if definition.type == "bar" {
                        BarMark(x: .value("Fecha", point.date), y: .value(left, positioned))
                            .foregroundStyle(by: .value("Variable", point.label))
                            .position(by: .value("Variable", point.label))
                    } else {
                        LineMark(x: .value("Fecha", point.date), y: .value(left, positioned), series: .value("Variable", point.key))
                            .foregroundStyle(by: .value("Variable", point.label))
                        if (seriesCounts[point.key] ?? 0) < 12 {
                            PointMark(x: .value("Fecha", point.date), y: .value(left, positioned))
                                .foregroundStyle(by: .value("Variable", point.label))
                        }
                    }
                    if point.date == selected {
                        PointMark(x: .value("Fecha", point.date), y: .value(left, positioned))
                            .foregroundStyle(Color.primary).symbolSize(32)
                    }
                }
                .chartYScale(domain: 0...peak)
                .chartYAxis {
                    AxisMarks(position: .leading, values: values) { value in
                        AxisGridLine()
                        AxisValueLabel { if let tick = value.as(Double.self) { Text("\(numberText(tick, digits: 0)) \(left)").font(.caption2) } }
                    }
                    if let right {
                        AxisMarks(position: .trailing, values: values) { value in
                            AxisValueLabel {
                                if let tick = value.as(Double.self) {
                                    Text("\(numberText(tick * rightPeak / peak, digits: 0)) \(right)").font(.caption2)
                                }
                            }
                        }
                    }
                }
                .chartXSelection(value: $hovered)
                .frame(height: 185)
                if let date = selected {
                    let values = rows.filter { $0.date == date }.map { "\($0.label) \(numberText($0.value)) \($0.unit)" }.joined(separator: " · ")
                    Text("\(Day.key(date)) · \(values)").font(.caption).foregroundStyle(.secondary)
                } else if rows.contains(where: \.reference) {
                    Text(store.tr("Líneas discontinuas · objetivos y límites")).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func closest(_ date: Date, rows: [Point]) -> Date? {
        rows.map(\.date).min { abs($0.timeIntervalSince(date)) < abs($1.timeIntervalSince(date)) }
    }
}

struct DashboardAskPlan {
    let from: String
    let to: String
    let nutrients: [String]
    let detail: Bool
    let clamped: Bool

    init(_ raw: Record, today: Date) {
        let current = Calendar.current.startOfDay(for: today)
        let todayKey = Day.key(current)
        let defaultFrom = addingDays(-29, to: current)
        var lower = defaultFrom
        var upper = current
        if let from = isoDate(raw.text("date_from")), let to = isoDate(raw.text("date_to")) {
            let safeFrom = min(from, current), safeTo = min(to, current)
            lower = min(safeFrom, safeTo)
            upper = max(safeFrom, safeTo)
        }
        let minStart = addingDays(-91, to: upper)
        clamped = lower < minStart
        from = Day.key(max(lower, minStart))
        to = min(Day.key(upper), todayKey)
        detail = raw["need_detail"]?.bool == true
        let allowed = Set(nutritionMacros.map(\.key) + Domain.micros.map(\.key))
        let list = raw.array("nutrients").compactMap(\.string).reduce(into: [String]()) {
            if allowed.contains($1), !$0.contains($1) { $0.append($1) }
        }
        nutrients = list.isEmpty ? nutritionMacros.map(\.key) : list
    }
}

private struct AskLogView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let targets: [Record]
    @State private var question = ""
    @State private var busy = false
    @State private var history: [Answer] = []
    @State private var error = ""

    private struct Answer: Identifiable {
        let id = UUID()
        let question: String
        let answer: String
        let range: String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Pregúntale a tu bitácora")).font(.title2.bold())
            Text(store.tr("La IA consulta tus registros y objetivos para responder con fechas y alimentos.")).foregroundStyle(.secondary)
            List(history) { entry in
                VStack(alignment: .leading, spacing: 6) {
                    Text(entry.question).font(.headline)
                    Text(entry.answer).textSelection(.enabled)
                    Text(entry.range).font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 6)
            }.frame(minHeight: 210)
            TextField(store.tr("Pregunta sobre tus registros"), text: $question, axis: .vertical).lineLimit(2...5)
                .textFieldStyle(.roundedBorder).disabled(busy)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            HStack {
                Button(store.tr("Cerrar")) { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(store.tr("Preguntar")) { Task { await submit() } }.buttonStyle(.borderedProminent)
                    .disabled(busy || cleanText(question).isEmpty)
            }
        }.padding(18).frame(width: 620, height: 520).interactiveDismissDisabled(busy)
    }

    private func submit() async {
        let input = cleanText(question)
        guard !input.isEmpty, !busy else { return }
        busy = true
        error = ""
        defer { busy = false }
        do {
            let keys = nutritionMacros.map(\.key) + Domain.micros.map(\.key)
            let today = Date()
            let language = store.lang
            let schema = aiObject([
                "date_from": aiSchema("STRING"), "date_to": aiSchema("STRING"), "need_detail": aiSchema("BOOLEAN"),
                "nutrients": aiArray(aiSchema("STRING"))
            ], required: ["date_from", "date_to", "need_detail", "nutrients"])
            let langInstruction = language == "en" ? "Answer only via the schema fields." : "Responde solo con los campos del schema."
            let prompt = """
            Dada una pregunta del usuario sobre su registro nutricional y la fecha de hoy (\(Day.key(today)), formato YYYY-MM-DD), decide el rango de fechas a consultar (date_from, date_to, formato YYYY-MM-DD), si hacen falta alimentos individuales (need_detail: true cuando la pregunta pide causas, alimentos concretos o "qué comí") y qué nutrientes están implicados (nutrients: claves EXACTAS de esta lista, nunca inventes otras): \(keys.joined(separator: ", ")). \(langInstruction)
            """
            let raw = try await generateNutritionJSON(store: store, prompt: prompt, parts: [["text": .string(input)]], schema: schema)
            let plan = DashboardAskPlan(raw, today: today)
            let filter = dateFilter(plan.from, plan.to)
            async let totals = dashboardPage(store: store, table: "daily_totals", query: filter)
            async let foods = askEntries(plan.detail, filter)
            async let liveTargets = targets.isEmpty ? store.read("targets") : targets
            let (days, entries, resolved) = try await (totals, foods, liveTargets)
            if days.isEmpty {
                history.append(Answer(question: input, answer: store.tr("Sin registros en el rango"), range: "\(plan.from) – \(plan.to)"))
                question = ""
                return
            }
            let context = askContext(plan: plan, days: days, targets: resolved, entries: entries)
            let answerSchema = aiObject(["answer": aiSchema("STRING")], required: ["answer"])
            let idioma = language == "en" ? "inglés" : "español"
            let answerPrompt = """
            Eres el asistente de datos de una app de registro nutricional personal. Responde la pregunta usando EXCLUSIVAMENTE las cifras del contexto; nunca inventes ni extrapoles valores. Cita días y alimentos concretos (ej. "El 12 jul: 2,890 mg de sodio, principalmente Chilaquiles 320 g"). Describe los datos, no prescribas ni des consejo médico. Responde en \(idioma), conciso, en texto plano sin markdown.
            """
            let response = try await generateNutritionJSON(store: store, prompt: answerPrompt,
                parts: [["text": .string("Contexto:\n\(context)\n\nPregunta: \(input)")]], schema: answerSchema)
            let answer = cleanText(response.text("answer"))
            guard !answer.isEmpty else { throw FeatureError("La IA devolvió una respuesta vacía.") }
            let suffix = plan.clamped ? " · " + store.tr("Limitado a 92 días") : ""
            history.append(Answer(question: input, answer: answer, range: "\(plan.from) – \(plan.to)" + suffix))
            question = ""
        } catch { self.error = error.localizedDescription }
    }

    private func askEntries(_ detail: Bool, _ filter: [String: String]) async throws -> [Record]? {
        guard detail else { return nil }
        return try await dashboardPage(store: store, table: "entry_nutrients", query: filter.merging(["order": "day.asc,id.asc"]) { _, new in new })
    }

    private func askContext(plan: DashboardAskPlan, days: [Record], targets: [Record], entries: [Record]?) -> String {
        func round(_ value: Double?) -> String { draftNumber(value.map { ($0 * 10).rounded() / 10 }) }
        let header = ["day"] + plan.nutrients
        let observed = days.map { row in
            [row.text("day")] + plan.nutrients.map { key in
                if macroKeys.contains(key) { return round(nutritionValue(row, key)) }
                // Unknown and partially covered nutrients cannot support exact claims.
                return Domain.coverage(row, key) == .complete ? round(nutritionValue(row, key)) : ""
            }
        }
        let reference = days.map { row in
            let target = Domain.resolveTarget(targets, row.text("day")) ?? [:]
            return [row.text("day")] + plan.nutrients.map { round(nutritionValue(target, $0)) }
        }
        var context = "# Totales diarios (unidades: kcal, g o mg segun la clave)\n" + CSV.encode([header] + observed)
        context += "# Objetivo del día (mismas columnas; vacío si no hay)\n" + CSV.encode([header] + reference)
        if let entries {
            let extra = plan.nutrients.filter { $0 != "kcal" }
            let selected = entries.count > 400 ? Array(entries.sorted { ($0.number("kcal") ?? 0) > ($1.number("kcal") ?? 0) }.prefix(400)) : entries
            let details = selected.map { row in
                [row.text("day"), row.text("item"), round(row.number("grams")), round(row.number("kcal"))] + extra.map { key in
                    macroKeys.contains(key) || Domain.coverage(row, key) == .complete ? round(nutritionValue(row, key)) : ""
                }
            }
            context += "# Alimentos\n" + CSV.encode([["day", "item", "grams", "kcal"] + extra] + details)
            if entries.count > 400 { context += "(recortado a 400 alimentos de \(entries.count))\n" }
        }
        return context
    }
}

@MainActor
private func dashboardPDF(_ data: DashboardSnapshot, summaries: [DashboardSummary], calculation: DashboardCalculation, waterFoodID: String, bands: Record, store: Store) throws -> Data {
    let content = NSMutableData()
    var page = CGRect(x: 0, y: 0, width: 612, height: 792)
    guard let consumer = CGDataConsumer(data: content as CFMutableData),
          let context = CGContext(consumer: consumer, mediaBox: &page, nil) else {
        throw FeatureError("No se pudo generar el PDF.")
    }
    let sections = [Array(summaries.prefix(4))] + stride(from: 4, to: summaries.count, by: 23).map {
        Array(summaries[$0..<min($0 + 23, summaries.count)])
    }
    let stats = "\(data.logged.count)/\(data.days.count) \(store.tr("días registrados")) · \(data.complete.count) \(store.tr("completos"))"
    let observed = data.days.filter { !$0.total.isEmpty }
    let water = observed.compactMap { nutritionValue($0.total, "agua_ml") }
    let waterPartial = observed.contains { $0.coverage("agua_ml") != .complete }
    let simple = data.entries.filter { !waterFoodID.isEmpty && $0.text("food_id") == waterFoodID }.compactMap { $0.number("grams") }
    let waterUnit = store.units == "us" ? "fl oz" : "ml"
    let divisor = store.units == "us" ? Domain.mlPerFluidOunce : 1
    let waterSummary = [
        store.tr("Agua simple registrada") + " · " + (simple.isEmpty ? store.tr("Sin registro") : "\(numberText(simple.reduce(0, +) / divisor)) \(waterUnit)"),
        store.tr("Agua total observada") + " · " + (water.isEmpty ? store.tr("Sin datos") : "\(numberText(water.reduce(0, +) / divisor)) \(waterUnit)") + (waterPartial ? " · " + store.tr("Datos parciales") : "")
    ]
    let title = store.tr("Informe del periodo")
    let range = data.period.start + " – " + data.period.end
    let mode = store.tr(calculation.label)
    for (index, rows) in sections.enumerated() {
        let section = DashboardReportPage(rows: rows, range: range, mode: mode, stats: stats, title: title,
            page: "\(index + 1) / \(sections.count)", translate: store.tr, cover: index == 0 ? {
                let useHeat = calculation == .median || calculation == .bayes
                return AnyView(VStack(alignment: .leading, spacing: 9) {
                    ForEach(waterSummary, id: \.self) { Text($0).font(.footnote) }
                    if let sodium = summaries.first(where: { $0.id == "sodio_mg" }),
                       sodium.status == .danger, let value = sodium.value {
                        Text(store.tr("Sodio") + " · " + numberText(value) + " mg").font(.footnote.bold()).foregroundStyle(.red)
                    }
                    Text(store.tr(useHeat ? "Adherencia (kcal por día)" : "Kcal por día")).font(.headline)
                    if useHeat {
                        let cell = min(13, 510 / Double(max(1, (data.days.count + 12) / 7)) - 0.5)
                        DashboardHeatmap(days: data.days, bands: bands, square: cell, spacing: 0.5, translate: store.tr)
                    } else {
                        DashboardEnergyPlot(days: data.days).environmentObject(store)
                    }
                    Text(store.tr("Macronutrientes")).font(.headline)
                })
            } : nil)
        let renderer = ImageRenderer(content: section)
        renderer.proposedSize = ProposedViewSize(width: 612, height: 792)
        renderer.render { _, draw in
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
        }
    }
    context.closePDF()
    return content as Data
}

private struct DashboardReportPage: View {
    let rows: [DashboardSummary]
    let range: String
    let mode: String
    let stats: String
    let title: String
    let page: String
    let translate: (String) -> String
    let cover: (() -> AnyView)?

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Nutrimetry").font(.largeTitle.bold()).foregroundStyle(Color(red: 0.008, green: 0.35, blue: 0.33))
            Text("\(title) · \(mode)").font(.title2.bold())
            Text(range).font(.subheadline.monospacedDigit())
            Text(stats).font(.footnote)
            Divider()
            if let cover { cover() }
            ForEach(rows) { row in
                HStack(spacing: 8) {
                    Text(translate(row.variable.label)).frame(width: 130, alignment: .leading).lineLimit(1)
                    Text(row.display.isEmpty ? translate("Sin datos") : row.display).frame(width: 85, alignment: .trailing)
                    Text(row.detail).frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
                    if row.coverage == .partial { Text(translate("Parcial")).foregroundStyle(.orange) }
                    if let objective = row.objective { Text(translate("Objetivo") + " " + numberText(objective)) }
                }.font(.system(size: 10)).padding(.bottom, 3)
            }
            Spacer()
            HStack { Text(Day.key(Date())); Spacer(); Text(page) }.font(.caption)
        }
        .padding(36)
        .frame(width: 612, height: 792, alignment: .topLeading)
        .foregroundStyle(Color.black)
        .background(Color.white)
        .environment(\.colorScheme, .light)
    }
}

#if DEBUG
func checkDashboardCoverage(today: Date) throws {
    let dates = (-3 ... -1).map { Day.key(addingDays($0, to: today)) }
    let window = DashboardPeriod(windows: [dates[0]...dates[2]])
    let totals: [Record] = dates.enumerated().map { index, key in
        ["day": .string(key), "kcal": .number(2000), "micros": .object(["sodio_mg": .number(index == 0 ? 0 : 900)]),
         "micros_complete": index == 0 ? .object([:]) : .object(["sodio_mg": .bool(true)])]
    }
    let targets: [Record] = dates.map { ["day": .string($0), "kcal": .number(2000)] }
    let data = DashboardSnapshot(period: window, entries: [], totals: totals, prior: [], weights: [], history: [], targets: targets, phases: [])
    let sodium = DashboardVariable(id: "sodio_mg", label: "Sodio", unit: "mg", source: .micro)
    let average = dashboardSummary(sodium, mode: .average, data: data, bands: [:])
    let posterior = dashboardSummary(sodium, mode: .bayes, data: data, bands: [:])
    guard data.complete.count == 3, average.value == 600, average.coverage == .partial,
          average.status == nil, average.ratio == nil, posterior.value == nil else {
        throw FeatureError("Module check failed · partial coverage cannot claim adherence")
    }
    let known = totals.map { $0.merging(["micros_complete": .object(["sodio_mg": .bool(true)])]) { _, new in new } }
    let complete = DashboardSnapshot(period: window, entries: [], totals: known, prior: [], weights: [], history: [], targets: targets, phases: [])
    let safe = dashboardSummary(sodium, mode: .average, data: complete, bands: [:])
    guard safe.value == 600, safe.coverage == .complete, safe.status == .danger else {
        throw FeatureError("Module check failed · declared zero and sodium floor")
    }
}
#endif

private struct DashboardEnergyPlot: View {
    @EnvironmentObject private var store: Store
    let days: [DashboardDay]

    var body: some View {
        let byDay = Dictionary(uniqueKeysWithValues: days.filter(\.registered).compactMap { day in
            day.total.number("kcal").map { (day.id, $0) }
        })
        if byDay.isEmpty {
            Text(store.tr("Sin registros en el rango")).foregroundStyle(.secondary)
        } else {
            Chart(days) { day in
                if let target = day.target?.number("kcal") {
                    LineMark(x: .value("Fecha", day.date), y: .value("kcal", target), series: .value("Serie", "target"))
                        .foregroundStyle(Color.teal)
                }
                let bound = day.target?.object("bounds").object("kcal") ?? [:]
                if let lower = bound.number("min"), let upper = bound.number("max") {
                    AreaMark(x: .value("Fecha", day.date), yStart: .value("Mínimo", lower), yEnd: .value("Máximo", upper))
                        .foregroundStyle(Color.teal.opacity(0.12))
                }
                if let actual = byDay[day.id] {
                    LineMark(x: .value("Fecha", day.date), y: .value("kcal", actual), series: .value("Serie", "actual"))
                        .foregroundStyle(Color.blue)
                    if byDay.count <= 7 {
                        PointMark(x: .value("Fecha", day.date), y: .value("kcal", actual)).foregroundStyle(Color.blue)
                    }
                }
                let recent = (0..<7).compactMap { byDay[Day.key(addingDays(-$0, to: day.date))] }
                if let average = mean(recent) {
                    LineMark(x: .value("Fecha", day.date), y: .value("kcal", average), series: .value("Serie", "average"))
                        .foregroundStyle(Color.orange).lineStyle(StrokeStyle(dash: [4, 3]))
                }
            }.frame(height: 180)
            HStack(spacing: 12) {
                Label(store.tr("Kcal"), systemImage: "circle.fill").foregroundStyle(Color.blue)
                Label(store.tr("Objetivo"), systemImage: "circle.fill").foregroundStyle(Color.teal)
                Label(store.tr("Promedio 7 días"), systemImage: "circle.fill").foregroundStyle(Color.orange)
            }.font(.caption)
        }
    }
}

private struct DashboardHeatmap: View {
    let days: [DashboardDay]
    let bands: Record
    let square: CGFloat
    let spacing: CGFloat
    let translate: (String) -> String

    private func monday(_ date: Date) -> Date {
        addingDays(-((Calendar.current.component(.weekday, from: date) + 5) % 7), to: date)
    }

    var body: some View {
        let weeks = Dictionary(grouping: days) { monday($0.date) }
        HStack(alignment: .top, spacing: spacing) {
            ForEach(weeks.keys.sorted(), id: \.self) { week in
                let byDay = Dictionary(uniqueKeysWithValues: (weeks[week] ?? []).map { ($0.id, $0) })
                VStack(spacing: spacing) {
                    ForEach(0..<7) { offset in
                        let key = Day.key(addingDays(offset, to: week))
                        if let day = byDay[key] {
                            let status = day.completeness == .complete ? day.total.number("kcal").flatMap {
                                Domain.classify("kcal", value: $0, target: day.target, bands: bands)
                            } : nil
                            RoundedRectangle(cornerRadius: min(3, square / 3))
                                .fill(color(status, fallback: day.completeness.color))
                                .frame(width: square, height: square)
                                .help("\(day.id) · \(translate(day.completeness.label))")
                                .accessibilityLabel("\(day.id) · \(translate(day.completeness.label))")
                        } else {
                            Color.clear.frame(width: square, height: square).accessibilityHidden(true)
                        }
                    }
                }
            }
        }
    }

    private func color(_ status: Domain.Adherence?, fallback: Color) -> Color {
        switch status {
        case .ok: .teal
        case .warn: .orange
        case .danger: .red
        case nil: fallback
        }
    }
}
