#if DEBUG
import Foundation
import NutriCore

struct DemoData {
    let owner: String
    var isAnonymous = false
    var prefs: Record = ["lang": .string("es"), "units": .string("metric"), "profile": .object(["first_name": .string("Demo"), "height_cm": .number(175)])]
    private var tables: [String: [Record]] = [:]
    private var files: [String: Data] = [:]

    init(longJournal: Bool = false) {
        owner = "00000000-0000-4000-8000-000000000001"
        let oats = identifier(11)
        let yogurt = identifier(12)
        let raspberries = identifier(13)
        let water = identifier(14)
        let recipe = identifier(21)
        let breakfast = identifier(31)
        let dinner = identifier(32)
        let today = Day.key(Date())
        prefs["water_food_id"] = .string(water)
        prefs["water_glass_ml"] = .number(350)
        tables["foods"] = [
            food(oats, "Avena integral", kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9, micro: ["fibra_g": 10.6, "sodio_mg": 2, "potasio_mg": 429, "magnesio_mg": 177], shared: true),
            food(yogurt, "Yogur natural", kcal: 70, protein: 6, carbs: 7, fat: 2, micro: ["sodio_mg": 53, "calcio_mg": 122, "fibra_g": 0], shared: false),
            food(raspberries, "Frambuesas", kcal: 52, protein: 1.2, carbs: 11.9, fat: 0.7, micro: ["fibra_g": 6.5, "sodio_mg": 0, "potasio_mg": 151, "magnesio_mg": 22], shared: true),
            food(water, "Agua", kcal: 0, protein: 0, carbs: 0, fat: 0, micro: ["agua_ml": 100, "fibra_g": 0], shared: false)
        ]
        tables["recipes"] = [["id": .string(recipe), "owner": .string(owner), "name": .string("Avena con yogur"), "cooked_weight_g": .number(215), "source": .string("manual")]]
        tables["recipe_items"] = [
            ["recipe_id": .string(recipe), "food_id": .string(oats), "grams": .number(55)],
            ["recipe_id": .string(recipe), "food_id": .string(yogurt), "grams": .number(160)]
        ]
        tables["meal_labels"] = [["id": .string(breakfast), "owner": .string(owner), "name": .string("Desayuno"), "sort_order": .number(0)],
                                 ["id": .string(dinner), "owner": .string(owner), "name": .string("Cena"), "sort_order": .number(1)]]
        tables["entries"] = (0..<31).flatMap { age in
            let day = Day.key(Day.add(Date(), -age))
            return [
                entry(identifier(100 + age * 3), day, item: recipe, key: "recipe_id", grams: 215, label: breakfast),
                entry(identifier(101 + age * 3), day, item: raspberries, key: "food_id", grams: Double(140 - age % 10 * 3), label: dinner),
                entry(identifier(102 + age * 3), day, item: water, key: "food_id", grams: 350, label: nil)
            ]
        }
        if longJournal {
            tables["entries", default: []] += (600..<606).map { index in
                entry(identifier(index), today, item: raspberries, key: "food_id", grams: 50, label: dinner)
            }
        }
        tables["targets"] = (0...6).map { dow in
            ["id": .string(identifier(300 + dow)), "owner": .string(owner), "dow": .number(Double(dow)),
             "valid_from": .string(Day.key(Day.add(Date(), -40))), "label": .string("Fase de demostración"),
             "goal": .string("mantenimiento"), "kcal": .number(2050), "protein_g": .number(110),
             "carbs_g": .number(245), "fat_g": .number(70), "micros": .object(["fibra_g": .number(30), "agua_ml": .number(2100)])]
        }
        tables["body_metrics"] = (0...10).map { age in
            ["id": .string(identifier(401 + age)), "owner": .string(owner), "day": .string(Day.key(Day.add(Date(), -age * 3))),
             "metrics": .object(["peso_kg": .number(72 + Double(age % 4) / 10), "grasa_pct": .number(20.5 + Double(age % 3) / 10)]),
             "note": .string(age == 0 ? "Registro de demostración" : ""), "photo_paths": .array([])]
        }
        prefs["meal_templates"] = .array([.object(["id": .string(identifier(500)), "name": .string("Desayuno de avena"),
           "items": .array([.object(entry(identifier(501), today, item: recipe, key: "recipe_id", grams: 215, label: breakfast))])])])
    }

    private func food(_ id: String, _ name: String, kcal: Double, protein: Double, carbs: Double, fat: Double,
                      micro: [String: Double], shared: Bool) -> Record {
        ["id": .string(id), "owner": shared ? .null : .string(owner), "name": .string(name), "kcal": .number(kcal),
         "protein_g": .number(protein), "carbs_g": .number(carbs), "fat_g": .number(fat), "source": .string(shared ? "usda" : "manual"),
         "micros": .object(micro.mapValues(JSONValue.number)), "portions": .array([])]
    }

