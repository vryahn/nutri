import Charts
#if os(iOS)
import PDFKit
#endif
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
    var category: String {
        switch source {
        case .macro: "Macros"
        case .micro: Domain.micros.first { $0.key == id }?.category ?? "Otros"
        case .body: BodyMetric.fields.first { $0.key == id }?.category ?? "Otros"
        case .derived: "Derivadas"
        }
    }
    enum Source { case macro, micro, body, derived }
    var stock: Bool { source == .body || source == .derived }

    static let nutrition = nutritionMacros.map { Self(id: $0.key, label: $0.key == "kcal" ? "Kcal" : $0.label, unit: $0.unit, source: .macro) } +
        Domain.micros.filter { $0.key != "agua_ml" }.map { Self(id: $0.key, label: $0.label, unit: $0.unit, source: .micro) }
    static let all = nutrition + BodyMetric.fields.filter { $0.key != "sueno_corto" }.map {
        Self(id: $0.key, label: $0.label, unit: $0.unit, source: .body)
    } + BodyMetric.derived.map { Self(id: $0.key, label: $0.label, unit: $0.unit, source: .derived) }

    static let categories = all.map(\.category).reduce(into: [String]()) {
        if !$0.contains($1) { $0.append($1) }
    }

    func observed(on day: DashboardDay, body: Record, height: Double?) -> Double? {
        switch source {
        case .macro: day.registered ? (day.total.number(id) ?? 0) : nil
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

    var webKey: String {
        switch self {
        case .average: "promedio"
        case .sum: "suma"
        case .median: "mediana"
        case .standardDeviation: "stddev"
        case .trend: "tendencia"
        case .bayes: "bayes"
        }
    }

    var title: String {
        switch self {
        case .sum: "Suma del rango"
        case .average: "Promedio diario (÷ días registrados)"
        case .median: "Mediana (P25–P75)"
        case .standardDeviation: "Desviación estándar (CV)"
        case .trend: "Tendencia (unidades/día)"
        case .bayes: "Adherencia bayesiana (IC 95%)"
        }
    }

    var column: String {
        switch self {
        case .sum: "Suma"
        case .average: "Promedio"
        case .median: "Día típico (rango medio)"
        case .standardDeviation: "Variabilidad"
        case .trend: "Tendencia"
        case .bayes: "Adherencia"
        }
    }

    var description: String {
        switch self {
        case .median: "Tu día típico. A diferencia del promedio, no la mueven los días raros (una fiesta, un ayuno). El paréntesis es el rango donde cae la mitad de tus días."
        case .standardDeviation: "Qué tan parejo comes de un día a otro. Número chico = días parecidos. El % permite comparar kcal contra micros aunque midan cosas distintas."
        case .trend: "Cuánto sube o baja tu consumo cada día, en promedio, a lo largo del periodo."
        case .bayes: "Qué tan seguido cumples tu objetivo, y qué tan confiable es esa cifra. Con pocos días el rango sale ancho: es honestidad, no un error."
        default: ""
        }
    }

    var minimum: Int {
        switch self {
        case .average, .sum: 1
        case .standardDeviation: Domain.minDaysStdDev
        case .median: Domain.minDaysMedian
        case .trend: Domain.minDaysTrend
        case .bayes: Domain.minDaysBayes
        }
    }
}

private enum DayCompleteness {
    case missing, partial, complete, unknown

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
    var phaseMode = false
    var start: String { windows.first?.lowerBound ?? "" }
    var end: String { windows.last?.upperBound ?? "" }
    var union: Bool { windows.count > 1 }

    func contains(_ key: String) -> Bool { windows.contains { $0.contains(key) } }

    var dates: [Date] {
        guard let startDate = isoDate(start), let endDate = isoDate(end) else { return [] }
        let n = Calendar.current.dateComponents([.day], from: startDate, to: endDate).day ?? -1
        if phaseMode {
            return windows.flatMap { Self(windows: [$0]).dates }
        }
        guard (0...1830).contains(n) else { return [] }
        return (0...n).map { addingDays($0, to: startDate) }
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
    let ongoing: Bool

    static func list(_ targets: [Record], end: String) -> [Self] {
        let rows = targets.filter { $0.number("dow") != nil && isoDate($0.text("valid_from")) != nil }
        let groups = Dictionary(grouping: rows) { $0.text("valid_from") }
        let keys = groups.keys.sorted()
        return keys.enumerated().compactMap { index, start in
            guard start <= end, let rows = groups[start] else { return nil }
            let next = index + 1 < keys.count ? isoDate(keys[index + 1]) : nil
            let phaseEnd = next.map { min(end, Day.key(addingDays(-1, to: $0))) } ?? end
            guard start <= phaseEnd else { return nil }
            return Self(range: start...phaseEnd, label: rows.first(where: { !$0.text("label").isEmpty })?.text("label") ?? "",
                        goal: rows.first(where: { !$0.text("goal").isEmpty })?.text("goal") ?? "",
                        ongoing: next.map { Day.key(addingDays(-1, to: $0)) > end } ?? true)
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
    let phaseCount: Int
    let trimmedToPhase: Bool

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
        let historyMedian = historyKcals.count >= Domain.histMinDays ? dashboardQuantile(historyKcals, 0.5) : nil
        let mealsByDay = entriesByDay.mapValues { rows in Set(rows.map { $0.text("meal") }).count }
        let mealMedian = dashboardQuantile(totals.filter { period.contains($0.text("day")) && ($0.number("kcal") ?? 0) > 0 }
            .map { Double(mealsByDay[$0.text("day")] ?? 0) }, 0.5) ?? 0
        days = period.dates.enumerated().map { offset, date in
            let key = Day.key(date)
            let target = Domain.resolveTarget(targets, key)
            let row = totalsByDay[key] ?? [:]
            let kcal = row.number("kcal") ?? 0
            let completeness: DayCompleteness
            if kcal <= 0 { completeness = .missing }
            else if kcal < Domain.kcalHardFloor { completeness = .partial }
            else if let historyMedian {
                let mealWarning = mealMedian >= Double(Domain.minMealsSignal) && (mealsByDay[key] ?? 0) <= 1
                completeness = !mealWarning && kcal >= Domain.completeRatio * historyMedian ? .complete : .partial
            } else if let kcalTarget = target?.number("kcal") {
                completeness = kcal >= Domain.completeRatio * kcalTarget ? .complete : .partial
            } else { completeness = .unknown }
            return DashboardDay(date: date, offset: offset, total: row, target: target, completeness: completeness)
        }
        let intersected = phases.filter { phase in period.windows.contains { $0.overlaps(phase.range) } }
        phaseCount = intersected.count
        trimmedToPhase = !period.phaseMode && intersected.count > 1
        if trimmedToPhase, let last = intersected.last {
            advanced = days.filter { last.range.contains($0.id) && $0.registered && $0.completeness != .partial }
        } else {
            advanced = days.filter { $0.registered && $0.completeness != .partial }
        }
    }

    func enabled(_ mode: DashboardCalculation) -> Bool {
        switch mode {
        case .average, .sum: return !logged.isEmpty
        case .bayes:
            return complete.count >= Domain.minDaysBayes && days.contains { $0.target != nil }
        default: return advanced.count >= mode.minimum
        }
    }

    func disabledReason(_ mode: DashboardCalculation, translate: (String) -> String) -> String? {
        guard !enabled(mode) else { return nil }
        if mode.minimum == 1 { return translate("No registraste nada en este periodo.") }
        let eligible = mode == .bayes ? complete.count : advanced.count
        if mode == .bayes && eligible >= mode.minimum { return translate("Primero fija tus objetivos en Metas.") }
        let template = trimmedToPhase && mode != .bayes ? "Necesitas al menos %n días completos en la fase actual. Llevas %a." :
            "Necesitas al menos %n días completos. Llevas %a completos y %b incompletos."
        return translate(template).replacingOccurrences(of: "%n", with: String(mode.minimum))
            .replacingOccurrences(of: "%a", with: String(eligible)).replacingOccurrences(of: "%b", with: String(logged.count - complete.count))
    }
}

private struct DashboardSummary: Identifiable {
    var id: String { variable.id }
    let variable: DashboardVariable
    let value: Double?
    let detail: String
    let sampleCount: Int
    let bayesCount: Int?
    let bayesInterval: (low: Double, high: Double)?
    let hint: String?
    let objective: Double?
    let ratio: Double?
    let coverage: Domain.Coverage
    let status: Domain.Adherence?
    let delta: Double?
    let percent: Bool
    let objectiveRange: String

    func cells(_ mode: DashboardCalculation, translate: (String) -> String) -> [String] {
        func numeric(_ value: Double?, digits: Int = 2) -> String { draftNumber(value.map { webRound($0, digits: digits) }) }
        let micro = variable.source == .micro
        let formatted: String
        if micro && sampleCount == 0 { formatted = mode == .bayes ? "" : translate("Sin dato") }
        else if mode == .bayes { formatted = coverage == .partial ? "" : value.map { numeric($0, digits: 0) + "%" } ?? "" }
        else { formatted = numeric(value) }
        return [formatted, detail, numeric(objective), numeric(ratio, digits: 0) + (ratio == nil ? "" : "%")]
    }

    var display: String {
        guard let value else { return "" }
        return "\(draftNumber(webRound(value, digits: percent || id == "sodio_mg" ? 0 : 1)))\(percent ? "%" : id == "kcal" ? "" : " " + variable.unit)"
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
    func valueOf(_ day: DashboardDay) -> Double? {
        let value = nutritionValue(day.total, key)
        return macroKeys.contains(key) ? value ?? 0 : value
    }
    let values = registered.compactMap(valueOf)
    let coverage: Domain.Coverage = registered.allSatisfy { $0.coverage(key) == .complete } ? .complete : .partial
    let advanced = data.advanced.compactMap { day -> (Double, Double)? in
        valueOf(day).map { (Double(day.offset), $0) }
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
    let multiplier = mode == .sum ? Double(defined.count) : 1
    let lower = periodLimit("min").map { $0 * multiplier }
    let upper = periodLimit("max").map { $0 * multiplier }
    let rangeLabel = [lower.map { "≥ \(numberText($0))" }, upper.map { "≤ \(numberText($0))" }].compactMap { $0 }.joined(separator: " · ")
    var value: Double?
    var score = ""
    var objective: Double?
    var delta: Double?
    var status: Domain.Adherence?
    var ratio: Double?
    var bayesCount: Int?
    var bayesInterval: (Double, Double)?
    var hint: String?

    switch mode {
    case .sum:
        value = values.reduce(0, +)
        objective = points.isEmpty ? nil : points.reduce(0, +)
    case .average:
        value = mean(values) ?? 0
        objective = mean(points)
    case .median:
        if !observed.isEmpty {
            value = dashboardQuantile(observed, 0.5)
            let p25 = dashboardQuantile(observed, 0.25).map { webRound($0, digits: 2) }
            let p75 = dashboardQuantile(observed, 0.75).map { webRound($0, digits: 2) }
            score = "P25–P75: \(draftNumber(p25))–\(draftNumber(p75))"
        }
        objective = dashboardQuantile(points, 0.5)
    case .standardDeviation:
        value = sampleDeviation(observed)
        if let value, let average = mean(observed), average != 0 { score = "CV \(draftNumber(webRound(100 * value / average, digits: 0)))%" }
    case .trend:
        value = slope(advanced)
    case .bayes:
        objective = mean(points)
        let bayesCoverage = key == "sodio_mg" || !macroKeys.contains(key) ? data.complete.allSatisfy { $0.coverage(key) == .complete } : true
        if bayesCoverage {
            let passes = data.complete.compactMap { day -> Bool? in
                let actual = valueOf(day) ?? 0
                let bounds = day.target?.object("bounds").object(key) ?? [:]
                if key == "sodio_mg" {
                    let sodiumTarget: Record = ["bounds": .object([key: .object(bounds)])]
                    return Domain.classify(key, value: actual, target: sodiumTarget, bands: bands) == .ok
                }
                if bounds.number("min") != nil || bounds.number("max") != nil {
                    return Domain.classify(key, value: actual, target: day.target, bands: bands) == .ok
                }
                guard let target = day.target.flatMap({ nutritionValue($0, key) }) else { return nil }
                if ["kcal", "carbs_g", "fat_g"].contains(key) { return abs(actual - target) / target <= Domain.bayesKcalTolerance }
                return dailyCeilings.contains(key) ? actual <= target : actual >= target
            }
            if !passes.isEmpty {
                let posterior = dashboardPosterior(successes: passes.filter { $0 }.count, count: passes.count)
                value = posterior.mean * 100
                bayesCount = passes.count
                let low = webRound(100 * posterior.low, digits: 0)
                let high = webRound(100 * posterior.high, digits: 0)
                bayesInterval = (low, high)
                score = "IC95: \(draftNumber(low))–\(draftNumber(high))%"
            } else {
                hint = data.complete.isEmpty ? "No registraste nada en este periodo." :
                    "Aún no tienes objetivo para este nutriente. Ponlo en la pestaña Metas."
            }
        }
    }

    if (mode == .sum || mode == .average) && !data.period.union && !data.previous.isEmpty {
        let previousTotal = data.previous.compactMap { nutritionValue($0, key) }.reduce(0, +)
        let currentTotal = data.days.compactMap { nutritionValue($0.total, key) }.reduce(0, +)
        let prior = previousTotal / Double(data.previous.count)
        let current = currentTotal / Double(max(1, registered.count))
        if coverage == .complete && prior > 0 { delta = 100 * (current - prior) / prior }
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
    return DashboardSummary(variable: variable, value: value, detail: score, sampleCount: values.count,
                            bayesCount: bayesCount, bayesInterval: bayesInterval, hint: hint, objective: objective, ratio: ratio, coverage: coverage,
                            status: status, delta: delta, percent: mode == .bayes, objectiveRange: rangeLabel)
}

private struct SavedDashboardRange: Codable, Identifiable {
    var id = UUID()
    var name: String
    var start: String
    var end: String?
}

struct DashboardView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.nutriWindowWidth) private var windowWidth
    @AppStorage("nutri.dashboard.calculation") private var calculation = DashboardCalculation.average
    @AppStorage("nutri.dashboard.trend") private var trendKey = "protein_g"
    @AppStorage("nutri.dashboard.preset") private var preset = "Semana"
    @AppStorage("nutri.dashboard.phase") private var phaseSelection = "current"
    @AppStorage("nutri.dashboard.customStart") private var customStart = ""
    @AppStorage("nutri.dashboard.customEnd") private var customEnd = ""
    @AppStorage("nutri.dashboard.activeRange") private var savedRangeID = ""
    private var start: Date {
        get { isoDate(customStart) ?? addingDays(-6, to: today) }
        nonmutating set { customStart = Day.key(newValue) }
    }
    private var end: Date {
        get { isoDate(customEnd) ?? today }
        nonmutating set { customEnd = Day.key(newValue) }
    }
    @State private var rollingEnd = false
    @State private var rangeName = ""
    @State private var ranges: [SavedDashboardRange] = []
    @State private var activeRange: UUID?
    @State private var editingRange: UUID?
    @State private var targets: [Record] = []
    @State private var targetsLoaded = false
    @State private var snapshot: DashboardSnapshot?
    @State private var cachedPeriods: [DashboardPeriod: DashboardSnapshot] = [:]
    @State private var failure = ""
    @State private var refreshKey = UUID()
    @State private var topMetric = "kcal"
    @AppStorage("nutri.dashboard.tab") private var tab = "standard"
    @State private var advancedOpen = false
    @State private var exportNotice = ""
    @State private var fileExport = FeatureFileExport()
    @State private var reportPreview = false
    @State private var showOtherMicros = false
    @State private var chartDraft: DashboardChartDraft?
    @State private var ask = false
    @State private var askQuestion = ""
    @State private var askHistory: [DashboardAnswer] = []
    @State private var askBusy = false

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private var closed: Date { addingDays(-1, to: today) }
    private var phases: [DashboardPhase] { DashboardPhase.list(targets, end: Day.key(closed)) }
    private var selectedPhases: [DashboardPhase] {
        if phaseSelection == "current" { return phases.suffix(1).map { $0 } }
        if phaseSelection == "previous" { return phases.dropLast().suffix(1).map { $0 } }
        if phaseSelection.hasPrefix("goal:") { return phases.filter { $0.goal == String(phaseSelection.dropFirst(5)) } }
        return []
    }
    private var period: DashboardPeriod {
        if preset == "Fase", !selectedPhases.isEmpty { return DashboardPeriod(windows: selectedPhases.map(\.range), phaseMode: true) }
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
        period.windows.map { "\($0.lowerBound):\($0.upperBound)" }.joined(separator: "|") +
            (period.phaseMode ? ":phase:" : ":range:") + refreshKey.uuidString
    }
    private var data: DashboardSnapshot? { cachedPeriods[period] ?? snapshot }
    private var dataMatchesPeriod: Bool { data?.period == period }
    private var bands: Record { store.prefs.object("adherence_bands") }
    private var dashboardRows: [Record] { store.prefs.array("dashboards").compactMap(\.object) }
    private var favorites: [String] { store.prefs.array("fav_micros").compactMap(\.string) }
    private var waterFoodID: String { store.prefs.text("water_food_id") }
    private var height: Double? { store.prefs.object("profile").number("height_cm") }
    private var activeCalculation: DashboardCalculation {
        guard let data, data.enabled(calculation) else { return data?.logged.isEmpty == true ? .sum : .average }
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
                if !exportNotice.isEmpty {
                    Text(exportNotice).foregroundStyle(palette.warn)
                }
                rangeInputs
                analysisTabs
                if let data, dataMatchesPeriod || !data.period.windows.isEmpty {
                    Group {
                        if tab == "charts" { customCharts(data) }
                        else { overview(data) }
                    }
                    .opacity(dataMatchesPeriod ? 1 : 0.6)
                    .disabled(!dataMatchesPeriod)
                    .allowsHitTesting(dataMatchesPeriod)
                    .accessibilityHidden(!dataMatchesPeriod)
                    .overlay(alignment: .topTrailing) {
                        if !dataMatchesPeriod {
                            stalePeriodLabel(data.period)
                        }
                    }
                } else if failure.isEmpty {
                    VStack(spacing: 12) {
                        ForEach(0..<4, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 16).fill(palette.surface).frame(height: 96)
                        }
                    }.accessibilityLabel(store.tr("Cargando…"))
                }
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .bottom) {
            if !failure.isEmpty {
                HStack {
                    Text(failure).foregroundStyle(palette.warn)
                    Spacer(minLength: 8)
                    Button(store.tr("Reintentar")) { refreshKey = UUID() }
                        .buttonStyle(NutriButtonStyle(.quiet))
                }
                .padding(.horizontal, 12).padding(.vertical, 4)
                .frame(maxWidth: 480).nutriGlass(radius: 12)
                .padding(16)
            }
        }
        .font(.nutriSans(14))
        .foregroundStyle(palette.text)
        .task(id: store.owner) {
            ranges = []
            activeRange = nil
            if let raw = UserDefaults.standard.data(forKey: rangeStorageKey),
               let saved = try? JSONDecoder().decode([SavedDashboardRange].self, from: raw) {
                ranges = saved
                if let range = saved.first(where: { $0.id.uuidString == savedRangeID }) {
                    let selected = preset
                    applyRange(range)
                    preset = selected
                }
            }
            if let cached = store.cached("targets") {
                targets = cached
                targetsLoaded = true
            }
            do {
                let received = try await store.read("targets")
                guard !Task.isCancelled else { return }
                targets = received
                targetsLoaded = true
            } catch {
                if !Task.isCancelled { store.report(error) }
            }
        }
        .task(id: request) {
            await reload(period)
            #if DEBUG
            switch store.snapshotScenario {
            case "dashboard-chart":
                chartDraft = DashboardChartDraft(variables: ["peso_kg", "cintura_cm"])
            case "dashboard-report":
                reportPreview = true
                if store.prefs.text("lang") == "en", let data,
                   let path = ProcessInfo.processInfo.environment["NUTRI_SNAPSHOT_REPORT_PDF"], !path.isEmpty {
                    do { try reportContent(data).pdf(store: store).write(to: URL(fileURLWithPath: path), options: .atomic) }
                    catch { store.report(error) }
                }
            case "dashboard-ask": ask = true
            default: break
            }
            #endif
        }
        .onReceive(NotificationCenter.default.publisher(for: .nutriTargetsChanged)) { _ in refreshKey = UUID() }
        .onChange(of: request) { _, _ in exportNotice = "" }
        .preference(key: NutriPresentedModalKey.self, value: presentedModal)
        .preference(key: NutriModalVisibleKey.self, value: presentedModal != nil)
        .nutriFeatureExport($fileExport) { store.report($0) }
        .nutriOnExitCommand {
            if ask { ask = false }
            else if chartDraft != nil { chartDraft = nil }
            else if reportPreview { reportPreview = false }
        }
    }

    private func stalePeriodLabel(_ period: DashboardPeriod) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.tr("Resumen del periodo")).font(.nutriSans(12))
                Text(period.start + " → " + period.end).font(.nutriMono(11))
            }
            if failure.isEmpty {
                ProgressView().controlSize(.small).accessibilityLabel(store.tr("Actualizando…"))
            }
        }.padding(8).nutriGlass(radius: 12)
    }

    private var presentedModal: NutriPresentedModal? {
        if ask {
            return NutriPresentedModal("dashboard-ask", close: { ask = false }) {
                AskLogView(targets: targets, question: $askQuestion, busy: $askBusy, history: $askHistory, close: { ask = false })
            }
        }
        if let draft = chartDraft {
            return NutriPresentedModal("dashboard-chart", close: { chartDraft = nil }) {
                DashboardChartEditor(draft: draft, editing: dashboardRows.contains { $0.text("id") == draft.id }, close: { chartDraft = nil }) { record in
                    var updated = dashboardRows
                    if let index = updated.firstIndex(where: { $0.text("id") == record.text("id") }) { updated[index] = record }
                    else { updated.append(record) }
                    try await saveCharts(updated)
                }
            }
        }
        if reportPreview, dataMatchesPeriod, let data {
            return NutriPresentedModal("dashboard-report", close: { reportPreview = false }, scrimOpacity: 1, fullscreen: true) {
                DashboardReportPreview(report: reportContent(data), filename: "nutri_informe_\(activeCalculation.webKey)_\(rangeSlug).pdf",
                                       close: { reportPreview = false })
            }
        }
        return nil
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(store.tr("Dashboard")).font(.nutriDisplay(20))
            Spacer()
            Button(store.tr("Preguntar")) { ask = true }
                .buttonStyle(NutriButtonStyle(.secondary, radius: 22))
            DashboardMenu(label: store.tr("Exportar"), width: 288) {
                let column = store.tr(activeCalculation.column)
                menuRow(store.tr("Registros día por día") + " (CSV)", note: "Cada alimento del rango con sus macros y micros. No aplica la operación seleccionada.") { export(.entries) }
                menuRow(store.tr("Resumen del periodo") + " — " + column + " (CSV)", note: "Una fila por métrica con valor según la operación activa, objetivo y % de adherencia.") { export(.summary) }
                menuRow(store.tr("Informe del periodo") + " — " + column + " (PDF)", note: "Resumen ejecutivo con gráfica y tablas, listo para guardar como PDF.") { export(.report) }
            }.disabled(!dataMatchesPeriod).opacity(dataMatchesPeriod ? 1 : 0.5)
        }
    }

    private var phaseLabel: String {
        if phaseSelection == "current" { return store.tr("Fase actual") }
        if phaseSelection == "previous" { return store.tr("Fase previa") }
        return dashboardGoals.first { "goal:" + $0.0 == phaseSelection }.map { store.tr($0.1) } ?? store.tr("Fases")
    }

    private var rangeInputs: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(dashboardPresets, id: \.0) { name, _ in
                            dashboardPill(store.tr(name), selected: preset == name, height: 38) { preset = name }
                        }
                    }
                }.scrollIndicators(.hidden)
                DashboardMenu(label: preset == "Personalizado" ?
                    ranges.first(where: { $0.id == activeRange }).flatMap { $0.name.isEmpty ? nil : $0.name } ?? store.tr("Custom") :
                    store.tr("Custom"), selected: preset == "Personalizado", labelWidth: 130) {
                    menuRow("Personalizado…", note: "Elige un rango de fechas") {
                        preset = "Personalizado"
                        activeRange = nil
                        editingRange = nil
                        savedRangeID = ""
                        rangeName = ""
                        rollingEnd = false
                    }
                    Divider().overlay(palette.border).padding(.vertical, 4)
                    if ranges.isEmpty {
                        Text(store.tr("Guarda un rango para reutilizarlo aquí.")).font(.nutriSans(11)).foregroundStyle(palette.text3).padding(8)
                    }
                    ForEach(ranges) { range in
                        HStack(spacing: 0) {
                            let dateSpan = String(range.start.dropFirst(5)) + " → " + (range.end.map { String($0.dropFirst(5)) } ?? store.tr("Hoy"))
                            menuRow(range.name.isEmpty ? dateSpan : range.name, note: range.name.isEmpty ? nil : dateSpan) { applyRange(range) }
                            DashboardRangeEdit {
                                applyRange(range)
                                editingRange = range.id
                            }
                            DashboardRangeDelete { removeRange(range.id) }
                        }
                    }
                }
                DashboardMenu(label: preset == "Fase" && !selectedPhases.isEmpty ? phaseLabel : store.tr("Fases"), selected: preset == "Fase") {
                    phaseMenuRow("Fase actual", phase: phases.last, fallback: "Todavía no tienes una fase en curso. Créala en Metas.") { selectPhase("current") }
                    phaseMenuRow("Fase previa", phase: phases.dropLast().last, fallback: "Solo llevas una fase. La anterior aparecerá cuando empieces la siguiente.") { selectPhase("previous") }
                    Divider().overlay(palette.border).padding(.vertical, 4)
                    ForEach(dashboardGoals, id: \.0) { goal, label in
                        let matches = phases.filter { $0.goal == goal }
                        if matches.isEmpty {
                            unavailablePhase(label, reason: store.tr("No has marcado ninguna fase como %n. Puedes hacerlo en Metas.")
                                .replacingOccurrences(of: "%n", with: store.tr(label)))
                        } else {
                            menuRow(label, note: "\(matches.count) " + store.tr(matches.count == 1 ? "fase" : "fases") + " " + store.tr("en el histórico")) {
                                selectPhase("goal:" + goal)
                            }
                        }
                    }
                }
            }
            if targetsLoaded && preset == "Fase" && selectedPhases.isEmpty {
                Text(store.tr("La fase seleccionada ya no tiene días registrados — mostrando la última semana."))
                    .foregroundStyle(palette.warn)
            }
            if (preset == "Personalizado" && (rollingEnd || end >= today)) || (preset == "Fase" && selectedPhases.contains(where: \.ongoing)) {
                Text(store.tr("El día en curso no se incluye: el Dashboard analiza días terminados. Para hoy usa el rango \"Hoy\"."))
                    .font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
            if period.union {
                let label = store.tr("%n fases de %s · %d días.").replacingOccurrences(of: "%n", with: String(selectedPhases.count))
                    .replacingOccurrences(of: "%s", with: phaseLabel).replacingOccurrences(of: "%d", with: String(period.dates.count))
                Text(label + " " + store.tr("Sin comparación vs periodo previo")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                    .nutriHint(store.tr("No hay periodo anterior con qué comparar: los días antes del %n eran de otra fase, con otros objetivos.")
                        .replacingOccurrences(of: "%n", with: period.start))
            }
            if preset == "Personalizado" {
                if activeRange == nil || editingRange != nil { rangeForm }
                else {
                    Text(Day.key(start) + " → " + Day.key(rollingEnd ? closed : min(end, closed)) + " · " +
                         store.tr("%d días").replacingOccurrences(of: "%d", with: String(period.dates.count)))
                        .font(.nutriMono(12)).foregroundStyle(palette.text3)
                }
            }
        }
    }

    private var rangeForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                dashboardDateField("Inicio", date: Binding(get: { start }, set: { start = $0 }))
                if rollingEnd {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(store.tr("Fin")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                        Text(store.tr("Hoy")).frame(maxWidth: .infinity, alignment: .leading).nutriInput()
                    }
                } else { dashboardDateField("Fin", date: Binding(get: { end }, set: { end = $0 })) }
            }
            HStack(alignment: .top) {
                Toggle(store.tr("Hasta hoy"), isOn: $rollingEnd)
                    #if os(macOS)
                    .toggleStyle(.checkbox)
                    #else
                    .toggleStyle(.switch)
                    #endif
                    .tint(palette.accentDeep)
                Text(store.tr("El rango crece solo: mañana incluirá un día más.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            }.frame(minHeight: 44)
            HStack {
                TextField(store.tr("Nombre (opcional)"), text: $rangeName).nutriInput()
                    .onChange(of: rangeName) { _, value in
                        if value.count > 40 { rangeName = String(value.prefix(40)) }
                    }
                Button(store.tr(editingRange == nil ? "Guardar rango" : "Guardar cambios")) { saveRange() }
                    .buttonStyle(NutriButtonStyle(.primary)).disabled(!rollingEnd && start > end)
            }
            if !rollingEnd && start > end {
                Text(store.tr("La fecha de inicio va después del fin.")).foregroundStyle(palette.warn)
            }
            if let editingRange, let saved = ranges.first(where: { $0.id == editingRange }) {
                Button(store.tr("Cancelar")) { applyRange(saved) }
                    .buttonStyle(NutriButtonStyle(.quiet))
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }.frame(maxWidth: 576, alignment: .leading)
    }

    private func dashboardDateField(_ label: String, date: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr(label)).font(.nutriSans(12)).foregroundStyle(palette.text3)
            DatePicker(store.tr(label), selection: date, displayedComponents: .date).labelsHidden()
                .frame(maxWidth: .infinity, alignment: .leading).nutriInput()
        }
    }

    @ViewBuilder private func phaseMenuRow(_ label: String, phase: DashboardPhase?, fallback: String, action: @escaping () -> Void) -> some View {
        if let phase {
            let start = String(phase.range.lowerBound.dropFirst(5))
            let end = String(phase.range.upperBound.dropFirst(5))
            let name = phase.label.isEmpty ? store.tr("Sin nombre") : phase.label
            menuRow(label, note: name + " · " + start + " → " + end, action: action)
        } else { unavailablePhase(label, reason: store.tr(fallback)) }
    }

    private func unavailablePhase(_ label: String, reason: String) -> some View {
        HStack {
            Text(store.tr(label))
            Spacer()
            infoHint(reason)
        }.foregroundStyle(palette.text3).padding(.horizontal, 12).frame(minHeight: 44)
    }

    private func selectPhase(_ key: String) {
        phaseSelection = key
        preset = "Fase"
    }

    private var analysisTabs: some View {
        HStack(spacing: 8) {
            ForEach([("standard", "Análisis estándar"), ("charts", "Mis gráficas")], id: \.0) { value, label in
                Button { tab = value } label: {
                    Text(store.tr(label)).frame(maxWidth: .infinity, minHeight: 44)
                        .font(.nutriSans(14, weight: .medium))
                        .foregroundStyle(tab == value ? palette.bg : palette.text2)
                        .background(tab == value ? palette.accent : palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain).accessibilityAddTraits(tab == value ? .isSelected : [])
            }
        }
    }

    private func dashboardPill(_ label: String, selected: Bool, height: CGFloat = 44, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.nutriSans(14, weight: selected ? .medium : .regular)).lineLimit(1)
                .padding(.horizontal, 12).frame(minHeight: height)
                .foregroundStyle(selected ? palette.bg : palette.text2)
                .background(selected ? palette.accent : palette.surface2, in: Capsule())
                .overlay { Capsule().strokeBorder(selected ? Color.clear : palette.border) }
        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func menuRow(_ label: String, note: String? = nil, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        DashboardMenuRow(title: store.tr(label), note: note.map(store.tr), enabled: enabled, action: action)
    }

    private func overview(_ data: DashboardSnapshot) -> some View {
        let mode = activeCalculation
        let macros = DashboardVariable.nutrition.prefix(4).map { dashboardSummary($0, mode: mode, data: data, bands: bands) }
        let sodiumVariable = DashboardVariable.nutrition.first { $0.id == "sodio_mg" }
        let sodium = sodiumVariable.map { dashboardSummary($0, mode: mode, data: data, bands: bands) }
        return VStack(alignment: .leading, spacing: 16) {
            calculationOptions(data)
            waterAndSodium(data)
            kpis(data, macros: macros, sodium: sodium)
            periodSummary(data, macros: macros)
            leadingCharts(data)
            if data.days.count > 7 {
                NutriColumns(columns: windowWidth >= 768 ? 2 : 1, gap: 16) {
                    nutrientFootprint(data)
                    heatmap(data)
                }
            } else { nutrientFootprint(data) }
            NutriColumns(columns: windowWidth >= 768 ? 2 : 1, gap: 16) {
                weeklyProtein(data)
                sodiumTrend(data)
            }
            trendPanel(data)
            topFoods(data)
            micronutrients(data)
        }
    }

    private func calculationOptions(_ data: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                ForEach([DashboardCalculation.sum, .average]) { mode in
                    let reason = data.disabledReason(mode, translate: store.tr)
                    dashboardPill(store.tr(mode.label), selected: activeCalculation == mode) { calculation = mode }
                        .disabled(reason != nil).opacity(reason == nil ? 1 : 0.5).nutriHint(reason)
                }
                dashboardPill(store.tr("Avanzadas") + (advancedOpen ? " ▴" : " ▾"), selected: activeCalculation.minimum > 1) {
                    advancedOpen.toggle()
                }
            }
            if advancedOpen {
                NutriColumns(columns: windowWidth >= 768 ? 2 : 1, gap: 8) {
                    ForEach(DashboardCalculation.allCases.filter { $0.minimum > 1 }) { mode in
                        let reason = data.disabledReason(mode, translate: store.tr)
                        Button { calculation = mode } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(store.tr(mode.label)).font(.nutriSans(14, weight: .medium))
                                Text(reason ?? store.tr(mode.description)).font(.nutriSans(12))
                                    .foregroundStyle(reason == nil ? palette.text2 : palette.text3)
                            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(12)
                                .nutriCard(fill: activeCalculation == mode ? palette.surface3 : palette.surface)
                                .overlay {
                                    if activeCalculation == mode { RoundedRectangle(cornerRadius: 16).strokeBorder(palette.accent) }
                                }
                        }.buttonStyle(.plain).disabled(reason != nil).opacity(reason == nil ? 1 : 0.5)
                    }
                }
            }
        }
    }

    private func kpis(_ data: DashboardSnapshot, macros: [DashboardSummary], sodium: DashboardSummary?) -> some View {
        let columns = windowWidth >= 1024 ? 6 : windowWidth >= 768 ? 3 : 2
        return NutriColumns(columns: columns, gap: 12) {
            ForEach(macros) { row in
                let color = palette.nutrient(row.id)
                let name = row.id == "carbs_g" ? "Carbs" : row.variable.label
                DashboardKPI(title: store.tr(name), value: display(row), detail: displayDetail(row), hint: displayHint(row, data: data),
                             delta: row.delta, color: adherenceColor(kpiStatus(row.id, data: data)), sparkColor: color, points: data.days.map {
                    $0.registered ? (nutritionValue($0.total, row.id) ?? 0) : nil
                })
            }
            if let sodium {
                DashboardKPI(title: store.tr("Sodio"), value: display(sodium), detail: displayDetail(sodium), hint: displayHint(sodium, data: data),
                             delta: sodium.delta, color: adherenceColor(sodiumStatus(data)), sparkColor: palette.carbs, points: data.days.map {
                    $0.registered && $0.coverage("sodio_mg") == .complete ? nutritionValue($0.total, "sodio_mg") : nil
                })
            }
            let partial = data.logged.count - data.complete.count
            let delta = !data.previous.isEmpty && !data.period.union && activeCalculation.minimum == 1 ?
                100 * Double(data.logged.count - data.previous.count) / Double(data.previous.count) : nil
            let daysHint = store.tr("%a días con todo registrado y %b a los que parece faltarles comidas, de %c días del periodo.")
                .replacingOccurrences(of: "%a", with: String(data.complete.count))
                .replacingOccurrences(of: "%b", with: String(partial)).replacingOccurrences(of: "%c", with: String(data.days.count))
            DashboardKPI(title: store.tr("Días"), value: String(data.complete.count) + (partial > 0 ? " +\(partial)p" : "") + " / \(data.days.count)",
                         detail: "", hint: daysHint, delta: delta, color: palette.text, sparkColor: palette.text, points: [])
        }
    }

    private func kpiStatus(_ key: String, data: DashboardSnapshot) -> Domain.Adherence? {
        let consumed = data.days.compactMap { nutritionValue($0.total, key) }.reduce(0, +)
        let defined = data.days.compactMap(\.target)
        let objective = defined.compactMap { nutritionValue($0, key) }.reduce(0, +)
        let bound = periodBounds(data.days, key: key).compactMapValues { value in
            value.number.map { JSONValue.number($0 * Double(defined.count)) }
        }
        let target: Record = [key: .number(objective), "goal": data.days.last?.target?["goal"] ?? .null,
                              "bounds": .object([key: .object(bound)])]
        return Domain.classify(key, value: consumed, target: target, bands: bands)
    }

    private func periodSummary(_ data: DashboardSnapshot, macros: [DashboardSummary]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(store.tr(activeCalculation.title))
                if let note = phaseHint(data), activeCalculation.minimum > 1 && activeCalculation != .bayes {
                    infoHint(note)
                }
            }.foregroundStyle(palette.text3)
            if let phrase = plainKcal(data, row: macros.first) {
                Text(phrase).font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
            NutriColumns(columns: windowWidth >= 640 ? 4 : 2, gap: 8) {
                ForEach(macros) { row in
                    VStack(spacing: 4) {
                        Text(display(row)).font(.nutriMono(windowWidth >= 640 ? 18 : 14)).foregroundStyle(palette.nutrient(row.id))
                            .nutriHint(displayHint(row, data: data))
                        if !displayDetail(row).isEmpty {
                            Text(displayDetail(row)).font(.nutriMono(12)).foregroundStyle(palette.text3)
                        }
                        Text(store.tr(["protein_g": "Prot", "carbs_g": "Carbs"][row.id] ?? row.variable.label))
                            .font(.nutriSans(12)).foregroundStyle(palette.text3)
                    }.frame(maxWidth: .infinity)
                }
            }
        }.padding(16).nutriCard()
    }

    private func leadingCharts(_ data: DashboardSnapshot) -> some View {
        NutriColumns(columns: windowWidth >= 768 ? 2 : 1, gap: 16, firstWeight: windowWidth >= 1024 ? 2 : 1) {
            dashboardCard("Kcal por día", hint: "La línea sólida es lo que comiste cada día. La punteada suaviza esos altibajos con el promedio de los últimos 7 días, para ver la tendencia sin el ruido diario. La banda tenue marca ±10% de tu objetivo.") {
                DashboardEnergyPlot(days: data.days, height: chartHeight)
            }
            macroDistribution(data)
        }
    }

    private var chartHeight: CGFloat { windowWidth >= 1024 ? 320 : 220 }

    private func dashboardCard<Content: View>(_ title: String, hint: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(store.tr(title))
                if let hint { infoHint(store.tr(hint)) }
            }.foregroundStyle(palette.text3)
            content()
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).nutriCard()
    }

    private func infoHint(_ text: String) -> some View {
        NutriHintButton(text: text) { Text("ⓘ") }
    }

    private func display(_ row: DashboardSummary) -> String {
        if row.variable.source == .micro && row.sampleCount == 0 { return store.tr("Sin dato") }
        if activeCalculation == .bayes, row.coverage == .partial { return "–" }
        if activeCalculation == .bayes, row.hint != nil {
            return row.hint == "No registraste nada en este periodo." ? "–" : store.tr("Sin objetivo")
        }
        if row.display.isEmpty { return "–" }
        if activeCalculation == .standardDeviation { return "σ " + row.display }
        if activeCalculation == .trend {
            return ((row.value ?? -1) >= 0 ? "+" : "") + row.display + "/" + store.tr("día")
        }
        return row.display
    }

    private func displayDetail(_ row: DashboardSummary) -> String {
        if row.coverage == .partial {
            return row.sampleCount > 0 && activeCalculation != .bayes ? store.tr("Datos parciales") : ""
        }
        if let interval = row.bayesInterval {
            return store.tr("probablemente entre %a y %b%")
                .replacingOccurrences(of: "%a", with: draftNumber(interval.low))
                .replacingOccurrences(of: "%b", with: draftNumber(interval.high))
        }
        return row.detail
    }

    private func displayHint(_ row: DashboardSummary, data: DashboardSnapshot) -> String? {
        if row.coverage == .partial {
            return store.tr(activeCalculation == .bayes
                ? "Cobertura parcial: faltan valores de este nutriente en algunos alimentos."
                : "Faltan valores de este nutriente en algunos alimentos; la suma observada no prueba cumplimiento.")
        }
        if let hint = row.hint { return store.tr(hint) }
        guard activeCalculation == .bayes, row.bayesCount != nil else { return nil }
        return bayesCriterion(data, key: row.id, translate: store.tr)
    }

    private func phaseHint(_ data: DashboardSnapshot) -> String? {
        guard data.period == period else { return nil }
        if data.period.union {
            return "Estás viendo \(selectedPhases.count) fases de \(phaseLabel), cada una con sus propios objetivos. El cálculo usa sus \(data.advanced.count) días completos."
        }
        if data.trimmedToPhase {
            return "El periodo abarca \(data.phaseCount) fases con objetivos distintos. Para no mezclarlas, el cálculo usa solo la fase actual (\(data.advanced.count) días)."
        }
        return nil
    }

    private func plainKcal(_ data: DashboardSnapshot, row: DashboardSummary?) -> String? {
        guard let row, let value = row.value else { return nil }
        func r(_ x: Double) -> String { draftNumber(webRound(x, digits: 0)) }
        switch activeCalculation {
        case .median:
            let values = data.advanced.compactMap { $0.total.number("kcal") }
            guard let p25 = dashboardQuantile(values, 0.25), let p75 = dashboardQuantile(values, 0.75) else { return nil }
            return store.tr("Tu día típico: %n kcal (la mitad de tus días cae entre %a y %b)")
                .replacingOccurrences(of: "%n", with: r(value)).replacingOccurrences(of: "%a", with: r(p25)).replacingOccurrences(of: "%b", with: r(p75))
        case .standardDeviation:
            let values = data.advanced.compactMap { $0.total.number("kcal") }
            let base = store.tr("Varías ±%n kcal entre días").replacingOccurrences(of: "%n", with: r(value))
            guard let avg = mean(values), avg > 0 else { return base }
            let cv = 100 * value / avg
            return base + " — " + store.tr(cv < 10 ? "consistencia alta" : cv < 25 ? "consistencia media" : "consistencia baja") + " (CV " + r(cv) + "%)"
        case .trend:
            return store.tr("%v ~%n kcal por día ≈ %m por semana").replacingOccurrences(of: "%v", with: store.tr(value >= 0 ? "Subes" : "Bajas"))
                .replacingOccurrences(of: "%n", with: r(abs(value))).replacingOccurrences(of: "%m", with: r(abs(value) * 7))
        case .bayes: return store.tr("Cumples tu objetivo ~%n de cada 10 días").replacingOccurrences(of: "%n", with: r(value / 10))
        default: return nil
        }
    }

    private func waterAndSodium(_ data: DashboardSnapshot) -> some View {
        let water = waterStats(data)
        return VStack(alignment: .leading, spacing: 8) {
            waterRow("Agua simple registrada", value: water.simple, color: palette.carbs)
            Text("\(water.days)/\(data.days.count) \(store.tr("días con registro")). \(store.tr("Solo cuenta el alimento de agua simple de Hoy."))")
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
            waterRow("Agua total observada", value: water.total, color: palette.text2)
            if water.plan {
                Text(store.tr("Plan v6.6: piso operativo diario 2 L de agua simple; objetivo orientativo 3.5 L. No es techo ni cuota."))
                    .font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
        }.padding(16).nutriCard()
    }

    private func waterRow(_ label: String, value: String, color: Color) -> some View {
        let title = Text(store.tr(label)).foregroundStyle(palette.text3)
        let amount = Text(value).font(.nutriMono(14)).foregroundStyle(color)
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) {
                title.fixedSize()
                Spacer(minLength: 4)
                amount.fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                title
                amount
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func waterStats(_ data: DashboardSnapshot) -> (simple: String, total: String, days: Int, plan: Bool) {
        let observed = data.days.filter { !$0.total.isEmpty }
        let partial = observed.contains { $0.coverage("agua_ml") != .complete }
        let water = observed.compactMap { nutritionValue($0.total, "agua_ml") }.reduce(0, +)
        let simple = data.entries.filter { Domain.waterEntry($0, waterID: waterFoodID) }
        let simpleTotal = simple.compactMap { $0.number("grams") }.reduce(0, +)
        let simpleText = simple.isEmpty
            ? store.tr(waterFoodID.isEmpty ? "Agua simple sin configurar" : "Sin registro")
            : formatWater(simpleTotal)
        let totalText = (observed.isEmpty ? store.tr("Sin dato") : formatWater(water)) + (partial ? " · " + store.tr("Datos parciales") : "")
        let plan = data.days.contains {
            $0.id >= "2026-10-07" && $0.id <= "2026-12-31" &&
            $0.target?.object("micros").number("agua_ml") == 3500 && $0.target?.object("bounds").object("agua_ml").number("min") == 2000
        }
        return (simpleText, totalText, Set(simple.map { $0.text("day") }).count, plan)
    }

    private func formatWater(_ ml: Double) -> String {
        let ounces = ml / Domain.mlPerFluidOunce
        return store.units == "us" ? "\(draftNumber(webRound(ounces, digits: ounces < 1 ? 2 : 1))) fl oz" :
            "\(draftNumber(webRound(ml, digits: 1))) ml"
    }

    private func sodiumCeiling(_ data: DashboardSnapshot) -> Double {
        periodBounds(data.days, key: "sodio_mg").number("max") ?? Domain.sodiumCeiling
    }

    private func sodiumAverage(_ data: DashboardSnapshot) -> Double {
        data.days.compactMap { nutritionValue($0.total, "sodio_mg") }.reduce(0, +) / Double(max(1, data.logged.count))
    }

    private func sodiumStatus(_ data: DashboardSnapshot) -> Domain.Adherence? {
        guard !data.logged.isEmpty else { return nil }
        let average = sodiumAverage(data)
        let ceil = sodiumCeiling(data)
        let covered = data.logged.allSatisfy { $0.coverage("sodio_mg") == .complete }
        guard covered || average < Domain.sodiumFloor || average > ceil else { return nil }
        return Domain.classify("sodio_mg", value: average, target: ["bounds": .object(["sodio_mg": .object(periodBounds(data.days, key: "sodio_mg"))])], bands: bands)
    }

    private func sodiumWarning(_ data: DashboardSnapshot, showCoverage: Bool) -> String? {
        guard !data.logged.isEmpty else { return nil }
        let average = sodiumAverage(data)
        let ceil = sodiumCeiling(data)
        guard average < Domain.sodiumFloor || average > ceil else { return nil }
        let compared = average < Domain.sodiumFloor ? " < \(draftNumber(Domain.sodiumFloor))" : " > \(draftNumber(ceil))"
        let coverage = showCoverage && data.logged.contains { $0.coverage("sodio_mg") != .complete } ? " · " + store.tr("Datos parciales") : ""
        return "⚠ " + store.tr("sodio promedio") + compared + " mg" + coverage
    }

    private func heatmap(_ data: DashboardSnapshot) -> some View {
        dashboardCard("Adherencia (kcal por día)") {
            ScrollView(.horizontal) {
                DashboardHeatmap(days: data.days, bands: bands, square: 14, spacing: 4, translate: store.tr)
            }
        }
    }

    private func trendPanel(_ data: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(store.tr("Tendencia por nutriente")).foregroundStyle(palette.text3)
                infoHint(store.tr("Elige cualquier nutriente y ve su valor día a día en el rango. La línea punteada es tu objetivo diario, si lo tienes en Metas."))
                    .foregroundStyle(palette.text3)
                Spacer()
                nutrientPicker
            }
            let spec = DashboardChartDraft(title: "", type: "line", variables: [trend.id], aggregation: "dia", reducer: "promedio")
            DashboardPlot(definition: spec, data: data, heightCm: height, chartHeight: windowWidth >= 1024 ? 288 : 220,
                          empty: "Sin registros en el rango", trend: true)
        }.padding(16).nutriCard()
    }

    private var nutrientPicker: some View {
        let groups = [NutriSelectGroup(label: store.tr("Macros"), options: DashboardVariable.nutrition.prefix(4).map {
            ($0.id, store.tr($0.label))
        })] + Domain.categories.compactMap { category -> NutriSelectGroup? in
            let options = Domain.micros.filter { $0.category == category && $0.key != "agua_ml" }.map {
                ($0.key, store.tr($0.label))
            }
            return options.isEmpty ? nil : NutriSelectGroup(label: store.tr(category), options: options)
        }
        return NutriSelect(value: trendKey, select: { trendKey = $0 }, groups: groups, height: 36)
            .frame(maxWidth: 240).accessibilityLabel(store.tr("Nutriente a graficar"))
    }

    private func macroDistribution(_ data: DashboardSnapshot) -> some View {
        dashboardCard("Distribución de macros (kcal)", hint: "Cada franja es un macronutriente (proteína, carbos, grasa) y su grosor es cuánto pesó ese día en tus calorías. Lee el ancho de cada color, no la altura total del área.") {
            DashboardMacroDistribution(days: data.days, height: chartHeight)
        }
    }

    private func nutrientFootprint(_ data: DashboardSnapshot) -> some View {
        let defaultKeys = Set(Domain.micros.prefix(8).map(\.key))
        let defaults = DashboardVariable.nutrition.filter { defaultKeys.contains($0.id) }
        let dataWithTargets = defaults.compactMap { variable -> (label: String, objective: Double, variable: DashboardVariable)? in
            let objective = data.days.compactMap { $0.target.flatMap { nutritionValue($0, variable.id) } }.reduce(0, +)
            return objective > 0 ? (store.tr(variable.label), objective, variable) : nil
        }
        let points = dataWithTargets.compactMap { row -> (String, Double)? in
            guard !data.logged.isEmpty, data.logged.allSatisfy({ $0.coverage(row.variable.id) == .complete }) else { return nil }
            let actual = data.days.compactMap { nutritionValue($0.total, row.variable.id) }.reduce(0, +)
            return (row.label, min(150, 100 * actual / row.objective))
        }
        return dashboardCard("Huella nutricional (micros vs. objetivo)", hint: "Cada punta es un micronutriente. Cuanto más lejos del centro, más cerca (o por encima) llegaste de tu objetivo ese periodo — el borde del gráfico es 150%.") {
            if points.isEmpty {
                let status = data.logged.isEmpty ? "Sin registros en el rango" :
                    dataWithTargets.isEmpty ? "Registra objetivos de micros en Metas" : "Sin micros con cobertura completa en este periodo."
                emptyChart(status)
            } else {
                DashboardRadar(points: points).frame(height: chartHeight).id(data.period)
            }
        }
    }

    private func emptyChart(_ text: String) -> some View {
        Text(store.tr(text)).foregroundStyle(palette.text2).frame(maxWidth: .infinity).padding(.vertical, 32)
    }

    private func sodiumTrend(_ data: DashboardSnapshot) -> some View {
        dashboardCard("Sodio diario vs piso y techo") {
            DashboardSodiumPlot(days: data.days, ceiling: sodiumCeiling(data), height: windowWidth >= 1024 ? 320 : 200)
        }
    }

    private func weeklyProtein(_ data: DashboardSnapshot) -> some View {
        dashboardCard("Proteína semanal vs piso") {
            DashboardProteinPlot(days: data.days, bands: bands, height: windowWidth >= 1024 ? 320 : 200)
        }
    }

    private func topFoods(_ data: DashboardSnapshot) -> some View {
        let rows = data.entries.filter {
            !Domain.waterEntry($0, waterID: waterFoodID) &&
            (!$0.text("food_id").isEmpty || !$0.text("recipe_id").isEmpty)
        }
        let groups = Dictionary(grouping: rows) { $0.text("food_id").isEmpty ? $0.text("recipe_id") : $0.text("food_id") }
        let firstItems = rows.map { $0.text("food_id").isEmpty ? $0.text("recipe_id") : $0.text("food_id") }
        var seen: Set<String> = []
        let unique = firstItems.filter { seen.insert($0).inserted }
        let totals = unique.compactMap { key -> (String, Double)? in
            guard let entries = groups[key], let first = entries.first else { return nil }
            return (first.text("item"), entries.compactMap { $0.number(topMetric) }.reduce(0, +))
        }.sorted { $0.1 > $1.1 }
        let top = Array(totals.prefix(8))
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(store.tr("Top alimentos")).foregroundStyle(palette.text3)
                Spacer()
                dashboardPill(store.tr("Kcal"), selected: topMetric == "kcal", height: 32) { topMetric = "kcal" }
                dashboardPill(store.tr("Proteína"), selected: topMetric == "protein_g", height: 32) { topMetric = "protein_g" }
            }
            if top.isEmpty {
                Text(store.tr("Sin registros en el rango")).foregroundStyle(palette.text2)
            } else {
                VStack(spacing: 8) {
                    ForEach(top.indices, id: \.self) { index in
                        VStack(spacing: 4) {
                            HStack {
                                Text(top[index].0).lineLimit(1)
                                Spacer()
                                Text(draftNumber(webRound(top[index].1, digits: 1)) + (topMetric == "kcal" ? "" : " g"))
                                    .font(.nutriMono(14)).foregroundStyle(palette.text2)
                            }
                            GeometryReader { proxy in
                                Capsule().fill(palette.surface2).overlay(alignment: .leading) {
                                    Capsule().fill(palette.accent)
                                        .frame(width: proxy.size.width * (top[0].1 > 0 ? top[index].1 / top[0].1 : 0))
                                }
                            }.frame(height: 6)
                        }
                    }
                }
            }
        }.padding(16).nutriCard()
    }

    private func micronutrients(_ data: DashboardSnapshot) -> some View {
        let micros = DashboardVariable.nutrition.filter { $0.source == .micro }
        let defaultKeys = Set(Domain.micros.prefix(8).map(\.key)).union(favorites)
        let visible = micros.filter { defaultKeys.contains($0.id) }
        let hidden = micros.filter { metric in
            !defaultKeys.contains(metric.id) && data.days.contains { day in
                (nutritionValue(day.total, metric.id) ?? 0) > 0 || day.target.flatMap { nutritionValue($0, metric.id) }.map { $0 > 0 } == true
            }
        }
        return dashboardCard("Micros") {
            VStack(alignment: .leading, spacing: 0) {
                microColumns(store.tr("Nutriente"), value: store.tr(activeCalculation.column), detail: nil,
                             objective: store.tr("Objetivo"), ratio: "%", tint: palette.text3, header: true)
                    .nutriHint(activeCalculation.minimum > 1 && activeCalculation != .bayes ? phaseHint(data) : nil)
                ForEach(visible) { summaryRow(dashboardSummary($0, mode: activeCalculation, data: data, bands: bands), data: data) }
                if !hidden.isEmpty {
                    DisclosureGroup(store.tr("Más micros (%n)").replacingOccurrences(of: "%n", with: String(hidden.count)), isExpanded: $showOtherMicros) {
                        ForEach(Domain.categories, id: \.self) { category in
                            let metrics = hidden.filter { variable in Domain.micros.first { $0.key == variable.id }?.category == category }
                            if !metrics.isEmpty {
                                Text(store.tr(category).uppercased()).font(.nutriSans(12)).tracking(0.5)
                                    .foregroundStyle(palette.text3).padding(.top, 12).padding(.bottom, 4)
                                ForEach(metrics) { summaryRow(dashboardSummary($0, mode: activeCalculation, data: data, bands: bands), data: data) }
                            }
                        }
                    }.padding(.vertical, 8).foregroundStyle(palette.text2)
                }
                if let warning = sodiumWarning(data, showCoverage: true) {
                    Text(warning).foregroundStyle(palette.danger).padding(.top, 12)
                }
            }
        }
    }

    private func summaryRow(_ row: DashboardSummary, data: DashboardSnapshot) -> some View {
        let lowOrHigh = row.id == "sodio_mg" && sodiumWarning(data, showCoverage: false) != nil
        let implicitApplicable = dailyCeilings.contains(row.id)
        let comparable = implicitApplicable || !row.objectiveRange.isEmpty
        let tint = lowOrHigh ? palette.danger : row.coverage == .partial ? palette.text3 :
            comparable && row.id != "sodio_mg" ? adherenceColor(row.status) : palette.text
        let detail = displayDetail(row)
        let objective = row.objective.map { draftNumber(webRound($0, digits: 1)) + " " + row.variable.unit } ?? "–"
        let pct = row.ratio.map { draftNumber(webRound($0, digits: 0)) + "%" } ?? "–"
        let missing = row.objective == nil && activeCalculation != .standardDeviation && activeCalculation != .trend
        let uncovered = data.logged.filter { $0.coverage(row.id) != .complete }.count
        let coverage = row.coverage == .partial ? store.tr("En %a de %b días faltan valores de este nutriente en uno o más alimentos.")
            .replacingOccurrences(of: "%a", with: String(uncovered)).replacingOccurrences(of: "%b", with: String(data.logged.count)) : nil
        return VStack(spacing: 0) {
            Rectangle().fill(palette.border).frame(height: 1)
            microColumns(store.tr(row.variable.label), value: display(row) + (coverage == nil ? "" : " ⚠"), detail: detail.isEmpty ? nil : detail,
                         objective: objective, ratio: pct, tint: tint, header: false)
                .nutriHint([displayHint(row, data: data), coverage, missing ? store.tr("Aún no tienes objetivo para este nutriente. Ponlo en la pestaña Metas.") : nil]
                    .compactMap { $0 }.joined(separator: "\n"))
        }
    }

    private func microColumns(_ label: String, value: String, detail: String?, objective: String, ratio: String, tint: Color, header: Bool) -> some View {
        NutriColumns(columns: 4, gap: 8, firstWeight: 1.65) {
            Text(label).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(header ? palette.text3 : palette.text)
            Text(value + (detail.map { " (" + $0 + ")" } ?? ""))
                .font(header ? .nutriSans(14) : .nutriMono(14)).foregroundStyle(tint)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Text(objective).font(header ? .nutriSans(14) : .nutriMono(14)).foregroundStyle(header ? palette.text3 : palette.text2)
                .frame(maxWidth: .infinity, alignment: .trailing)
            Text(ratio).font(header ? .nutriSans(14) : .nutriMono(14)).foregroundStyle(header ? palette.text3 : palette.text2)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }.padding(.vertical, 8)
    }

    private func customCharts(_ data: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer()
                Button("+ " + store.tr("Nueva")) { chartDraft = DashboardChartDraft() }
                    .buttonStyle(.plain).foregroundStyle(palette.accent)
            }
            if dashboardRows.isEmpty {
                Button { chartDraft = DashboardChartDraft() } label: {
                    VStack(spacing: 4) {
                        Text("+").font(.nutriSans(24)).foregroundStyle(palette.accent)
                        Text(store.tr("Crea una gráfica para cruzar cualquier variable en el tiempo"))
                        Text(store.tr("peso, medidas, macros, micros o derivadas — línea o barras")).font(.nutriSans(12))
                    }.foregroundStyle(palette.text3).frame(maxWidth: .infinity).padding(24)
                        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border, style: StrokeStyle(dash: [4, 4])) }
                }.buttonStyle(.plain)
            } else {
                NutriColumns(columns: windowWidth >= 768 ? 2 : 1, gap: 16) {
                    ForEach(Array(dashboardRows.enumerated()), id: \.element) { index, row in
                        customChart(DashboardChartDraft(row), index: index, data: data)
                    }
                }
            }
        }
    }

    private func customChart(_ item: DashboardChartDraft, index: Int, data: DashboardSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                let name = item.title.isEmpty ? item.fields.map { store.tr($0.label) }.joined(separator: " + ") : item.title
                Text(name).font(.nutriSans(14, weight: .medium)).lineLimit(1)
                Spacer()
                DashboardMenu(label: store.tr("Opciones de la gráfica"), ellipsis: true, width: 160) {
                    menuRow("Editar") { chartDraft = item }
                    if index > 0 { menuRow("Subir") { moveChart(index, index - 1) } }
                    if index < dashboardRows.count - 1 { menuRow("Bajar") { moveChart(index, index + 1) } }
                    DashboardMenuRow(title: store.tr("Eliminar"), note: nil, enabled: true, destructive: true) { removeChart(index) }
                }.padding(.top, -8).padding(.trailing, -8)
            }
            DashboardPlot(definition: item, data: data, heightCm: height, chartHeight: windowWidth >= 1024 ? 288 : 220)
        }.padding(16).nutriCard()
    }

    private func adherenceColor(_ status: Domain.Adherence?) -> Color {
        switch status {
        case .ok: palette.ok
        case .warn: palette.warn
        case .danger: palette.danger
        case nil: palette.text
        }
    }

    private func reload(_ requested: DashboardPeriod) async {
        guard !Task.isCancelled, requested == period else { return }
        let token = request
        if let cached = cachedPeriods[requested] { snapshot = cached }
        failure = ""
        if snapshot != nil {
            do { try await Task.sleep(for: .milliseconds(250)) }
            catch { return }
        }
        guard !Task.isCancelled, token == request else { return }
        let dates = requested.dates
        guard !dates.isEmpty else {
            snapshot = DashboardSnapshot(period: requested, entries: [], totals: [], prior: [], weights: [], history: [], targets: targets, phases: [])
            calculation = .sum
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
            targetsLoaded = true
            let refreshed = DashboardSnapshot(period: requested, entries: entries, totals: totals, prior: prior, weights: weights,
                                              history: history, targets: allTargets, phases: DashboardPhase.list(allTargets, end: Day.key(today)))
            snapshot = refreshed
            cachedPeriods[requested] = refreshed
            if requested == period, !refreshed.enabled(calculation) {
                calculation = refreshed.logged.isEmpty ? .sum : .average
            }
        } catch {
            if !Task.isCancelled && token == request {
                failure = store.tr("No se pudo cargar el Dashboard — revisa tu conexión.")
            }
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
        let item = SavedDashboardRange(id: editingRange ?? UUID(), name: cleanText(rangeName), start: Day.key(start), end: rollingEnd ? nil : Day.key(end))
        if let index = ranges.firstIndex(where: { $0.id == item.id }) { ranges[index] = item }
        else { ranges.append(item) }
        activeRange = item.id
        savedRangeID = item.id.uuidString
        editingRange = nil
        persistRanges()
    }

    private func applyRange(_ range: SavedDashboardRange) {
        guard let date = isoDate(range.start) else { return }
        activeRange = range.id
        savedRangeID = range.id.uuidString
        editingRange = nil
        rangeName = range.name
        start = date
        end = range.end.flatMap(isoDate) ?? closed
        rollingEnd = range.end == nil
        preset = "Personalizado"
    }

    private func removeRange(_ id: UUID) {
        guard let index = ranges.firstIndex(where: { $0.id == id }) else { return }
        let row = ranges.remove(at: index)
        let wasActive = activeRange == id
        if wasActive {
            activeRange = nil
            editingRange = nil
            savedRangeID = ""
            rangeName = ""
            rollingEnd = false
        }
        persistRanges()
        store.undo(store.tr("Rango borrado")) {
            ranges.insert(row, at: min(index, ranges.count))
            persistRanges()
            if wasActive { applyRange(row) }
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
            rows.remove(at: index)
            do { try await saveCharts(rows) } catch { store.report(error, as: "No se pudo guardar la gráfica — reintenta.") }
        }
    }

    private func moveChart(_ index: Int, _ to: Int) {
        Task {
            var rows = dashboardRows
            guard rows.indices.contains(index), rows.indices.contains(to) else { return }
            rows.swapAt(index, to)
            do { try await saveCharts(rows) } catch { store.report(error, as: "No se pudo guardar la gráfica — reintenta.") }
        }
    }

    private enum Export { case entries, summary, report }

    private var rangeSlug: String {
        guard period.phaseMode else { return period.start + "_" + period.end }
        let key = phaseSelection == "current" ? "actual" : phaseSelection == "previous" ? "previa" : String(phaseSelection.dropFirst(5))
        return "fase_" + key
    }

    private func export(_ kind: Export) {
        exportNotice = ""
        guard dataMatchesPeriod, let data else { return }
        switch kind {
        case .entries:
            let exportPeriod = period
            let slug = rangeSlug
            Task {
                do {
                    let query = dateFilter(exportPeriod.start, exportPeriod.end).merging([
                        "select": "day,meal,item,food_id,recipe_id,grams,kcal,protein_g,carbs_g,fat_g,micros,micros_complete",
                        "order": "day.asc,id.asc"
                    ]) { _, new in new }
                    guard !exportPeriod.dates.isEmpty else {
                        exportNotice = store.tr("Sin registros en el rango")
                        return
                    }
                    let all = try await paged("entry_nutrients", query)
                    guard exportPeriod == period else { return }
                    let rows = all.filter { exportPeriod.contains($0.text("day")) }
                    guard !rows.isEmpty else {
                        exportNotice = store.tr("Sin registros en el rango")
                        return
                    }
                    let bytes = try rawDashboardCSV(rows, unlabelled: store.tr("Sin etiqueta"))
                    try fileExport.save(bytes, name: "nutri_entries_\(slug).csv", type: .commaSeparatedText)
                } catch { store.report(error) }
            }
        case .summary:
            guard !data.logged.isEmpty else { exportNotice = store.tr("Sin registros en el rango"); return }
            do {
                let calc = activeCalculation
                let summaries = DashboardVariable.nutrition.map { dashboardSummary($0, mode: calc, data: data, bands: bands) }
                let content = summaryDashboardCSV(summaries, mode: calc, translate: store.tr)
                try fileExport.save(content, name: "nutri_resumen_\(calc.webKey)_\(rangeSlug).csv", type: .commaSeparatedText)
            } catch { store.report(error) }
        case .report:
            guard !data.logged.isEmpty else { exportNotice = store.tr("Sin registros en el rango"); return }
            reportPreview = true
        }
    }

    private func reportContent(_ data: DashboardSnapshot) -> DashboardReport {
        let mode = activeCalculation
        let macros = DashboardVariable.nutrition.prefix(4).map { dashboardSummary($0, mode: mode, data: data, bands: bands) }
        let visibleKeys = Set(Domain.micros.prefix(8).map(\.key)).union(favorites)
        let micros = DashboardVariable.nutrition.filter { $0.source == .micro && visibleKeys.contains($0.id) }
            .map { dashboardSummary($0, mode: mode, data: data, bands: bands) }
        let partial = data.logged.count - data.complete.count
        let stats = store.tr("%a de %b días registrados · %c completos")
            .replacingOccurrences(of: "%a", with: String(data.logged.count))
            .replacingOccurrences(of: "%b", with: String(data.days.count))
            .replacingOccurrences(of: "%c", with: String(data.complete.count)) + (partial > 0 ? " (+\(partial)p)" : "")
        let water = waterStats(data)
        return DashboardReport(
            data: data, mode: mode, bands: bands, macros: macros, micros: micros, stats: stats,
            phase: data.period.phaseMode ? phaseLabel + (data.period.union ? " · \(selectedPhases.count) " + store.tr("fases") : "") : nil,
            interpretation: plainKcal(data, row: macros.first),
            waterSimple: water.simple + " (\(water.days)/\(data.days.count) \(store.tr("días con registro")))",
            waterTotal: water.total, waterPlan: water.plan, sodiumWarning: sodiumWarning(data, showCoverage: false),
            note: mode.minimum > 1 && mode != .bayes ? phaseHint(data) : nil
        )
    }

}

