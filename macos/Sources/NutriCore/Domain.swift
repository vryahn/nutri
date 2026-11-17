import Foundation

public enum Day {
    private static var calendar: Calendar { Calendar(identifier: .gregorian) }

    public static func key(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    public static func date(_ key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let result = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)),
              Self.key(result) == key else { return nil }
        return result
    }

    public static func add(_ date: Date, _ days: Int) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    public static func weekday(_ key: String) -> Int? {
        date(key).map { calendar.component(.weekday, from: $0) - 1 }
    }
}

public struct Nutrient: Decodable, Identifiable, Sendable {
    public let key: String
    public let label: String
    public let unit: String
    public let category: String
    public var id: String { key }

    enum CodingKeys: String, CodingKey { case key, label, unit, category = "cat" }
}

public enum Domain {
    private struct Contracts: Decodable {
        let micros: [Nutrient]
        let microMax: [String: Double]
        let bands: Record
        let constants: Record
        let strings: [String: String]
        let prompts: [String: String]
    }

    private static let contracts: Contracts = {
        let packaged = Bundle.main.resourceURL.flatMap {
            Bundle(url: $0.appendingPathComponent("Nutri_NutriCore.bundle"))
        }
        guard let url = (packaged ?? .module).url(forResource: "Contracts", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(Contracts.self, from: data) else {
            preconditionFailure("Missing native nutrition contracts.")
        }
        return value
    }()

    public static let micros = contracts.micros
    public static let microMax = contracts.microMax
    public static let defaultBands = contracts.bands
    public static let prompts = contracts.prompts
    public static let macroKeys = ["kcal", "protein_g", "carbs_g", "fat_g"]
    public static let macroLabels = ["kcal": "Energía", "protein_g": "Proteína", "carbs_g": "Carbohidratos", "fat_g": "Grasa"]
    public static let categories = ["Lípidos", "Carbohidratos", "Edulcorantes", "Vitaminas", "Minerales", "Antioxidantes", "Aminoácidos", "Otros"]
    public static let gramsPerOunce = 28.3495
    public static let mlPerFluidOunce = 29.5735
    // Constantes de dominio exportadas desde src/lib/domain.js (scripts/sync-domain.mjs).
    private static func constant(_ key: String) -> Double {
        guard let value = contracts.constants.number(key) else { preconditionFailure("Missing contract constant \(key).") }
        return value
    }
    public static let sodiumFloor = constant("SODIUM_FLOOR_MG")
    public static let sodiumCeiling = constant("SODIUM_CEILING_MG")
    public static let sodiumHigh = constant("SODIUM_HIGH_MG")
    public static let potassiumHigh = constant("POTASSIUM_HIGH_MG")
    public static let adherenceTolerance = constant("ADHERENCE_TOL")
    public static let deficitRatePctPerWeek = deficitCap("pctWk")
    public static let deficitRateWeeks = Int(deficitCap("weeks"))
    public static let deficitRateDeltaCarbs = deficitCap("deltaCarbsG")
    private static func deficitCap(_ key: String) -> Double {
        guard let value = contracts.constants["DEFICIT_RATE_CAP"]?.object?.number(key) else { preconditionFailure("Missing DEFICIT_RATE_CAP.") }
        return value
    }
    public static let minDaysMedian = Int(constant("MIN_DAYS_MEDIAN"))
    public static let minDaysStdDev = Int(constant("MIN_DAYS_STDDEV"))
    public static let minDaysTrend = Int(constant("MIN_DAYS_TREND"))
    public static let minDaysBayes = Int(constant("MIN_DAYS_BAYES"))
    public static let structuralZeroFraction = constant("STRUCTURAL_ZERO_FRACTION")
    public static let bayesKcalTolerance = constant("BAYES_KCAL_TOL")
    public static let kcalHardFloor = constant("KCAL_HARD_FLOOR")
    public static let completeRatio = constant("COMPLETE_RATIO")
    public static let histMinDays = Int(constant("HIST_MIN_DAYS"))
    public static let minMealsSignal = Int(constant("MIN_MEALS_SIGNAL"))

    public enum Coverage: String, Sendable { case complete, partial, unknown }
    public enum Adherence: String, Sendable { case ok, warn, danger }

    public static func translate(_ spanish: String, language: String) -> String {
        language == "en" ? contracts.strings[spanish] ?? spanish : spanish
    }

    /// Decimal half-away-from-zero, matching SQL `round()` for previews of values the DB views compute.
    /// Display spots that mirror web `Math.round` (half up) use `floor(x * f + 0.5) / f` instead: webRound (Dashboard), journalNumber (Today).
    public static func round(_ value: Double, _ digits: Int) -> Double {
        quantize(decimal(value), digits)
    }

    private static func decimal(_ value: Double) -> Decimal {
        Decimal(string: String(value), locale: Locale(identifier: "en_US_POSIX")) ?? .nan
    }

    private static func quantizedDecimal(_ input: Decimal, _ digits: Int) -> Decimal {
        var value = input
        var result = Decimal()
        NSDecimalRound(&result, &value, digits, .plain)
        return result
    }

    private static func quantize(_ value: Decimal, _ digits: Int) -> Double {
        Double(NSDecimalNumber(decimal: quantizedDecimal(value, digits)).stringValue) ?? .nan
    }

    public static func value(_ row: Record, _ key: String) -> Double? {
        row.number(key) ?? row.object("micros").number(key)
    }

    public static func resolveTarget(_ targets: [Record], _ day: String) -> Record? {
        if let exact = targets.first(where: { $0.text("day") == day }) { return exact }
        guard let dow = Day.weekday(day) else { return nil }
        return targets.filter {
            $0.number("dow") == Double(dow) && !$0.text("valid_from").isEmpty && $0.text("valid_from") <= day
        }.max { $0.text("valid_from") < $1.text("valid_from") }
    }

    public static func activePhase(_ targets: [Record], day: String) -> [Record] {
        let phases = targets.filter {
            $0.number("dow") != nil && !$0.text("valid_from").isEmpty && $0.text("valid_from") <= day
        }
        guard let latest = phases.map({ $0.text("valid_from") }).max() else { return [] }
        return phases.filter { $0.text("valid_from") == latest }
    }

    public static func knownMicros(_ micros: Record) -> Record {
        micros.compactMapValues { value in
            if case let .number(number) = value, number.isFinite { return .bool(true) }
            return nil
        }
    }

    public static func coverage(_ row: Record, _ key: String) -> Coverage {
        if row.object("micros_complete")[key]?.bool == true { return .complete }
        return row.object("micros").number(key) == nil ? .unknown : .partial
    }

    public static func totals(_ entries: [Record]) -> Record {
        let micros = entries.reduce(into: [String: Double]()) { sums, row in
            for (key, value) in row.object("micros") {
                if let number = value.number { sums[key, default: 0] += number }
            }
        }
        var result = Record()
        for key in macroKeys {
            let known = entries.compactMap { $0.number(key) }
            if !known.isEmpty { result[key] = .number(round(known.reduce(0, +), 1)) }
        }
        let keys = entries.first.map { Set($0.object("micros_complete").keys) } ?? []
        let complete = keys.filter { key in entries.allSatisfy { coverage($0, key) == .complete } }
        result["micros"] = .object(micros.mapValues(JSONValue.number))
        result["micros_complete"] = .object(Dictionary(uniqueKeysWithValues: complete.map { ($0, .bool(true)) }))
        return result
    }

    public static func grams(_ amount: Double, unit: String, density: Double? = nil) -> Double? {
        guard amount.isFinite, amount > 0 else { return nil }
        switch unit {
        case "g": return amount
        case "oz": return amount * gramsPerOunce
        case "ml", "fl oz":
            guard let density, density.isFinite, density > 0 else { return nil }
            return amount * density * (unit == "fl oz" ? mlPerFluidOunce : 1)
        default: return nil
        }
    }

    public static func scaled(_ food: Record, grams: Double) -> Record {
        var result = Record()
        let factor = decimal(grams) / 100
        for key in macroKeys {
            result[key] = food.number(key).map { .number(quantize(decimal($0) * factor, key == "kcal" ? 1 : 2)) } ?? .null
        }
        let micros = food.object("micros")
        result["micros"] = .object(micros.compactMapValues { $0.number.map { .number(quantize(decimal($0) * factor, 3)) } })
        result["micros_complete"] = food["micros_complete"] ?? .object(knownMicros(micros))
        return result
    }

    public static func recipePer100g(_ ingredients: [(food: Record, grams: Double)], cookedWeight: Double?) -> Record? {
        let weight = cookedWeight.flatMap { $0 > 0 ? $0 : nil } ?? ingredients.map(\.grams).reduce(0, +)
        guard weight > 0, weight.isFinite else { return nil }
        var sums = [String: Decimal]()
        var micros = [String: Decimal]()
        var complete: Set<String>?
        for (food, grams) in ingredients {
            let factor = decimal(grams) / 100
            for key in macroKeys {
                if let value = food.number(key) { sums[key, default: 0] += decimal(value) * factor }
            }
            let rowMicros = food.object("micros")
            for (key, value) in rowMicros {
                if let number = value.number { micros[key, default: 0] += quantizedDecimal(decimal(number) * factor, 3) }
            }
            let known = Set(knownMicros(rowMicros).keys)
            complete = complete?.intersection(known) ?? known
        }
        let per100 = 100 / decimal(weight)
        var result = Record()
        for (key, value) in sums { result[key] = .number(quantize(value * per100, key == "kcal" ? 1 : 2)) }
        result["micros"] = .object(micros.mapValues { .number(quantize($0 * per100, 3)) })
        result["micros_complete"] = .object(Dictionary(uniqueKeysWithValues: (complete ?? []).map { ($0, .bool(true)) }))
        return result
    }

    public static func coupledBand(_ target: Record, energy: Double) -> Record? {
        let bounds = target.object("bounds")
        guard target.object("rules").object("transition").text("kind") == "coupled_band",
              let p = target.number("protein_g"), p > 0,
              let lo = bounds.object("kcal").number("min"), let hi = bounds.object("kcal").number("max"), hi > lo,
              let c1 = bounds.object("carbs_g").number("min"), let c2 = bounds.object("carbs_g").number("max"), c2 >= c1,
              let f1 = bounds.object("fat_g").number("min"), let f2 = bounds.object("fat_g").number("max"), f2 >= f1,
              energy >= lo, energy <= hi,
              abs(4 * p + 4 * c1 + 9 * f1 - lo) <= 0.01,
              abs(4 * p + 4 * c2 + 9 * f2 - hi) <= 0.01 else { return nil }
        let t = (energy - lo) / (hi - lo)
        return ["kcal": .number(energy), "protein_g": .number(p), "carbs_g": .number(c1 + t * (c2 - c1)), "fat_g": .number(f1 + t * (f2 - f1))]
    }

    public static func impliedBounds(_ key: String, target: Record?, bands: Record = [:]) -> (min: Double?, max: Double?) {
        if key == "sodio_mg" { return (sodiumFloor, sodiumCeiling) }
        guard let point = target.flatMap({ value($0, key) }), point > 0 else { return (nil, nil) }
        if key == "kcal" {
            let b = kcalBand(target, bands)
            return (round(point * (1 - b.okUnder), 2), round(point * (1 + b.okOver), 2))
        }
        if ["carbs_g", "fat_g"].contains(key) {
            let ok = tolerance(bands, kind: "rango", key: "ok", fallback: 0.15)
            return (round(point * (1 - ok), 2), round(point * (1 + ok), 2))
        }
        return ceilings.contains(key) ? (nil, point) : (point, nil)
    }

    public static func bounds(_ key: String, target: Record?, bands: Record = [:]) -> (min: Double?, max: Double?) {
        let raw = target?.object("bounds").object(key) ?? [:]
        let implied = impliedBounds(key, target: target, bands: bands)
        let lower = raw.number("min") ?? implied.min
        return (key == "sodio_mg" ? max(sodiumFloor, lower ?? sodiumFloor) : lower, raw.number("max") ?? implied.max)
    }

    private static let ceilings = ["grasa_sat_g", "grasa_trans_g", "azucar_anadido_g", "alcohol_g", "colesterol_mg"]

    private static func tolerance(_ bands: Record, kind: String, key: String, fallback: Double) -> Double {
        bands.object(kind).number(key) ?? fallback
    }

    private static func kcalBand(_ target: Record?, _ bands: Record) -> (okUnder: Double, okOver: Double, warnUnder: Double, warnOver: Double) {
        let goal = target?.text("goal") ?? ""
        let defaults = defaultBands.object("diana")
        let kind = defaults[goal] == nil ? "default" : goal
        let values = defaults.object(kind).merging(bands.object("diana").object(kind)) { _, override in override }
        return (values.number("okUnder") ?? 0.05, values.number("okOver") ?? 0.05, values.number("warnUnder") ?? 0.15, values.number("warnOver") ?? 0.15)
    }

    public static func classify(_ key: String, value observed: Double, target: Record?, hasFood: Bool = true, bands: Record = [:]) -> Adherence? {
        if key == "sodio_mg" && !hasFood { return nil }
        if key == "sodio_mg" && observed < sodiumFloor { return .danger }
        let raw = target?.object("bounds").object(key) ?? [:]
        let slack = tolerance(bands, kind: "techo", key: "warn", fallback: 0.10)
        if raw.number("min") != nil || raw.number("max") != nil {
            let limit = bounds(key, target: target, bands: bands)
            if let min = limit.min, observed < min { return observed < min * (1 - slack) ? .danger : .warn }
            if let max = limit.max, observed > max { return observed > max * (1 + slack) ? .danger : .warn }
            return .ok
        }
        if key == "sodio_mg" { return observed > sodiumCeiling ? .danger : .ok }
        guard let point = target.flatMap({ value($0, key) }), point > 0 else { return nil }
        let diff = (observed - point) / point
        switch key {
        case "kcal":
            let b = kcalBand(target, bands)
            if diff >= -b.okUnder && diff <= b.okOver { return .ok }
            return diff >= -b.warnUnder && diff <= b.warnOver ? .warn : .danger
        case "protein_g": return diff >= 0 ? .ok : .danger
        case "carbs_g", "fat_g":
            if abs(diff) <= tolerance(bands, kind: "rango", key: "ok", fallback: 0.15) { return .ok }
            return abs(diff) <= tolerance(bands, kind: "rango", key: "warn", fallback: 0.30) ? .warn : .danger
        default:
            if ceilings.contains(key) { return diff <= 0 ? .ok : diff <= slack ? .warn : .danger }
            return diff >= 0 ? .ok : .warn
        }
    }

    public static func water(_ food: Record) -> Bool {
        let micros = food.object("micros")
        guard food.number("kcal") == 0, let water = micros.number("agua_ml") else { return false }
        let grams = food.number("grams") ?? 100
        // Legacy water foods have explicit zero/null minerals. Preserve them as
        // water, but do not hide other zero-calorie foods or mineral drinks.
        return grams > 0 && abs(water - grams) < 0.01
            && ["protein_g", "carbs_g", "fat_g"].allSatisfy { key in
                food[key] == nil || food[key] == .null || food.number(key) == 0
            }
            && micros.allSatisfy { key, value in key == "agua_ml" || value == .null || value.number == 0 }
    }

    public static func waterEntry(_ entry: Record, waterID: String) -> Bool {
        let foodID = entry.text("food_id")
        return !foodID.isEmpty && entry.text("recipe_id").isEmpty && (foodID == waterID || water(entry))
    }

    public static func kcalFromMacros(_ food: Record) -> Double {
        let micros = food.object("micros")
        let polyols = micros.number("polioles_g").flatMap { $0 != 0 ? $0 : nil }
            ?? polyolKeys.compactMap { micros.number($0) }.reduce(0, +)
        let macros = (food.number("protein_g") ?? 0) * 4 + (food.number("carbs_g") ?? 0) * 4 + (food.number("fat_g") ?? 0) * 9
        return floor(macros + (micros.number("alcohol_g") ?? 0) * 7 - (micros.number("fibra_g") ?? 0) * 2 - polyols * 1.6 + 0.5)
    }

    private static let polyolKeys = ["eritritol_g", "xilitol_g", "sorbitol_g", "maltitol_g", "manitol_g", "isomalt_g", "lactitol_g"]

    public static func kcalSuspicious(_ food: Record) -> Bool {
        let expected = kcalFromMacros(food)
        return abs((food.number("kcal") ?? 0) - expected) > max(20, expected * 0.25)
    }

    public static func macrosImplausible(_ food: Record) -> Bool {
        let m = food.object("micros")
        let macros = Array(macroKeys.dropFirst()).map { food.number($0) ?? 0 }
        return macros.reduce(0, +) + (m.number("alcohol_g") ?? 0) + (m.number("agua_ml") ?? 0) > 105
            || macros.contains { $0 > 100 }
            || microMax.contains { key, maximum in (m.number(key) ?? 0) > maximum }
    }

    public static func foodWarnings(_ food: Record) -> [String] {
        let m = food.object("micros")
        var warnings: [String] = []
        if kcalSuspicious(food) {
            warnings.append("Las kcal no coinciden con los macros.")
        }
        let macros = Array(macroKeys.dropFirst())
        let composition = macros.compactMap { food.number($0) } + ["alcohol_g", "agua_ml"].compactMap { m.number($0) }
        if composition.reduce(0, +) > 105 || macros.contains(where: { (food.number($0) ?? 0) > 100 }) {
            warnings.append("La composición supera el peso del alimento.")
        }
        for nutrient in micros {
            if let maximum = microMax[nutrient.key], let measured = m.number(nutrient.key), measured > maximum {
                warnings.append("Revisa la unidad de \(nutrient.label).")
            }
        }
        if let component = componentsInconsistent(food) { warnings.append(component) }
        return warnings
    }

    public static func componentsInconsistent(_ food: Record) -> String? {
        let m = food.object("micros")
        let components: [([String], String, String)] = [
            (["grasa_sat_g", "grasa_trans_g"], "fat_g", "grasa saturada + trans supera la grasa total"),
            (["azucar_g"], "carbs_g", "azúcar supera los carbohidratos"),
            (["azucar_anadido_g"], "azucar_g", "azúcar añadido supera el azúcar total"),
            (["fibra_g"], "carbs_g", "fibra supera los carbohidratos"),
            (["polioles_g"], "carbs_g", "polialcoholes superan los carbohidratos"),
            (polyolKeys, "polioles_g", "los polialcoholes desglosados superan su total"),
            (["glucosa_g", "fructosa_g", "galactosa_g", "lactosa_g", "maltosa_g", "sacarosa_g"], "azucar_g", "los azúcares desglosados superan el azúcar total"),
            (["fibra_soluble_g", "fibra_insoluble_g"], "fibra_g", "fibra soluble + insoluble supera la fibra total"),
            (["grasa_sat_g", "grasa_trans_g", "grasa_mono_g", "grasa_poli_g"], "fat_g", "los tipos de grasa superan la grasa total"),
            (["ala_g", "epa_g", "dha_g"], "omega3_g", "ALA + EPA + DHA superan el omega-3 total"),
            (["la_g", "aa_g"], "omega6_g", "LA + AA superan el omega-6 total")
        ]
        for (parts, total, message) in components {
            let observed = parts.compactMap { m.number($0) }
            if !observed.isEmpty, let limit = value(food, total), observed.reduce(0, +) > limit + 0.5 {
                return message
            }
        }
        return nil
    }
}