    private func identifier(_ value: Int) -> String {
        "00000000-0000-4000-8000-" + String(format: "%012d", value)
    }

    private func entry(_ id: String, _ day: String, item: String, key: String, grams: Double, label: String?) -> Record {
        ["id": .string(id), "owner": .string(owner), "day": .string(day), "grams": .number(grams), key: .string(item),
         "meal_label_id": label.map(JSONValue.string) ?? .null, "created_at": .string(day + "T09:00:00Z")]
    }

    init(fixture: URL) throws {
        let value = try JSONDecoder().decode(Record.self, from: Data(contentsOf: fixture))
        guard let uid = value["owner"]?.string, !uid.isEmpty else { throw NutriError("Snapshot fixture requires owner") }
        owner = uid
        isAnonymous = value["anonymous"]?.bool ?? false
        prefs = value.object("prefs")
        tables = value.object("tables").mapValues { $0.array?.compactMap(\.object) ?? [] }
    }

    func read(_ table: String, _ query: [String: String]) -> [Record] {
        let base: [Record]
        switch table {
        case "prefs": base = [["owner": .string(owner), "data": .object(prefs)]]
        case "recipe_per_100g":
            let foods = tables["foods"] ?? []
            base = (tables["recipes"] ?? []).compactMap { recipe in
                let id = recipe.text("id")
                let ingredients = (tables["recipe_items"] ?? []).filter { $0.text("recipe_id") == id }
                    .compactMap { item -> (food: Record, grams: Double)? in
                        guard let food = foods.first(where: { $0.text("id") == item.text("food_id") }),
                              let grams = item.number("grams") else { return nil }
                        return (food, grams)
                    }
                return Domain.recipePer100g(ingredients, cookedWeight: recipe.number("cooked_weight_g"))
                    .map { $0.merging(["recipe_id": .string(id)]) { _, new in new } }
            }
        case "entry_nutrients":
            let foods = tables["foods"] ?? []
            let recipes = tables["recipes"] ?? []
            let byRecipe = read("recipe_per_100g", [:])
            let labels = tables["meal_labels"] ?? []
            base = (tables["entries"] ?? []).map { row in
                let recipe = row.text("recipe_id")
                let food = foods.first { $0.text("id") == row.text("food_id") }
                let meta = food ?? byRecipe.first { $0.text("recipe_id") == recipe } ?? [:]
                let name = food?.text("name") ?? recipes.first { $0.text("id") == recipe }?.text("name") ?? ""
                let label = labels.first { $0.text("id") == row.text("meal_label_id") }?.text("name") ?? ""
                return row.merging(Domain.scaled(meta, grams: row.number("grams") ?? 0)) { _, new in new }
                    .merging(["item": .string(name), "brand": food?["brand"] ?? .null, "meal": .string(label)]) { _, new in new }
            }
        case "daily_totals":
            let days = Dictionary(grouping: read("entry_nutrients", [:])) { $0.text("day") }
            base = days.map { day, entries in
                Domain.totals(entries).merging(["day": .string(day), "owner": .string(owner)]) { _, new in new }
            }
        case "recipe_items":
            let foods = tables["foods"] ?? []
            base = (tables[table] ?? []).map { row in
                var row = row
                row["food"] = foods.first(where: { $0.text("id") == row.text("food_id") }).map(JSONValue.object)
                row["foods"] = row["food"]
                return row
            }
        default: base = tables[table] ?? []
        }
        var rows = base.filter { matches($0, query) }
        if let order = query["order"] {
            let rules = order.split(separator: ",").map { $0.split(separator: ".").map(String.init) }
            rows.sort { a, b in
                for rule in rules {
                    guard let key = rule.first else { continue }
                    let descending = rule.count > 1 && rule[1] == "desc"
                    if let x = a.number(key), let y = b.number(key), x != y { return descending ? x > y : x < y }
                    let comparison = a.text(key).compare(b.text(key), options: key == "name" ? [.caseInsensitive, .diacriticInsensitive] : [], locale: Locale(identifier: "en_US"))
                    if comparison != .orderedSame { return descending ? comparison == .orderedDescending : comparison == .orderedAscending }
                }
                return false
            }
        }
        rows = Array(rows.dropFirst(Int(query["offset"] ?? "") ?? 0))
        return Array(rows.prefix(Int(query["limit"] ?? "") ?? 1000))
    }