struct NutriColumns: Layout {
    var columns: Int
    var gap: CGFloat
    var firstWeight: CGFloat = 1

    private func width(_ total: CGFloat, for index: Int) -> CGFloat {
        let content = max(0, total - gap * CGFloat(columns - 1))
        let unit = content / (CGFloat(columns - 1) + firstWeight)
        return unit * (index % columns == 0 ? firstWeight : 1)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? 480
        var height: CGFloat = 0
        for start in stride(from: 0, to: subviews.count, by: columns) {
            let row = start..<min(subviews.count, start + columns)
            if start > 0 { height += gap }
            height += row.map { i in
                subviews[i].sizeThatFits(ProposedViewSize(width: width(total, for: i), height: nil)).height
            }.max() ?? 0
        }
        return CGSize(width: total, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for start in stride(from: 0, to: subviews.count, by: columns) {
            let row = start..<min(subviews.count, start + columns)
            var x = bounds.minX
            let height = row.map { i in subviews[i].sizeThatFits(ProposedViewSize(width: width(bounds.width, for: i), height: nil)).height }.max() ?? 0
            for i in row {
                let w = width(bounds.width, for: i)
                subviews[i].place(at: CGPoint(x: x, y: y), anchor: .topLeading,
                                  proposal: ProposedViewSize(width: w, height: height))
                x += w + gap
            }
            y += height + gap
        }
    }
}

private struct DashboardMenuClose: EnvironmentKey {
    static let defaultValue: (() -> Void)? = nil
}

private struct DashboardMenu<Content: View>: View {
    @Environment(\.nutriPalette) private var palette
    let label: String
    var selected = false
    var ellipsis = false
    var width: CGFloat = 256
    var labelWidth: CGFloat? = nil
    @ViewBuilder let content: () -> Content
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            if ellipsis {
                Text("⋯").foregroundStyle(palette.text3).frame(width: 44, height: 44).contentShape(Rectangle())
            } else {
                HStack(spacing: 4) {
                    Text(label).lineLimit(1).frame(maxWidth: labelWidth).fixedSize(horizontal: labelWidth != nil, vertical: false)
                    Text(open ? "▴" : "▾").font(.nutriSans(12))
                }.padding(.horizontal, 12).frame(minHeight: 44)
                    .foregroundStyle(selected ? palette.bg : palette.text2)
                    .background(selected ? palette.accent : palette.surface2, in: Capsule())
                    .overlay { Capsule().strokeBorder(selected ? Color.clear : palette.border) }
            }
        }.buttonStyle(.plain).accessibilityLabel(label).popover(isPresented: $open, arrowEdge: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) { content() }
                    .environment(\.dashboardMenuClose, { open = false })
                    .padding(4)
            }.frame(width: width).frame(maxHeight: 420).fixedSize(horizontal: false, vertical: true)
                .presentationCompactAdaptation(.popover)
                .background(palette.surface3)
        }
    }
}

