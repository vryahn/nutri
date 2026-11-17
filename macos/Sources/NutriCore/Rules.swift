import Foundation

// Evaluador de reglas de fase. Réplica nativa de evalRules (src/lib/domain.js); NutriChecks lo
// contrasta con la web mediante los casos `evalRules` de web-domain.json.

public let ruleKindIDs = ["ritmo_alto", "estancamiento", "techo_peso", "ritmo_lento"]

public func draftNumber(_ value: Double?) -> String {
    guard let value else { return "" }
    return value.formatted(.number.grouping(.never).precision(.fractionLength(0...9)).locale(Locale(identifier: "en_US_POSIX")))
}

public func addingDays(_ count: Int, to date: Date) -> Date {
    Calendar.current.date(byAdding: .day, value: count, to: date) ?? date
}

public func isoDate(_ key: String) -> Date? {
    guard key.count == 10, let date = Day.date(key), Day.key(date) == key else { return nil }
    return date
}

public func normalizedRules(_ raw: Record) -> Record {
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
        guard ruleKindIDs.contains(kind) else { return nil }
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

public struct PhaseProposal {
    public let reason: String
    public let rows: [Record]

    public init(reason: String, rows: [Record]) {
        self.reason = reason
        self.rows = rows
    }
}

public func phaseProposal(targets: [Record], phase: [Record], body: [Record], totals: [Record], today: Date) -> PhaseProposal? {
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
            abs(actual.reduce(0, +) - sum) / sum <= Domain.adherenceTolerance
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
        let weeks = transition && todayKey <= Day.key(addingDays(13, to: from)) ? 1 : Domain.deficitRateWeeks
        let window = weeks * 7
        if first.text("valid_from") <= dateKey(transition ? window - 1 : window),
           !cooldown("proteccion-ritmo", window: window), adhered(window),
           let past = averageWeight(window) {
            let percent = (current - past) / Double(weeks) / current * 100
            if percent <= -Domain.deficitRatePctPerWeek {
                if transition {
                    return PhaseProposal(reason: "\(signed(percent, 2)) %/sem · Revisar el plan y elevar la ingesta; la banda necesita revisión.", rows: [])
                }
                let delta = Domain.deficitRateDeltaCarbs
                if let result = proposal("\(signed(percent, 2)) %/sem × \(Domain.deficitRateWeeks) sem · \(signed(delta, 0)) g carbs", id: "proteccion-ritmo", delta: delta) { return result }
            }
        }
    }

    for item in config.array("items").compactMap(\.object) {
        let kind = item.text("kind")
        guard ruleKindIDs.contains(kind) else { continue }
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