    private func matches(_ row: Record, _ query: [String: String]) -> Bool {
        for (key, value) in query {
            if key == "and" {
                let terms = value.dropFirst().dropLast().split(separator: ",")
                for term in terms {
                    let pair = term.split(separator: ".", maxSplits: 1)
                    if pair.count == 2, !matches(row, [String(pair[0]): String(pair[1])]) { return false }
                }
                continue
            }
            if ["select", "order", "limit", "offset", "on_conflict"].contains(key) { continue }
            let parts = value.split(separator: ".", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            let text = row[key]?.string ?? row.number(key).map { String(Int($0)) } ?? ""
            switch parts[0] {
            case "eq":
                if row[key]?.object != nil || row[key]?.array != nil {
                    guard (try? JSONDecoder().decode(JSONValue.self, from: Data(parts[1].utf8))) == row[key] else { return false }
                } else if text != parts[1] { return false }
            case "gte": if text < parts[1] { return false }
            case "lte": if text > parts[1] { return false }
            case "lt": if text >= parts[1] { return false }
            case "is": if row[key] != nil && row[key] != .null { return false }
            case "in":
                let values = parts[1].dropFirst().dropLast().split(separator: ",")
                if !values.contains(Substring(text)) { return false }
            default: continue
            }
        }
        return true
    }

    mutating func mutate(_ method: String, _ table: String, query: [String: String], body: JSONValue?) -> [Record] {
        var prior = tables[table] ?? []
        var result: [Record] = []
        if method == "POST" {
            let entries = body?.array?.compactMap(\.object) ?? body?.object.map { [$0] } ?? []
            let unique = query["on_conflict"]?.split(separator: ",").map(String.init) ?? []
            for var row in entries {
                if row["owner"] == nil { row["owner"] = .string(owner) }
                if !unique.isEmpty, let index = prior.firstIndex(where: { existing in unique.allSatisfy { existing[$0] == row[$0] } }) {
                    prior[index].merge(row) { _, new in new }
                    result.append(prior[index])
                } else {
                    if row["id"] == nil { row["id"] = .string(UUID().uuidString.lowercased()) }
                    if row["created_at"] == nil { row["created_at"] = .string(Date.now.ISO8601Format()) }
                    prior.append(row)
                    result.append(row)
                }
            }
        } else {
            for index in prior.indices where matches(prior[index], query) {
                if method == "PATCH" { prior[index].merge(body?.object ?? [:]) { _, new in new } }
                result.append(prior[index])
            }
            if method == "DELETE" {
                prior.removeAll { matches($0, query) }
                if table == "recipes" {
                    let ids = Set(result.map { $0.text("id") })
                    tables["recipe_items"]?.removeAll { ids.contains($0.text("recipe_id")) }
                }
            }
        }
        tables[table] = prior
        return result
    }

    mutating func rpc(_ name: String, _ body: Record) throws -> JSONValue {
        switch name {
        case "merge_prefs":
            prefs.merge(body.object("patch")) { _, new in new }
            return .object(prefs)
        case "match_foods": return .array([])
        case "save_recipe_atomic":
            let updateID = body.text("p_recipe_id")
            let id = updateID.isEmpty ? UUID().uuidString.lowercased() : updateID
            let row: Record = ["id": .string(id), "owner": .string(owner), "name": .string(body.text("p_name")),
                               "cooked_weight_g": body["p_cooked_weight_g"] ?? .null, "source": body["p_source"] ?? .null,
                               "portions": body["p_portions"] ?? .array([])]
            _ = mutate("POST", "recipes", query: ["on_conflict": "id"], body: .object(row))
            tables["recipe_items"]?.removeAll { $0.text("recipe_id") == id }
            for value in body.array("p_items") {
                guard var item = value.object else { continue }
                item["recipe_id"] = .string(id)
                tables["recipe_items", default: []].append(item)
            }
            return .string(id)
        case "replace_phase_atomic":
            let old = body.text("p_old_valid_from")
            tables["targets"]?.removeAll { $0.text("valid_from") == old && $0.number("dow") != nil }
            _ = mutate("POST", "targets", query: [:], body: .array(body.array("p_rows")))
            return .null
        default: throw NutriError("Operación sin datos de demostración.")
        }
    }

    mutating func storage(_ method: String, _ path: String, _ body: Data?) throws -> Data {
        let key = path.replacingOccurrences(of: "object/authenticated/", with: "").replacingOccurrences(of: "object/", with: "")
        switch method {
        case "POST":
            files[key] = body
            return Data("{}".utf8)
        case "GET":
            guard let file = files[key] else { throw NutriError("Archivo de demostración ausente.") }
            return file
        case "DELETE":
            let rows = try JSONDecoder().decode([String: [String]].self, from: body ?? Data())
            for prefix in rows["prefixes"] ?? [] { files.removeValue(forKey: key + "/" + prefix) }
            return Data("[]".utf8)
        default: throw NutriError("Operación de archivo inválida.")
        }
    }
}
#endif