private extension EnvironmentValues {
    var dashboardMenuClose: (() -> Void)? {
        get { self[DashboardMenuClose.self] }
        set { self[DashboardMenuClose.self] = newValue }
    }
}

private struct DashboardRangeEdit: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dashboardMenuClose) private var close
    let edit: () -> Void
    var body: some View {
        Button { close?(); edit() } label: { NutriIcon("pencil", size: 16) }
            .buttonStyle(NutriButtonStyle(.quiet, horizontal: 14)).accessibilityLabel(store.tr("Editar rango"))
    }
}

private struct DashboardRangeDelete: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dashboardMenuClose) private var close
    let delete: () -> Void

    var body: some View {
        Button {
            #if os(iOS)
            close?()
            #endif
            delete()
        } label: { NutriIcon("trash-2", size: 16) }
            .buttonStyle(NutriButtonStyle(.quiet, horizontal: 14))
            .accessibilityLabel(store.tr("Eliminar rango"))
    }
}

private struct DashboardMenuRow: View {
    @Environment(\.dashboardMenuClose) private var close
    @Environment(\.nutriPalette) private var palette
    let title: String
    let note: String?
    let enabled: Bool
    var destructive = false
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button {
            close?()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.nutriSans(14)).foregroundStyle(destructive ? palette.danger : palette.text2)
                if let note { Text(note).font(.nutriSans(12)).foregroundStyle(palette.text3) }
            }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(hover ? palette.surface2 : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).onHover { hover = $0 }
            .disabled(!enabled).opacity(enabled ? 1 : 0.5)
    }
}

private struct DashboardKPI: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let title: String
    let value: String
    let detail: String
    let hint: String?
    let delta: Double?
    let color: Color
    let sparkColor: Color
    let points: [Double?]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.nutriSans(12)).foregroundStyle(palette.text3)
            Text(value).font(.nutriMono(18)).foregroundStyle(color)
                .nutriHint(hint)
            if !detail.isEmpty { Text(detail).font(.nutriMono(11)).foregroundStyle(palette.text3) }
            if let delta {
                let value = draftNumber(webRound(delta, digits: 0))
                Text((delta > 0 ? "+" : "") + value + "% " + store.tr("vs. anterior"))
                    .font(.nutriSans(11)).foregroundStyle(palette.text3)
            }
            if points.compactMap({ $0 }).count >= 2 {
                DashboardSparkline(points: points, color: sparkColor).frame(height: 28).padding(.top, 1)
            }
            Spacer(minLength: 0)
        }.padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).nutriCard()
    }
}

private struct DashboardSparkline: View {
    let points: [Double?]
    let color: Color

    var body: some View {
        Canvas { context, size in
            let pairs = points.enumerated().compactMap { index, value in value.map { (index, $0) } }
            guard let firstIndex = pairs.first?.0, let lastIndex = pairs.last?.0, lastIndex > firstIndex,
                  let lo = pairs.map(\.1).min(), let hi = pairs.map(\.1).max() else { return }
            let span = hi == lo ? 1 : hi - lo
            let locations = pairs.map { index, value in
                CGPoint(x: Double(index - firstIndex) * size.width / Double(lastIndex - firstIndex),
                        y: size.height - (value - lo) * size.height / span)
            }
            guard let first = locations.first, let last = locations.last else { return }
            var line = Path()
            line.move(to: first)
            for point in locations.dropFirst() { line.addLine(to: point) }
            var fill = line
            fill.addLine(to: CGPoint(x: last.x, y: size.height))
            fill.addLine(to: CGPoint(x: first.x, y: size.height))
            fill.closeSubpath()
            context.fill(fill, with: .color(color.opacity(0.18)))
            context.stroke(line, with: .color(color), lineWidth: 1.5)
        }.accessibilityHidden(true)
    }
}

private struct DashboardRadar: View {
    @Environment(\.nutriPalette) private var palette
    @State private var selectedAxis: Int?
    let points: [(label: String, value: Double)]

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = max(0, min(size.width / 2 - 88, size.height / 2) * 0.75)
            Canvas { context, _ in
                func location(_ i: Int, _ ratio: Double) -> CGPoint {
                    let angle = angle(for: i)
                    return CGPoint(x: center.x + cos(angle) * radius * ratio, y: center.y + sin(angle) * radius * ratio)
                }
                func polygon(_ ratios: [Double]) -> Path {
                    Path { path in
                        for (i, ratio) in ratios.enumerated() {
                            let point = location(i, ratio)
                            if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
                        }
                        path.closeSubpath()
                    }
                }
                for level in 1...5 {
                    context.stroke(polygon(Array(repeating: Double(level) / 5, count: points.count)), with: .color(palette.border))
                }
                let ratios = points.map { min(1, max(0, $0.value / 150)) }
                let observations = polygon(ratios)
                context.fill(observations, with: .color(palette.accent.opacity(0.35)))
                context.stroke(observations, with: .color(palette.accent), lineWidth: 1.5)
                for i in points.indices {
                    let endpoint = location(i, 1)
                    let selected = selectedAxis == i
                    let axis = Path { path in path.move(to: center); path.addLine(to: endpoint) }
                    context.stroke(axis, with: .color(selected ? palette.accent : palette.border))
                    let text = Text(points[i].label).font(.nutriSans(10)).foregroundStyle(selected ? palette.text : palette.text3)
                    let anchor = abs(endpoint.x - center.x) < 1 ? UnitPoint.center : endpoint.x > center.x ? .leading : .trailing
                    context.draw(text, at: location(i, 1.18), anchor: anchor)
                    if selected {
                        let value = location(i, ratios[i])
                        context.fill(Path(ellipseIn: CGRect(x: value.x - 3, y: value.y - 3, width: 6, height: 6)), with: .color(palette.accent))
                    }
                }
            }
            .contentShape(Rectangle())
            .nutriChartPoint { point in
                let selected = point.flatMap { axis(near: $0, center: center, radius: radius) }
                #if os(iOS)
                selectedAxis = selected == selectedAxis ? nil : selected
                #else
                selectedAxis = selected
                #endif
            }
            .accessibilityLabel(points.indices.map { display($0) }.joined(separator: " · "))
            .accessibilityIdentifier("dashboard.radar")
            .overlay(alignment: .bottom) {
                if let selectedAxis, points.indices.contains(selectedAxis) {
                    Text(display(selectedAxis)).font(.nutriSans(12))
                        .padding(8).nutriCard(radius: 8, fill: palette.surface3)
                        .accessibilityIdentifier("dashboard.radar.value")
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private func angle(for index: Int) -> Double {
        2 * .pi * Double(index) / Double(points.count) - .pi / 2
    }

    private func axis(near point: CGPoint, center: CGPoint, radius: CGFloat) -> Int? {
        let dx = point.x - center.x
        let dy = point.y - center.y
        guard radius > 0, hypot(dx, dy) <= radius * 1.6, !points.isEmpty else { return nil }
        let turn = (atan2(dy, dx) + .pi / 2) / (2 * .pi)
        let index = Int((turn * Double(points.count)).rounded())
        return (index + points.count) % points.count
    }

    private func display(_ index: Int) -> String {
        let point = points[index]
        return point.label + " · " + draftNumber(webRound(point.value, digits: 0)) + "%"
    }
}

private func bayesCriterion(_ data: DashboardSnapshot, key: String, translate: (String) -> String) -> String {
    if data.complete.contains(where: {
        let bound = $0.target?.object("bounds").object(key) ?? [:]
        return bound.number("min") != nil || bound.number("max") != nil
    }) {
        return translate(key == "sodio_mg" ?
            "Cuenta como día cumplido si el sodio quedó entre el piso médico (1,500 mg) y tu máximo de Metas." :
            "Cuenta como día cumplido si quedaste dentro del mín–máx que fijaste en Metas.")
    }
    if key == "sodio_mg" {
        return translate("Cuenta como día cumplido si el sodio quedó entre %a y %b mg.")
            .replacingOccurrences(of: "%a", with: numberText(Domain.sodiumFloor, digits: 0))
            .replacingOccurrences(of: "%b", with: numberText(Domain.sodiumCeiling, digits: 0))
    }
    if ["kcal", "carbs_g", "fat_g"].contains(key) {
        return translate("Cuenta como día cumplido si quedaste a ±%n% de tu objetivo.").replacingOccurrences(of: "%n", with: "10")
    }
    return translate(dailyCeilings.contains(key) ? "Cuenta como día cumplido si te quedaste en o bajo tu objetivo." :
        "Cuenta como día cumplido si llegaste a tu objetivo o lo pasaste.")
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
    @Environment(\.nutriPalette) private var palette
    @State var draft: DashboardChartDraft
    let editing: Bool
    let close: () -> Void
    let onSave: (Record) async throws -> Void
    @State private var busy = false
    @State private var error = ""

    private var defaultTitle: String { draft.fields.map { store.tr($0.label) }.joined(separator: " + ") }

    var body: some View {
        NutriSheet(store.tr(editing ? "Editar gráfica" : "Nueva gráfica"), close: close) {
            VStack(alignment: .leading, spacing: 12) {
                caption("Título")
                TextField(draft.variables.isEmpty ? store.tr("Opcional") : defaultTitle, text: $draft.title).nutriInput()
                caption("Tipo")
                segments([("line", "Línea"), ("bar", "Barras")], selected: draft.type) { draft.type = $0 }
                HStack(spacing: 4) {
                    caption("Granularidad")
                    hint("Cómo se agrupan los días en el tiempo. Auto lo decide por el rango: hasta ~mes → día, hasta ~medio año → semana, más → mes. Así un año no pinta 365 puntos.")
                }
                segments([("auto", "Auto"), ("dia", "Día"), ("semana", "Semana"), ("mes", "Mes")], selected: draft.aggregation) { draft.aggregation = $0 }
                caption("Reductor por bucket")
                segments([("promedio", "Promedio"), ("suma", "Suma"), ("mediana", "Mediana")],
                         selected: draft.effectiveReducer, disabled: draft.stock ? ["suma"] : []) { draft.reducer = $0 }
                if draft.stock {
                    explanation("Suma deshabilitada: la gráfica incluye una medida (peso/circunferencia/derivada). Usa Promedio o Mediana.")
                }
                if draft.aggregation == "dia" {
                    explanation("En granularidad Día el reductor no aplica (un punto por día).")
                }
                HStack(spacing: 4) {
                    Text(store.tr("Variables") + " · \(draft.variables.count)/4").font(.nutriSans(12)).foregroundStyle(palette.text3)
                    hint("Elige de 1 a %v variables. Con 2 unidades distintas se usan 2 ejes (izquierda y derecha), como Peso (kg) + Cintura (cm). Para una 3ª unidad, crea otra gráfica.", replacing: "%v", with: "4")
                }
                ForEach(DashboardVariable.categories, id: \.self) { category in
                    VStack(alignment: .leading, spacing: 4) {
                        explanation(category)
                        NutriFlow(spacing: 6, lineSpacing: 6) {
                            ForEach(DashboardVariable.all.filter { $0.category == category }) { item in
                                variable(item)
                            }
                        }
                    }
                }
                if !error.isEmpty { Text(error).font(.nutriSans(12)).foregroundStyle(palette.danger) }
            }.disabled(busy)
        } footer: {
            Button {
                Task {
                    busy = true
                    error = ""
                    defer { busy = false }
                    do {
                        try await onSave(draft.record(title: defaultTitle))
                        close()
                    } catch { self.error = store.failure(error, "No se pudo guardar la gráfica — reintenta.") }
                }
            } label: {
                Text(store.tr("Guardar gráfica")).frame(maxWidth: .infinity)
            }.buttonStyle(NutriButtonStyle(.primary)).keyboardShortcut(.defaultAction)
                .disabled(draft.variables.isEmpty || busy)
        }
    }

    private func caption(_ title: String) -> some View {
        Text(store.tr(title)).font(.nutriSans(12)).foregroundStyle(palette.text3)
    }

    private func explanation(_ title: String) -> some View {
        Text(store.tr(title)).font(.nutriSans(11)).foregroundStyle(palette.text3)
    }

    private func hint(_ text: String, replacing: String = "", with value: String = "") -> some View {
        let localized = store.tr(text)
        let content = replacing.isEmpty ? localized : localized.replacingOccurrences(of: replacing, with: value)
        return NutriHintButton(text: content) { Text("ⓘ").font(.nutriSans(12)).foregroundStyle(palette.text3) }
    }

    private func segments(_ values: [(String, String)], selected: String, disabled: Set<String> = [], action: @escaping (String) -> Void) -> some View {
        HStack(spacing: 4) {
            ForEach(values, id: \.0) { key, title in
                Button { action(key) } label: {
                    Text(store.tr(title)).font(.nutriSans(12, weight: selected == key ? .medium : .regular))
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .foregroundStyle(selected == key ? palette.bg : palette.text2)
                        .background(selected == key ? palette.accent : .clear, in: RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain).disabled(disabled.contains(key)).opacity(disabled.contains(key) ? 0.45 : 1)
                    .nutriHint(disabled.contains(key) ? store.tr("Sumar medidas no tiene sentido; usa Promedio o Mediana") : nil)
                    .accessibilityAddTraits(selected == key ? .isSelected : [])
            }
        }.padding(4).nutriCard(radius: 12, fill: palette.surface2)
    }

    private func variable(_ item: DashboardVariable) -> some View {
        let selected = draft.variables.contains(item.id)
        let reason = disabledReason(item, selected: selected)
        return Button {
            if selected { draft.variables.removeAll { $0 == item.id } }
            else { draft.variables.append(item.id) }
        } label: {
            Text(store.tr(item.label) + (selected ? " ✕" : ""))
                .font(.nutriSans(12)).lineLimit(1).padding(.horizontal, 10).padding(.vertical, 6)
                .foregroundStyle(selected ? palette.text : reason == nil ? palette.text2 : palette.text3)
                .background(selected ? palette.surface3 : palette.surface2, in: RoundedRectangle(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(selected ? palette.accent : palette.border) }
        }.buttonStyle(.plain).disabled(reason != nil).opacity(reason == nil ? 1 : 0.45).nutriHint(reason)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func disabledReason(_ item: DashboardVariable, selected: Bool) -> String? {
        guard !selected else { return nil }
        if draft.variables.count >= 4 { return store.tr("Máximo %n variables").replacingOccurrences(of: "%n", with: "4") }
        if !draft.units.contains(item.unit) && draft.units.count >= 2 {
            return store.tr("Máximo %n unidades por gráfica").replacingOccurrences(of: "%n", with: "2")
        }
        return nil
    }
}

private struct DashboardPlot: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let definition: DashboardChartDraft
    let data: DashboardSnapshot
    let heightCm: Double?
    var chartHeight: CGFloat = 288
    var empty = "Sin datos en el rango"
    var trend = false
    @State private var hovered: String?

    private struct Point: Identifiable {
        var id: String { key + ":" + date }
        let date: String
        let value: Double
        let key: String
        let label: String
        let unit: String
        let reference: Bool
    }

    private struct Axis {
        let lower: Double
        let upper: Double
        let ticks: [Double]

        init(_ values: [Double], bars: Bool) {
            let minimum = values.min() ?? 0
            let maximum = values.max() ?? 0
            let low = bars ? min(0, minimum) : minimum
            let high = bars ? max(0, maximum) : maximum
            let span = high > low ? high - low : max(1, abs(high) * 0.1)
            let magnitude = pow(10, floor(log10(span / 4)))
            let scaled = span / (4 * magnitude)
            let step = (scaled > 5 ? 10 : scaled > 2 ? 5 : scaled > 1 ? 2 : 1) * magnitude
            lower = floor(low / step) * step - (high == low ? step : 0)
            upper = max(lower + step, ceil(high / step) * step + (high == low ? step : 0))
            let count = Int(((upper - lower) / step).rounded())
            let start = lower
            ticks = (0...count).map { start + step * Double($0) }
        }
        func fraction(_ value: Double) -> Double { (value - lower) / (upper - lower) }
        func value(_ fraction: Double) -> Double { lower + fraction * (upper - lower) }
    }

    private var aggregation: String {
        if definition.aggregation != "auto" { return definition.aggregation }
        if data.days.count <= 45 { return "dia" }
        return data.days.count <= 182 ? "semana" : "mes"
    }

    private func bucket(_ date: Date) -> String {
        switch aggregation {
        case "semana":
            let dow = Calendar.current.component(.weekday, from: date)
            return Day.key(addingDays(-((dow + 5) % 7), to: date))
        case "mes": return String(Day.key(date).prefix(7))
        default: return Day.key(date)
        }
    }

    private func reduced(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        if aggregation == "dia" { return values.first }
        let value: Double?
        switch definition.effectiveReducer {
        case "suma": value = values.reduce(0, +)
        case "mediana": value = dashboardQuantile(values, 0.5)
        default: value = mean(values)
        }
        return value.map { webRound($0, digits: 2) }
    }

    private func points(_ days: [DashboardDay], bucket: String) -> [Point] {
        let fields = definition.fields
        var points = fields.compactMap { variable -> Point? in
            let samples = days.compactMap { day in
                variable.observed(on: day, body: data.body[day.id] ?? [:], height: heightCm)
            }
            guard let raw = reduced(samples) else { return nil }
            let value = trend ? webRound(raw, digits: variable.unit == "g" && variable.source == .micro ? 1 : 0) : raw
            return Point(date: bucket, value: value, key: variable.id, label: variable.label, unit: variable.unit, reference: false)
        }
        if fields.count == 1, let variable = fields.first, !variable.stock {
            let target = reduced(days.compactMap { $0.target.flatMap { nutritionValue($0, variable.id) } })
            if let target {
                points.append(Point(date: bucket, value: target, key: "target", label: "Objetivo", unit: variable.unit, reference: true))
            }
        }
        return points
    }

    var body: some View {
        let groups = Dictionary(grouping: data.days) { bucket($0.date) }
        let labels = groups.keys.sorted()
        let rows = labels.flatMap { key in points(groups[key] ?? [], bucket: key) }
        let units = Array(definition.units.prefix(2))
        VStack(alignment: .leading, spacing: 8) {
            if rows.contains(where: { !$0.reference }) {
                plot(rows, labels: labels, units: units)
            } else {
                Text(store.tr(empty)).foregroundStyle(palette.text2).frame(maxWidth: .infinity).padding(.vertical, 32)
            }
            if !trend && (aggregation != "dia" || units.count > 1) {
                let bucket = store.tr(["dia": "Día", "semana": "Semana", "mes": "Mes"][aggregation] ?? aggregation)
                let reducer = store.tr(["promedio": "Promedio", "suma": "Suma", "mediana": "Mediana"][definition.effectiveReducer] ?? definition.effectiveReducer)
                let scale = units.count > 1 ? " · " + store.tr("Eje izq: %l · Eje der: %r")
                    .replacingOccurrences(of: "%l", with: units[0]).replacingOccurrences(of: "%r", with: units[1]) : ""
                Text(bucket + (aggregation == "dia" ? "" : " · " + reducer) + scale)
                    .font(.nutriSans(11)).foregroundStyle(palette.text3)
            }
        }
    }

    private func plot(_ rows: [Point], labels: [String], units: [String]) -> some View {
        let rightUnit = units.dropFirst().first
        let paired = rightUnit != nil
        let bars = definition.type == "bar"
        let left = Axis(rows.filter { $0.unit != rightUnit }.map(\.value), bars: bars)
        let right = Axis(rows.filter { $0.unit == rightUnit }.map(\.value), bars: bars)
        let colors = [palette.protein, palette.carbs, palette.kcal, palette.fat]
        let seriesColors = Dictionary(uniqueKeysWithValues: definition.fields.enumerated().map { ($0.element.id, colors[$0.offset % colors.count]) })
        let legends = definition.fields.map { ($0.label, seriesColors[$0.id] ?? palette.protein, false) } +
            (rows.contains(where: \.reference) ? [("Objetivo", palette.accent, true)] : [])
        let xStride = max(1, (labels.count + 7) / 8)
        let xTicks = labels.enumerated().compactMap { $0.offset % xStride == 0 ? $0.element : nil }
        return VStack(spacing: 8) {
            Chart(rows) { point in
                let axis = point.unit == rightUnit ? right : left
                let position = axis.fraction(point.value)
                let color = point.reference ? palette.accent : seriesColors[point.key] ?? palette.protein
                if bars && !point.reference {
                    BarMark(x: .value("Fecha", point.date), yStart: .value("Valor", axis.fraction(0)), yEnd: .value("Valor", position))
                        .foregroundStyle(color).position(by: .value("Variable", point.key)).cornerRadius(3)
                } else {
                    LineMark(x: .value("Fecha", point.date), y: .value("Valor", position), series: .value("Variable", point.key))
                        .interpolationMethod(point.reference ? .linear : .monotone)
                        .foregroundStyle(color).lineStyle(StrokeStyle(lineWidth: 2, dash: point.reference ? [4, 3] : []))
                    if !point.reference {
                        PointMark(x: .value("Fecha", point.date), y: .value("Valor", position))
                            .foregroundStyle(color).symbolSize(point.date == hovered ? 30 : 12)
                    }
                }
            }
            .chartXScale(domain: labels)
            .chartYScale(domain: 0.0...1.0)
            .chartXAxis {
                AxisMarks(values: xTicks) { tick in
                    AxisValueLabel {
                        if let key = tick.as(String.self) { Text(axisLabel(key)).font(.nutriSans(10)).foregroundStyle(palette.text3) }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: left.ticks.map(left.fraction)) { tick in
                    AxisGridLine().foregroundStyle(palette.border)
                    AxisValueLabel {
                        if let fraction = tick.as(Double.self) { tickLabel(left.value(fraction)) }
                    }
                }
                if paired {
                    AxisMarks(position: .trailing, values: right.ticks.map(right.fraction)) { tick in
                        AxisValueLabel {
                            if let fraction = tick.as(Double.self) { tickLabel(right.value(fraction)) }
                        }
                    }
                }
            }
            .dashboardHover($hovered) { key in
                customTooltip(key, rows: rows.filter { $0.date == key })
            }
            dashboardLegend(legends, translate: store.tr, theme: palette)
        }.frame(height: chartHeight)
    }

    private func axisLabel(_ key: String) -> String { aggregation == "mes" ? key : String(key.dropFirst(5)) }

    private func customTooltip(_ key: String, rows: [Point]) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(axisLabel(key))
            ForEach(rows) { point in
                let decimal = point.unit == "g" || point.unit == "%" ? 1 : 0
                let amount = draftNumber(webRound(point.value, digits: decimal))
                Text(store.tr(point.label) + " · " + amount + (point.reference ? "" : " " + point.unit))
            }
        }.font(.nutriSans(12)).padding(8).nutriCard(radius: 8, fill: palette.surface3)
    }

    private func tickLabel(_ value: Double) -> some View {
        Text(draftNumber(webRound(value, digits: 2))).font(.nutriSans(10)).foregroundStyle(palette.text3)
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
        let defaultFrom = addingDays(-29, to: current)
        var lower = defaultFrom
        var upper = current
        if let from = isoDate(raw.text("date_from")), let to = isoDate(raw.text("date_to")) {
            lower = from
            upper = min(to, current)
            if lower > upper { swap(&lower, &upper) }
        }
        let minStart = addingDays(-91, to: upper)
        clamped = lower < minStart
        from = Day.key(max(lower, minStart))
        to = Day.key(upper)
        detail = raw["need_detail"]?.bool == true
        let allowed = Set(nutritionMacros.map(\.key) + Domain.micros.map(\.key))
        let list = raw.array("nutrients").compactMap(\.string).filter { allowed.contains($0) }
        nutrients = list.isEmpty ? nutritionMacros.map(\.key) : list
    }
}

private func dashboardCSV(_ rows: [[String]]) -> String {
    rows.map { row in
        row.map { field in
            guard field.contains(where: { $0 == "," || $0 == "\"" || $0.unicodeScalars.contains("\n") }) else { return field }
            return "\"" + field.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }.joined(separator: ",")
    }.joined(separator: "\n")
}

// Mirrors JS Math.round (half up), unlike Domain.round (SQL half away from zero).
private func webRound(_ value: Double, digits: Int) -> Double {
    let scale = pow(10.0, Double(digits))
    return floor(value * scale + 0.5) / scale
}

private func askContext(plan: DashboardAskPlan, days: [Record], targets: [Record], entries: [Record]?) -> String {
    func round(_ value: Double?) -> String { draftNumber(value.map { webRound($0, digits: 1) }) }
    let header = ["day"] + plan.nutrients
    let sorted = days.sorted { $0.text("day") < $1.text("day") }
    let observed = sorted.map { row in
        [row.text("day")] + plan.nutrients.map { round(nutritionValue(row, $0)) }
    }
    let reference = sorted.map { row in
        let target = Domain.resolveTarget(targets, row.text("day")) ?? [:]
        return [row.text("day")] + plan.nutrients.map { round(nutritionValue(target, $0)) }
    }
    var sections = [
        "# Totales diarios (unidades: kcal, g o mg segun la clave)",
        dashboardCSV([header] + observed),
        "# Objetivo del día (mismas columnas; vacío si no hay)",
        dashboardCSV([header] + reference)
    ]
    if let entries {
        let extra = plan.nutrients.filter { $0 != "kcal" }
        let selected = entries.count > 400 ? Array(entries.sorted { ($0.number("kcal") ?? 0) > ($1.number("kcal") ?? 0) }.prefix(400)) : entries
        let details = selected.map { row in
            [row.text("day"), row.text("item"), round(row.number("grams") ?? 0), round(row.number("kcal") ?? 0)] +
            extra.map { round(nutritionValue(row, $0)) }
        }
        sections += ["# Alimentos", dashboardCSV([["day", "item", "grams", "kcal"] + extra] + details)]
        if entries.count > 400 { sections.append("(recortado a 400 alimentos de \(entries.count))") }
    }
    return sections.joined(separator: "\n")
}

private struct DashboardAnswer: Identifiable {
    let id = UUID()
    let question: String
    let answer: String
    let clamped: Bool
}

private struct AskLogView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let targets: [Record]
    @Binding var question: String
    @Binding var busy: Bool
    @Binding var history: [DashboardAnswer]
    let close: () -> Void

    var body: some View {
        NutriSheet(store.tr("Pregúntale a tu bitácora"), close: close) {
            VStack(alignment: .leading, spacing: 12) {
                if history.isEmpty && !busy {
                    Text(store.tr("Pregunta algo sobre tus registros, p. ej. \"¿Cuánto sodio comí esta semana?\"")).foregroundStyle(palette.text3)
                }
                ForEach(history) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.question).font(.nutriSans(14, weight: .medium))
                        Text(entry.answer).foregroundStyle(palette.text2).textSelection(.enabled)
                        if entry.clamped {
                            Text(store.tr("Rango recortado a 92 días")).font(.nutriSans(12)).foregroundStyle(palette.warn)
                        }
                    }
                }
                if busy { Text(store.tr("Pensando…")).foregroundStyle(palette.text3) }
                HStack {
                    TextField(store.tr("Escribe tu pregunta…"), text: $question)
                        .nutriInput().disabled(busy)
                        .onSubmit { Task { await submit() } }
                    Button(store.tr("Enviar")) { Task { await submit() } }.buttonStyle(NutriButtonStyle(.primary))
                        .disabled(busy || cleanText(question).isEmpty)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        } footer: {
            Text(store.tr(store.demoActive || store.anonymous ?
                "En la demo la IA muestra un ejemplo fijo; en la app real analiza tu texto o foto." :
                "Respuesta generada por IA — verifica contra el Dashboard."))
                .font(.nutriSans(12)).foregroundStyle(palette.text3).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func submit() async {
        let input = cleanText(question)
        guard !input.isEmpty, !busy else { return }
        question = ""
        busy = true
        defer { busy = false }
        let today = Date()
        let language = store.lang
        do {
            let plan: DashboardAskPlan
            if store.demoActive || store.anonymous {
                plan = DashboardAskPlan([:], today: today)
            } else {
                let keys = nutritionMacros.map(\.key) + Domain.micros.map(\.key)
                let schema = aiObject([
                    "date_from": aiSchema("STRING"), "date_to": aiSchema("STRING"), "need_detail": aiSchema("BOOLEAN"),
                    "nutrients": aiArray(aiSchema("STRING"))
                ], required: ["date_from", "date_to", "need_detail", "nutrients"])
                let langInstruction = language == "en" ? "Answer only via the schema fields." : "Responde solo con los campos del schema."
                let prompt = """
                Dada una pregunta del usuario sobre su registro nutricional y la fecha de hoy (\(Day.key(today)), formato YYYY-MM-DD), decide el rango de fechas a consultar (date_from, date_to, formato YYYY-MM-DD), si hacen falta alimentos individuales (need_detail: true cuando la pregunta pide causas, alimentos concretos o "qué comí") y qué nutrientes están implicados (nutrients: claves EXACTAS de esta lista, nunca inventes otras): \(keys.joined(separator: ", ")). \(langInstruction)
                """
                let raw = try await generateNutritionJSON(store: store, prompt: prompt, parts: [["text": .string(input)]], schema: schema)
                plan = DashboardAskPlan(raw, today: today)
            }
            let filter = dateFilter(plan.from, plan.to)
            async let totals = dashboardPage(store: store, table: "daily_totals", query: filter)
            async let foods = askEntries(plan.detail, filter)
            let (days, entries) = try await (totals, foods)
            let context = askContext(plan: plan, days: days, targets: targets, entries: entries)
            let answer: String
            if store.demoActive || store.anonymous {
                answer = language == "en" ?
                    "Demo example: over the last 7 days you averaged ~1,950 kcal and ~140 g of protein; your highest-sodium day was driven by the chilaquiles." :
                    "Ejemplo de demo: en los últimos 7 días promediaste ~1,950 kcal y ~140 g de proteína; el día más alto en sodio fue por los chilaquiles."
            } else {
                let answerSchema = aiObject(["answer": aiSchema("STRING")], required: ["answer"])
                let idioma = language == "en" ? "inglés" : "español"
                let answerPrompt = """
                Eres el asistente de datos de una app de registro nutricional personal. Responde la pregunta usando EXCLUSIVAMENTE las cifras del contexto; nunca inventes ni extrapoles valores. Cita días y alimentos concretos (ej. "El 12 jul: 2,890 mg de sodio, principalmente Chilaquiles 320 g"). Describe los datos, no prescribas ni des consejo médico. Responde en \(idioma), conciso, en texto plano sin markdown.
                """
                let response = try await generateNutritionJSON(store: store, prompt: answerPrompt,
                    parts: [["text": .string("Contexto:\n\(context)\n\nPregunta: \(input)")]], schema: answerSchema)
                answer = response.text("answer")
            }
            history.append(DashboardAnswer(question: input, answer: answer, clamped: plan.clamped))
        } catch {
            history.append(DashboardAnswer(question: input, answer: store.tr("No se pudo responder — intenta de nuevo"), clamped: false))
        }
    }

    private func askEntries(_ detail: Bool, _ filter: [String: String]) async throws -> [Record]? {
        guard detail else { return nil }
        return try await dashboardPage(store: store, table: "entry_nutrients", query: filter.merging([
            "select": "day,item,grams,kcal,protein_g,carbs_g,fat_g,micros", "order": "day.asc,id.asc"
        ]) { _, new in new })
    }
}

private func rawDashboardCSV(_ rows: [Record], unlabelled: String) throws -> Data {
    let keys = ["day", "meal_label", "tipo", "item", "grams", "kcal", "protein_g", "carbs_g", "fat_g"]
    let microKeys = Domain.micros.map(\.key)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let lines = try rows.map { row in
        let coverage = try encoder.encode(JSONValue.object(row.object("micros_complete")))
        let meal = row.text("meal")
        let initial = [row.text("day"), meal.isEmpty ? unlabelled : meal, row.text("food_id").isEmpty ? "recipe" : "food", row.text("item")]
        let macros = keys.dropFirst(4).map { draftNumber(row.number($0)) }
        let observed = microKeys.map { draftNumber(nutritionValue(row, $0)) }
        return initial + macros + observed + [String(decoding: coverage, as: UTF8.self)]
    }
    return Data(("\u{FEFF}" + dashboardCSV([keys + microKeys + ["micros_complete"]] + lines)).utf8)
}

private func summaryDashboardCSV(_ summaries: [DashboardSummary], mode: DashboardCalculation, translate: (String) -> String) -> Data {
    let headers = ["nutriente", "clave", "unidad", translate(mode.title), "detalle", "objetivo", "%_objetivo", "cobertura"]
    let lines = summaries.map { row in
        [translate(row.variable.label), row.id, row.variable.unit] + row.cells(mode, translate: translate) +
        [translate(row.coverage == .partial ? "Parcial" : "Completa")]
    }
    return Data(("\u{FEFF}" + dashboardCSV([headers] + lines)).utf8)
}

private struct DashboardReportPreview: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let report: DashboardReport
    let filename: String
    let close: () -> Void
    @State private var error = ""
    @State private var fileExport = FeatureFileExport()
    #if os(iOS)
    @State private var document: PDFDocument?
    @State private var pdfData: Data?
    #endif

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if !error.isEmpty { Text(error).foregroundStyle(palette.danger) }
                Spacer()
                Button(store.tr("Cerrar"), action: close).buttonStyle(NutriButtonStyle(.secondary, radius: 22))
                    .keyboardShortcut(.cancelAction)
                Button(store.tr("Guardar PDF")) { save() }.buttonStyle(NutriButtonStyle(.primary, radius: 22))
                    #if os(iOS)
                    .disabled(document == nil)
                    #endif
            }.padding(12)
            #if os(iOS)
            if let document {
                DashboardPDFView(document: document)
            } else {
                VStack {
                    if error.isEmpty {
                        ProgressView().accessibilityLabel(store.tr("Cargando…"))
                    } else {
                        Button(store.tr("Reintentar"), action: preparePDF)
                            .buttonStyle(NutriButtonStyle(.secondary))
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            #else
            GeometryReader { geometry in
                ScrollView([.horizontal, .vertical]) {
                    report.paper(printing: false).environmentObject(store)
                        .environment(\.colorScheme, .light)
                        .contentShape(Rectangle()).onTapGesture {}
                        .padding(.horizontal, 16).padding(.bottom, 16)
                        .frame(width: max(752, geometry.size.width), alignment: .top)
                }.onTapGesture(perform: close)
            }
            #endif
        }
        .font(.nutriSans(14))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.onTapGesture(perform: close))
        .accessibilityAddTraits(.isModal)
        .nutriFeatureExport($fileExport) { error = $0.localizedDescription }
        #if os(iOS)
        .task { if document == nil { preparePDF() } }
        #endif
    }

    #if os(iOS)
    private func preparePDF() {
        error = ""
        do {
            let bytes = try report.pdf(store: store)
            guard let pdf = PDFDocument(data: bytes) else { throw FeatureError("No se pudo generar el PDF.") }
            document = pdf
            pdfData = bytes
        } catch { self.error = store.tr(error.localizedDescription) }
    }
    #endif

    private func save() {
        do {
            #if os(iOS)
            guard let bytes = pdfData else { return }
            #else
            let bytes = try report.pdf(store: store)
            #endif
            try fileExport.save(bytes, name: filename, type: .pdf)
        } catch { self.error = error.localizedDescription }
    }
}

#if os(iOS)
private struct DashboardPDFView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .black
        view.document = document
        view.autoScales = true
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}
#endif

private struct DashboardReport {
    let data: DashboardSnapshot
    let mode: DashboardCalculation
    let bands: Record
    let macros: [DashboardSummary]
    let micros: [DashboardSummary]
    let stats: String
    let phase: String?
    let interpretation: String?
    let waterSimple: String
    let waterTotal: String
    let waterPlan: Bool
    let sodiumWarning: String?
    let note: String?

    func paper(printing: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            sections(printing: printing)
        }
        .padding(printing ? 0 : 28)
        .frame(width: printing ? 710 : 720, alignment: .leading)
        .background(.white)
        .clipShape(RoundedRectangle(cornerRadius: printing ? 0 : 8))
        .shadow(color: .black.opacity(printing ? 0 : 0.4), radius: 20, y: 8)
    }

    @ViewBuilder private func sections(printing: Bool) -> some View {
        DashboardReportSection(report: self, kind: .heading)
        DashboardReportSection(report: self, kind: .intro)
        DashboardReportSection(report: self, kind: .chart(printing: printing))
        DashboardReportSection(report: self, kind: .table(title: "Macronutrientes", rows: macros))
        DashboardReportSection(report: self, kind: .table(title: "Micronutrientes visibles", rows: micros))
        DashboardReportSection(report: self, kind: .footer)
    }

    @MainActor func pdf(store: Store) throws -> Data {
        let content = NSMutableData()
        var page = CGRect(x: 0, y: 0, width: 612, height: 792)
        guard let consumer = CGDataConsumer(data: content as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &page, nil) else {
            throw FeatureError("No se pudo generar el PDF.")
        }
        let margin: CGFloat = 14.0 / 25.4 * 72.0
        let width = page.width - 2 * margin
        let cssWidth = width * 4 / 3
        var kinds: [DashboardReportSection.Kind] = [.heading, .intro, .chart(printing: true), .table(title: "Macronutrientes", rows: macros)]
        // Browser keeps sections together when possible. Only a very long
        // favorites table needs to repeat its headers across paper pages.
        let batches = stride(from: 0, to: micros.count, by: 28).map {
            Array(micros[$0..<min($0 + 28, micros.count)])
        }
        kinds += batches.dropLast().map { .table(title: "Micronutrientes visibles", rows: $0) }
        if let last = batches.last { kinds.append(.closingTable(rows: last)) }
        else { kinds.append(.footer) }
        var y: CGFloat = page.height - margin
        context.beginPDFPage(nil)
        for section in kinds {
            try render(section, cssWidth: cssWidth, page: page, margin: margin, context: context, y: &y, store: store)
        }
        context.endPDFPage()
        context.closePDF()
        return content as Data
    }

    @MainActor private func render(
        _ section: DashboardReportSection.Kind, cssWidth: CGFloat, page: CGRect,
        margin: CGFloat, context: CGContext, y: inout CGFloat, store: Store
    ) throws {
        let view = DashboardReportSection(report: self, kind: section)
            .environmentObject(store).environment(\.colorScheme, .light)
            .frame(width: cssWidth)
            .fixedSize(horizontal: false, vertical: true)
        let renderer = ImageRenderer(content: view)
        renderer.proposedSize = ProposedViewSize(width: cssWidth, height: nil)
        var rendered = false
        renderer.render { size, draw in
            let height = size.height * 0.75
            if y - height < margin {
                context.endPDFPage()
                context.beginPDFPage(nil)
                y = page.height - margin
            }
            context.saveGState()
            context.translateBy(x: margin, y: y - height)
            context.scaleBy(x: 0.75, y: 0.75)
            draw(context)
            context.restoreGState()
            y -= height + 12
            rendered = true
        }
        if !rendered { throw FeatureError("No se pudo generar el PDF.") }
    }
}

private struct DashboardReportSection: View {
    enum Kind {
        case heading, intro, chart(printing: Bool)
        case table(title: String, rows: [DashboardSummary])
        case closingTable(rows: [DashboardSummary])
        case footer
    }
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let report: DashboardReport
    let kind: Kind
    private var mode: DashboardCalculation { report.mode }
    private var data: DashboardSnapshot { report.data }

    var body: some View {
        content.font(.nutriSans(14)).foregroundStyle(palette.text)
    }

    @ViewBuilder private var content: some View {
        switch kind {
        case .heading: heading
        case .intro: intro
        case .chart(let printing): chart(printing: printing)
        case .table(let title, let rows): table(title, rows: rows)
        case .closingTable(let rows):
            VStack(alignment: .leading, spacing: 16) {
                table("Micronutrientes visibles", rows: rows)
                footer
            }
        case .footer: footer
        }
    }

    private var heading: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                if let icon = NutriIcon.assets["nutri-logo"] {
                    Image(nutriImage: icon).renderingMode(.original).resizable().scaledToFit()
                        .frame(width: 40, height: 40).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("nutrimetry").font(.nutriDisplay(24))
                    Text(store.tr("Informe del periodo") + " — " + store.tr(mode.title)).foregroundStyle(palette.text2)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(data.period.start + " → " + data.period.end).font(.nutriMono(12))
                    if let phase = report.phase { Text(phase) }
                    Text(store.tr("Generado el %n").replacingOccurrences(of: "%n", with: Day.key(Date())))
                }.foregroundStyle(palette.text3).font(.nutriSans(12))
            }
            Rectangle().fill(palette.accent).frame(height: 2)
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(report.stats)
            if let interpretation = report.interpretation { Text(interpretation) }
            Text(store.tr("Agua simple registrada") + ": " + report.waterSimple)
            Text(store.tr("Agua total observada") + ": " + report.waterTotal)
            if report.waterPlan {
                Text(store.tr("Plan v6.6: piso operativo diario 2 L de agua simple; objetivo orientativo 3.5 L. No es techo ni cuota."))
            }
            if let warning = report.sodiumWarning { Text(warning).foregroundStyle(palette.danger) }
            NutriColumns(columns: 4, gap: 8) {
                ForEach(report.macros) { row in
                    let label = store.tr(["protein_g": "Prot", "carbs_g": "Carbs"][row.id] ?? row.variable.label)
                    VStack(spacing: 4) {
                        Text(metricDisplay(row)).font(.nutriMono(18)).foregroundStyle(palette.nutrient(row.id))
                        if !row.detail.isEmpty { Text(secondary(row)).font(.nutriMono(12)).foregroundStyle(palette.text3) }
                        Text(label).font(.nutriSans(12)).foregroundStyle(palette.text3)
                    }.frame(maxWidth: .infinity)
                }
            }.padding(12).overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border) }.padding(.top, 8)
        }.foregroundStyle(palette.text2)
    }

    private func metricDisplay(_ row: DashboardSummary) -> String {
        if row.display.isEmpty { return row.hint == nil ? "–" : store.tr("Sin objetivo") }
        if mode == .standardDeviation { return "σ " + row.display }
        if mode == .trend { return ((row.value ?? -1) >= 0 ? "+" : "") + row.display + "/" + store.tr("día") }
        return row.display
    }

    private func secondary(_ row: DashboardSummary) -> String {
        if mode == .bayes, let credible = row.bayesInterval {
            return store.tr("probablemente entre %a y %b%").replacingOccurrences(of: "%a", with: draftNumber(credible.low))
                .replacingOccurrences(of: "%b", with: draftNumber(credible.high))
        }
        return row.detail
    }

    private func chart(printing: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            let heat = mode == .median || mode == .bayes
            Text(store.tr(heat ? "Adherencia (kcal por día)" : "Kcal por día")).foregroundStyle(palette.text3)
            if heat {
                let weekSize = min(14, (650 / Double(max(1, (data.days.count + 12) / 7))) - 2)
                DashboardHeatmap(days: data.days, bands: report.bands, square: max(1, weekSize), spacing: 2, translate: store.tr)
                let entries = [
                    ("en meta (±5%)", palette.ok), ("cerca (±15%)", palette.warn),
                    ("lejos (>15%)", palette.danger), ("sin registro", palette.surface2)
                ]
                HStack(spacing: 12) {
                    ForEach(entries.indices, id: \.self) { index in
                        HStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 3).fill(entries[index].1).frame(width: 12, height: 12)
                            Text(store.tr(entries[index].0)).font(.nutriSans(12)).foregroundStyle(palette.text3)
                        }
                    }
                }
            } else {
                DashboardEnergyPlot(days: data.days, height: 230, printStyle: true)
            }
        }
    }

    private func table(_ title: String, rows: [DashboardSummary]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(store.tr(title)).foregroundStyle(palette.text3)
            tableRow([store.tr("Nutriente"), store.tr(mode.column), store.tr("Detalle"), store.tr("Objetivo"), "%"], heading: true)
            ForEach(rows) { row in
                Rectangle().fill(palette.border).frame(height: 1)
                let cells = row.cells(mode, translate: store.tr)
                let partial = row.coverage == .partial
                let label = store.tr(row.variable.label) + (partial ? " ⚠ " + store.tr("Parcial") : "")
                let showValue = !cells[0].isEmpty && !(partial && mode == .bayes)
                let unit = row.sampleCount == 0 || mode == .bayes ? "" : " " + row.variable.unit
                let value = showValue ? cells[0] + unit : "—"
                let objective = cells[2].isEmpty ? "—" : cells[2] + " " + row.variable.unit
                tableRow([label, value, cells[1], objective, cells[3].isEmpty ? "—" : cells[3]], heading: false,
                         danger: row.id == "sodio_mg" && report.sodiumWarning != nil)
            }
        }
    }

    private func tableRow(_ values: [String], heading: Bool, danger: Bool = false) -> some View {
        NutriColumns(columns: 5, gap: 8, firstWeight: 1.4) {
            ForEach(values.indices, id: \.self) { index in
                Text(values[index]).font(heading || index == 0 ? .nutriSans(14) : .nutriMono(14))
                    .foregroundStyle(heading ? palette.text3 : index == 1 && danger ? palette.danger : index < 2 ? palette.text : palette.text2)
                    .frame(maxWidth: .infinity, alignment: index == 0 ? .leading : .trailing)
            }
        }.padding(.vertical, 4)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 2) {
            Rectangle().fill(palette.border).frame(height: 1).padding(.bottom, 6)
            Text(store.tr("— = sin dato o sin objetivo en el rango."))
            if report.micros.contains(where: { $0.coverage == .partial }) {
                Text(store.tr("⚠ Parcial: faltan valores de algunos alimentos; la suma observada no prueba cumplimiento."))
            }
            if let note = report.note { Text(note) }
            if mode == .bayes {
                let macros = ["Kcal", "Carbs", "Grasa"].map { store.tr($0) }.joined(separator: "/")
                let protein = store.tr("Proteína")
                let macroCriterion = bayesCriterion(data, key: "kcal", translate: store.tr)
                let proteinCriterion = bayesCriterion(data, key: "protein_g", translate: store.tr)
                Text(verbatim: "\(macros): \(macroCriterion) · \(protein)/micros: \(proteinCriterion)")
            }
            Text("nutrimetry · nutri.vryahn.com").font(.nutriMono(12)).padding(.top, 4)
        }.font(.nutriSans(12)).foregroundStyle(palette.text3)
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

    // Frozen oracle: src/lib/domain.js bayesAdherence(1, 1). The selector
    // has three eligible days but only one happened to have a kcal objective.
    let oneTarget = DashboardSnapshot(period: window, entries: [], totals: known, prior: [], weights: [], history: [],
                                      targets: Array(targets.prefix(1)), phases: [])
    let kcal = DashboardVariable.nutrition[0]
    let sparse = dashboardSummary(kcal, mode: .bayes, data: oneTarget, bands: [:])
    guard oneTarget.enabled(.bayes), sparse.bayesCount == 1, let mean = sparse.value,
          abs(mean - 200 / 3) < 1e-10, sparse.detail == "IC95: 16–99%" else {
        throw FeatureError("Module check failed · web Bayesian eligibility and sparse targets")
    }

    let averageKcal = dashboardSummary(kcal, mode: .average, data: data, bands: [:])
    let summary = String(decoding: summaryDashboardCSV([averageKcal, average], mode: .average, translate: { $0 }), as: UTF8.self)
    let expectedSummary = [
        "nutriente,clave,unidad,Promedio diario (÷ días registrados),detalle,objetivo,%_objetivo,cobertura",
        "Kcal,kcal,kcal,2000,,2000,100%,Completa",
        "Sodio,sodio_mg,mg,600,,,,Parcial"
    ].joined(separator: "\n")
    guard summary == "\u{FEFF}" + expectedSummary else {
        throw FeatureError("Module check failed · web summary CSV header, units, rounding and coverage")
    }

    let last = dates[2]
    let observed: Record = ["day": .string(last), "kcal": .number(2123.45), "micros": .object(["sodio_mg": .number(739.12)])]
    let target: Record = ["day": .string(last), "kcal": .number(2200), "micros": .object(["sodio_mg": .number(2300)])]
    let entry: Record = ["day": .string(last), "item": .string("Arroz, \"cocido\""), "food_id": .string("fixture"),
                         "grams": .number(150), "kcal": .number(180), "micros": .object(["sodio_mg": .number(42.7)])]
    let plan = DashboardAskPlan(["nutrients": .array([.string("kcal"), .string("sodio_mg")])], today: today)
    let context = askContext(plan: plan, days: [observed], targets: [target], entries: [entry])
    let expectedContext = #"""
    # Totales diarios (unidades: kcal, g o mg segun la clave)
    day,kcal,sodio_mg
    \#(last),2123.5,739.1
    # Objetivo del día (mismas columnas; vacío si no hay)
    day,kcal,sodio_mg
    \#(last),2200,2300
    # Alimentos
    day,item,grams,kcal,sodio_mg
    \#(last),"Arroz, ""cocido""",150,180,42.7
    """#
    guard context == expectedContext else {
        throw FeatureError("Module check failed · web AskLog context and observed partial coverage")
    }
    let cap = askContext(plan: plan, days: [], targets: [], entries: Array(repeating: entry, count: 401))
    guard cap.hasSuffix("(recortado a 400 alimentos de 401)"), cap.components(separatedBy: "Arroz").count == 401 else {
        throw FeatureError("Module check failed · web AskLog 400-food cap")
    }
    let raw = try rawDashboardCSV([entry], unlabelled: "Sin etiqueta")
    let rawText = String(decoding: raw, as: UTF8.self)
    let expectedHeader = "day,meal_label,tipo,item,grams,kcal,protein_g,carbs_g,fat_g," + Domain.micros.map(\.key).joined(separator: ",") + ",micros_complete"
    let parsed = try CSV.parse(rawText)
    guard rawText.hasPrefix("\u{FEFF}" + expectedHeader + "\n"), !rawText.contains("\r"), parsed.count == 1,
          parsed[0]["meal_label"] == "Sin etiqueta", parsed[0]["tipo"] == "food", parsed[0]["micros_complete"] == "{}",
          parsed[0]["sodio_mg"] == "42.7", parsed[0]["item"] == entry.text("item") else {
        throw FeatureError("Module check failed · web raw CSV header, quoted fields and zero coverage object")
    }
    try checkTargetParity()

}
#endif

private func periodBounds(_ days: [DashboardDay], key: String) -> Record {
    let targets = days.compactMap(\.target)
    let explicit = targets.map { $0.object("bounds").object(key) }
    guard !explicit.isEmpty, explicit.allSatisfy({ $0.number("min") != nil || $0.number("max") != nil }) else { return [:] }
    var result: Record = [:]
    for side in ["min", "max"] {
        let all = explicit.compactMap { $0.number(side) }
        if all.count == explicit.count { result[side] = mean(all).map(JSONValue.number) }
    }
    return result
}

private extension View {
    func dashboardAxes(palette: NutriPalette, x: [String], label: @escaping (String) -> String, y: Bool = true) -> some View {
        let stride = max(1, (x.count + 7) / 8)
        return self
            .chartXAxis {
                AxisMarks(values: x.enumerated().compactMap { $0.offset % stride == 0 ? $0.element : nil }) { item in
                    AxisValueLabel {
                        if let key = item.as(String.self) { Text(label(key)).font(.nutriSans(10)).foregroundStyle(palette.text3) }
                    }
                }
            }
            .chartYAxis {
                if y {
                    AxisMarks(position: .leading) { value in
                        AxisGridLine().foregroundStyle(palette.border)
                        AxisValueLabel {
                            if let number = value.as(Double.self) { Text(draftNumber(number)).font(.nutriSans(10)).foregroundStyle(palette.text3) }
                        }
                    }
                }
            }
    }
}

private struct DashboardEnergyPlot: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let days: [DashboardDay]
    let height: CGFloat
    var printStyle = false
    @State private var selection: String?

    private var series: [EnergyPoint] {
        var run = 0
        var targetRun = 0
        return days.enumerated().map { index, day in
            let actual = day.registered ? day.total.number("kcal") : nil
            if actual == nil { run += 1 }
            if day.target?.number("kcal") == nil { targetRun += 1 }
            let recent = days[max(0, index - 6)...index].compactMap { $0.registered ? $0.total.number("kcal") : nil }
            return EnergyPoint(day: day.id, kcal: actual, target: day.target?.number("kcal"), average: mean(recent), run: run, targetRun: targetRun)
        }
    }

    private struct EnergyPoint: Identifiable {
        var id: String { day }
        let day: String
        let kcal: Double?
        let target: Double?
        let average: Double?
        let run: Int
        let targetRun: Int
    }

    var body: some View {
        let values = series
        let targets = values.compactMap(\.target)
        let targetAverage = mean(targets)
        let showTarget = targets.reduce(0, +) > 0
        let labels = values.map(\.id)
        VStack(spacing: 6) {
            Chart {
                if let targetAverage {
                    RectangleMark(yStart: .value("Mín.", targetAverage * 0.9), yEnd: .value("Máx.", targetAverage * 1.1))
                        .foregroundStyle(palette.accent.opacity(0.08))
                }
                ForEach(values) { row in
                    if let actual = row.kcal {
                        AreaMark(x: .value("Fecha", row.day), yStart: .value("Kcal", 0), yEnd: .value("Kcal", actual),
                                 series: .value("Tramo", row.run))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [palette.kcal.opacity(printStyle ? 0.15 : 0.4),
                                                                        palette.kcal.opacity(printStyle ? 0.15 : 0.02)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Fecha", row.day), y: .value("Kcal", actual), series: .value("Serie", "kcal:\(row.run)"))
                            .interpolationMethod(.monotone).foregroundStyle(palette.kcal).lineStyle(StrokeStyle(lineWidth: 2))
                    }
                    if showTarget, let target = row.target {
                        LineMark(x: .value("Fecha", row.day), y: .value("Kcal", target), series: .value("Serie", "target:\(row.targetRun)"))
                            .foregroundStyle(palette.accent).lineStyle(StrokeStyle(lineWidth: 2))
                    }
                    if let average = row.average {
                        LineMark(x: .value("Fecha", row.day), y: .value("Kcal", average), series: .value("Serie", "ma7"))
                            .foregroundStyle(palette.carbs).lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 3]))
                    }
                }
                if let selection, !printStyle {
                    RuleMark(x: .value("Fecha", selection)).foregroundStyle(palette.border)
                }
            }
            .chartXScale(domain: labels)
            .dashboardAxes(palette: palette, x: labels, label: { String($0.dropFirst(5)) })
            .dashboardHover($selection, disabled: printStyle) { key in
                if let point = values.first(where: { $0.day == key }) {
                    chartTooltip(String(key.dropFirst(5)), values: [("Kcal", point.kcal), ("Objetivo", point.target), ("Promedio 7 días", point.average)],
                                 palette: palette, translate: store.tr)
                }
            }
            dashboardLegend([("Kcal", palette.kcal, false)] + (showTarget ? [("Objetivo", palette.accent, false)] : []) +
                        [("Promedio 7 días", palette.carbs, true)], translate: store.tr, theme: palette)
        }.frame(height: height)
    }
}

private struct DashboardMacroDistribution: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let days: [DashboardDay]
    let height: CGFloat
    @State private var selection: String?

    private let keys = ["protein_g", "carbs_g", "fat_g"]
    private let names = ["Prot", "Carbs", "Grasa"]
    private let factors = [4.0, 4.0, 9.0]

    var body: some View {
        let values = days.map { day in keys.enumerated().map { (day.total.number($0.element) ?? 0) * factors[$0.offset] } }
        let totals = keys.indices.map { index in values.reduce(0) { $0 + $1[index] } }
        let total = totals.reduce(0, +)
        let colors = [palette.protein, palette.carbs, palette.fat]
        if total <= 0 {
            Text(store.tr("Sin registros en el rango")).foregroundStyle(palette.text2).frame(maxWidth: .infinity).padding(.vertical, 32)
        } else if days.filter(\.registered).count >= 3 {
            let labels = days.map(\.id)
            Chart {
                ForEach(days.indices, id: \.self) { index in
                    let data = values[index]
                    let origin = -data.reduce(0, +) / 2
                    ForEach(keys.indices, id: \.self) { j in
                        let low = origin + data.prefix(j).reduce(0, +)
                        let high = low + data[j]
                        AreaMark(x: .value("Fecha", labels[index]), yStart: .value("kcal", low), yEnd: .value("kcal", high), series: .value("Macro", keys[j]))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [colors[j].opacity(0.5), colors[j].opacity(0.1)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Fecha", labels[index]), y: .value("kcal", high), series: .value("Macro", keys[j]))
                            .interpolationMethod(.monotone).foregroundStyle(colors[j]).lineStyle(StrokeStyle(lineWidth: 1))
                    }
                }
            }.chartXScale(domain: labels)
                .dashboardAxes(palette: palette, x: labels, label: { String($0.dropFirst(5)) }, y: false)
                .dashboardHover($selection) { key in
                    if let index = labels.firstIndex(of: key) {
                        chartTooltip(String(key.dropFirst(5)), values: zip(["Proteína", "Carbs", "Grasa"], values[index]).map { ($0, $1) },
                                     palette: palette, translate: store.tr)
                    }
                }
                .frame(height: height)
        } else {
            VStack(spacing: 8) {
                GeometryReader { proxy in
                    HStack(spacing: 0) {
                        ForEach(keys.indices, id: \.self) { index in
                            colors[index].frame(width: proxy.size.width * totals[index] / total)
                        }
                    }.clipShape(Capsule())
                }.frame(height: 16)
                HStack {
                    ForEach(keys.indices, id: \.self) { index in
                        if index > 0 { Spacer() }
                        Text(store.tr(names[index]) + " " + draftNumber(webRound(100 * totals[index] / total, digits: 0)) + "%")
                            .font(.nutriSans(12)).foregroundStyle(colors[index])
                    }
                }
            }.padding(.vertical, 16)
        }
    }
}

private struct DashboardProteinPlot: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let days: [DashboardDay]
    let bands: Record
    let height: CGFloat
    @State private var selection: String?

    var body: some View {
        let groups = Dictionary(grouping: days) { day in
            Day.key(addingDays(-((Calendar.current.component(.weekday, from: day.date) + 5) % 7), to: day.date))
        }
        let ordered = groups.keys.sorted()
        let points: [(key: String, label: String, protein: Double?, floor: Double?, bound: Record)] = ordered.enumerated().map { index, key in
            let week = groups[key] ?? []
            return (key, (store.lang == "en" ? "W" : "S") + String(index + 1),
                    mean(week.filter(\.registered).map { $0.total.number("protein_g") ?? 0 }),
                    mean(week.compactMap { $0.target?.number("protein_g") }), periodBounds(week, key: "protein_g"))
        }
        let labels = points.map(\.key)
        Chart {
            ForEach(points.indices, id: \.self) { index in
                let row = points[index]
                if let actual = row.protein {
                    let target = ["protein_g": row.floor.map(JSONValue.number) ?? .null,
                                  "bounds": .object(["protein_g": .object(row.bound)])]
                    let color = switch Domain.classify("protein_g", value: actual, target: target, bands: bands) {
                    case .ok: palette.ok
                    case .warn: palette.warn
                    case .danger: palette.danger
                    case nil: palette.protein
                    }
                    BarMark(x: .value("Semana", row.key), y: .value("Proteína", actual))
                        .foregroundStyle(color).cornerRadius(4)
                }
                if let floor = row.floor {
                    LineMark(x: .value("Semana", row.key), y: .value("Piso", floor)).foregroundStyle(palette.accent)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                }
            }
        }.chartXScale(domain: labels)
            .dashboardAxes(palette: palette, x: labels, label: { key in points.first { $0.key == key }?.label ?? "" })
            .dashboardHover($selection) { key in
                if let row = points.first(where: { $0.key == key }) {
                    chartTooltip(row.label, values: [("Proteína", row.protein), ("Piso", row.floor)], palette: palette, translate: store.tr)
                }
            }
            .frame(height: height)
    }
}

private struct DashboardSodiumPlot: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let days: [DashboardDay]
    let ceiling: Double
    let height: CGFloat
    @State private var selection: String?

    var body: some View {
        var run = 0
        let points = days.compactMap { day -> (key: String, actual: Double, run: Int)? in
            guard day.registered, day.coverage("sodio_mg") == .complete, let amount = nutritionValue(day.total, "sodio_mg") else {
                run += 1
                return nil
            }
            return (day.id, amount, run)
        }
        let labels = days.map(\.id)
        let low = min(points.map(\.actual).min() ?? 0, Domain.sodiumFloor)
        let high = max(points.map(\.actual).max() ?? 0, Domain.sodiumFloor)
        let offset = high > low ? (high - Domain.sodiumFloor) / (high - low) : 0.5
        let gradient = LinearGradient(stops: [
            .init(color: palette.carbs.opacity(0.45), location: 0),
            .init(color: palette.carbs.opacity(0.45), location: offset),
            .init(color: palette.danger.opacity(0.45), location: offset),
            .init(color: palette.danger.opacity(0.45), location: 1)
        ], startPoint: .top, endPoint: .bottom)
        return Chart {
            RuleMark(y: .value("Piso", Domain.sodiumFloor)).foregroundStyle(palette.danger).lineStyle(StrokeStyle(dash: [4, 3]))
            RuleMark(y: .value("Techo", ceiling)).foregroundStyle(palette.danger).lineStyle(StrokeStyle(dash: [4, 3]))
            ForEach(points.indices, id: \.self) { index in
                let point = points[index]
                AreaMark(x: .value("Fecha", point.key), yStart: .value("Sodio", 0), yEnd: .value("Sodio", point.actual),
                         series: .value("Tramo", point.run))
                    .interpolationMethod(.monotone).foregroundStyle(gradient)
                LineMark(x: .value("Fecha", point.key), y: .value("Sodio", point.actual), series: .value("Tramo", point.run))
                    .interpolationMethod(.monotone).foregroundStyle(palette.carbs).lineStyle(StrokeStyle(lineWidth: 2))
                PointMark(x: .value("Fecha", point.key), y: .value("Sodio", point.actual))
                    .foregroundStyle(point.actual < Domain.sodiumFloor || point.actual > ceiling ? palette.danger : palette.carbs)
                    .symbolSize(24)
            }
        }.chartXScale(domain: labels)
            .dashboardAxes(palette: palette, x: labels, label: { String($0.dropFirst(5)) })
            .dashboardHover($selection) { key in
                if let row = points.first(where: { $0.key == key }) {
                    chartTooltip(String(key.dropFirst(5)), values: [("Sodio", row.actual)], palette: palette, translate: store.tr)
                }
            }
            .frame(height: height)
    }
}

private extension View {
    func dashboardHover<Tooltip: View>(_ key: Binding<String?>, disabled: Bool = false, @ViewBuilder tooltip: @escaping (String) -> Tooltip) -> some View {
        chartOverlay { proxy in
            GeometryReader { geometry in
                let plot = proxy.plotFrame.map { geometry[$0] } ?? .zero
                Rectangle().fill(Color.clear).contentShape(Rectangle())
                    .nutriChartPoint { point in
                        guard !disabled else { return }
                        let value = point.flatMap { plot.contains($0) ? proxy.value(atX: $0.x - plot.minX, as: String.self) : nil }
                        #if os(iOS)
                        key.wrappedValue = key.wrappedValue == value ? nil : value
                        #else
                        key.wrappedValue = value
                        #endif
                    }
                    .overlay(alignment: .topLeading) {
                        if let current = key.wrappedValue, let x = proxy.position(forX: current) {
                            tooltip(current)
                                .padding(.top, 10)
                                .padding(.leading, max(4, min(plot.minX + x + 8, geometry.size.width - 180)))
                                .allowsHitTesting(false)
                        }
                    }
            }
        }
    }
}

private func chartTooltip(_ label: String, values: [(String, Double?)], palette: NutriPalette, translate: @escaping (String) -> String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
        Text(label)
        ForEach(values.indices, id: \.self) { index in
            if let value = values[index].1 {
                Text(translate(values[index].0) + " · " + draftNumber(webRound(value, digits: 1)))
            }
        }
    }.font(.nutriSans(12)).padding(8).nutriCard(radius: 8, fill: palette.surface3)
}

private func dashboardLegend(_ labels: [(String, Color, Bool)], translate: @escaping (String) -> String, theme: NutriPalette) -> some View {
    NutriFlow(spacing: 10, lineSpacing: 6) {
        ForEach(labels.indices, id: \.self) { index in
            let entry = labels[index]
            HStack(spacing: 4) {
                Path { line in line.move(to: .zero); line.addLine(to: CGPoint(x: 14, y: 0)) }
                    .stroke(entry.1, style: StrokeStyle(lineWidth: 2, dash: entry.2 ? [4, 3] : []))
                    .frame(width: 14, height: 1)
                Text(translate(entry.0)).font(.nutriSans(11)).foregroundStyle(theme.text3)
            }
        }
    }
}

private struct DashboardHeatmap: View {
    @Environment(\.nutriPalette) private var palette
    @EnvironmentObject private var store: Store
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
        let weekdays = store.lang == "en" ? ["M", "T", "W", "T", "F", "S", "S"] : ["L", "M", "M", "J", "V", "S", "D"]
        HStack(alignment: .top, spacing: spacing) {
            VStack(alignment: .leading, spacing: spacing) {
                ForEach(weekdays.indices, id: \.self) { offset in
                    Text(weekdays[offset]).font(.nutriSans(10)).foregroundStyle(palette.text3).frame(height: square)
                }
            }.padding(.trailing, 4).accessibilityHidden(true)
            ForEach(weeks.keys.sorted(), id: \.self) { week in
                let byDay = Dictionary(uniqueKeysWithValues: (weeks[week] ?? []).map { ($0.id, $0) })
                VStack(spacing: spacing) {
                    ForEach(0..<7) { offset in
                        let key = Day.key(addingDays(offset, to: week))
                        if let day = byDay[key] {
                            let amount = day.total.number("kcal") ?? 0
                            let status = day.registered ? Domain.classify("kcal", value: amount, target: day.target, bands: bands) : nil
                            let fill = color(status, fallback: day.registered ? palette.surface3 : palette.surface2)
                            let partial = day.completeness == .partial
                            let suffix = partial ? " (" + translate("día incompleto: parece que faltaron comidas") + ")" : ""
                            let hint = day.id + ": " + draftNumber(webRound(amount, digits: 0)) + " kcal" + suffix
                            RoundedRectangle(cornerRadius: min(4, square / 3))
                                .fill(fill).opacity(partial ? 0.5 : 1)
                                .frame(width: square, height: square)
                                .nutriHint(hint).accessibilityLabel(hint)
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
        case .ok: palette.ok
        case .warn: palette.warn
        case .danger: palette.danger
        case nil: fallback
        }
    }
}
