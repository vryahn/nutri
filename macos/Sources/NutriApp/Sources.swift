import Foundation
import NutriCore

func validEAN(_ text: String) -> Bool {
    let digits = text.utf8
    guard [8, 12, 13, 14].contains(digits.count), digits.allSatisfy({ (48...57).contains($0) }) else { return false }
    let sum = digits.reversed().enumerated().reduce(0) { result, pair in
        result + Int(pair.element - 48) * (pair.offset.isMultiple(of: 2) ? 1 : 3)
    }
    return sum.isMultiple(of: 10)
}

func fetchOFF(_ ean: String) async throws -> Record {
    guard validEAN(ean) else { throw NutriError("Código EAN/UPC inválido.") }
    var components = URLComponents()
    components.scheme = "https"
    components.host = "world.openfoodfacts.org"
    components.path = "/api/v2/product/\(ean).json"
    components.queryItems = [.init(name: "fields", value: "product_name,brands,nutriments,quantity,nutrition_data_per,additives_tags")]
    guard let url = components.url else { throw NutriError("Código EAN/UPC inválido.") }
    var request = URLRequest(url: url, timeoutInterval: 20)
    request.setValue("Nutrimetry/1.0 (https://nutri.vryahn.com)", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
        throw NutriError("Open Food Facts no encontró el producto o está temporalmente indisponible.")
    }
    let result = try JSONDecoder().decode(Record.self, from: data)
    guard result.number("status") != 0, let product = result["product"]?.object else {
        throw NutriError("Este código no figura en Open Food Facts.")
    }

    return mapOFFProduct(product)
}

func mapOFFProduct(_ product: Record) -> Record {
    let nutrients = product.object("nutriments")
    func value(_ key: String) -> Double? {
        let amount = nutrients[key]?.string.flatMap(decimal) ?? nutrients.number(key)
        return amount.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
    }
    func rounded(_ amount: Double, digits: Int, multiplier: Double = 1) -> JSONValue? {
        let scaled = amount * multiplier
        guard scaled.isFinite else { return nil }
        let result = Domain.round(scaled, digits)
        return result.isFinite ? .number(result) : nil
    }
    let basis = product.text("nutrition_data_per") == "100ml" ? "100ml" : "100g"
    let brand = product.text("brands").components(separatedBy: ",").first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    var record: Record = ["name": .string(product.text("product_name")), "brand": .string(brand), "per": .string(basis), "source": .string("off")]
    let energy = value("energy-kcal_100g") ?? value("energy_100g").map { $0 / 4.184 }
    if let energy { record["kcal"] = rounded(energy, digits: 1) }
    for (nutriKey, offKey) in [("protein_g", "proteins"), ("carbs_g", "carbohydrates"), ("fat_g", "fat")] {
        if let amount = value(offKey + "_100g") { record[nutriKey] = rounded(amount, digits: 2) }
    }
    let grams: [(String, String)] = [
        ("grasa_sat_g", "saturated-fat"), ("grasa_trans_g", "trans-fat"), ("azucar_g", "sugars"),
        ("fibra_g", "fiber"), ("polioles_g", "polyols"), ("almidon_g", "starch"),
        ("fructosa_g", "fructose"), ("glucosa_g", "glucose"), ("sacarosa_g", "sucrose"),
        ("maltosa_g", "maltose"), ("lactosa_g", "lactose"), ("grasa_mono_g", "monounsaturated-fat"),
        ("grasa_poli_g", "polyunsaturated-fat"), ("omega3_g", "omega-3-fat"), ("omega6_g", "omega-6-fat")
    ]
    var micros: Record = [:]
    for (key, source) in grams {
        if let amount = value(source + "_100g") { micros[key] = rounded(amount, digits: key.hasPrefix("omega") ? 3 : 2) }
    }
    for (key, source) in [("potasio_mg", "potassium"), ("magnesio_mg", "magnesium"), ("calcio_mg", "calcium"),
                          ("hierro_mg", "iron"), ("cafeina_mg", "caffeine")] {
        if let amount = value(source + "_100g") { micros[key] = rounded(amount, digits: key == "hierro_mg" ? 2 : 1, multiplier: 1000) }
    }
    let sodium = value("sodium_100g") ?? value("salt_100g").map { $0 / 2.5 }
    if let sodium { micros["sodio_mg"] = rounded(sodium, digits: 1, multiplier: 1000) }
    record["micros"] = .object(micros)
    let sweeteners = [
        "e420": "sorbitol", "e421": "manitol", "e953": "isomalt", "e965": "maltitol", "e966": "lactitol",
        "e967": "xilitol", "e968": "eritritol", "e964": "poliglicitol", "e950": "acesulfamo K", "e951": "aspartamo",
        "e952": "ciclamato", "e954": "sacarina", "e955": "sucralosa", "e956": "alitamo", "e957": "taumatina",
        "e959": "neohesperidina DC", "e960": "glucósidos de esteviol", "e961": "neotamo",
        "e962": "sal de aspartamo-acesulfamo", "e969": "advantamo"
    ]
    var seen = Set<String>()
    record["sweeteners"] = .array(product.array("additives_tags").compactMap { tag in
        guard let text = tag.string?.lowercased(), let range = text.range(of: "e[0-9]{3}", options: .regularExpression) else { return nil }
        let code = String(text[range])
        guard let name = sweeteners[code], seen.insert(code).inserted else { return nil }
        return .object(["code": .string(code.uppercased()), "name": .string(name)])
    })
    return record
}

private let fdcNutrients: [Int: String] = [
    1003: "protein_g", 1005: "carbs_g", 1004: "fat_g",
    1258: "grasa_sat_g", 1257: "grasa_trans_g", 2000: "azucar_g", 1235: "azucar_anadido_g", 1079: "fibra_g",
    1093: "sodio_mg", 1092: "potasio_mg", 1090: "magnesio_mg", 1087: "calcio_mg", 1089: "hierro_mg",
    1051: "agua_ml", 1018: "alcohol_g", 1253: "colesterol_mg",
    1106: "vit_a_mcg", 1162: "vit_c_mg", 1114: "vit_d_mcg", 1109: "vit_e_mg", 1185: "vit_k_mcg",
    1165: "vit_b1_mg", 1166: "vit_b2_mg", 1167: "vit_b3_mg", 1170: "vit_b5_mg", 1175: "vit_b6_mg",
    1176: "vit_b7_mcg", 1177: "vit_b9_mcg", 1178: "vit_b12_mcg", 1180: "colina_mg",
    1095: "zinc_mg", 1091: "fosforo_mg", 1103: "selenio_mcg", 1098: "cobre_mg", 1101: "manganeso_mg",
    1100: "yodo_mcg", 1096: "cromo_mcg", 1102: "molibdeno_mcg", 1099: "fluoruro_mcg",
    1107: "beta_caroteno_mcg", 1122: "licopeno_mcg", 1123: "luteina_zeaxantina_mcg",
    1007: "ceniza_g", 1009: "almidon_g", 1010: "sacarosa_g", 1011: "glucosa_g", 1012: "fructosa_g",
    1075: "galactosa_g", 1013: "lactosa_g", 1014: "maltosa_g", 1057: "cafeina_mg", 1058: "teobromina_mg",
    1105: "retinol_mcg", 1108: "alfa_caroteno_mcg", 1120: "beta_criptoxantina_mcg",
    1125: "tocoferol_beta_mg", 1126: "tocoferol_gamma_mg", 1127: "tocoferol_delta_mg",
    1283: "fitosteroles_mg", 1292: "grasa_mono_g", 1293: "grasa_poli_g",
    1404: "ala_g", 1278: "epa_g", 1272: "dha_g", 1269: "la_g", 1271: "aa_g",
    1210: "triptofano_g", 1211: "treonina_g", 1212: "isoleucina_g", 1213: "leucina_g", 1214: "lisina_g",
    1215: "metionina_g", 1216: "cistina_g", 1217: "fenilalanina_g", 1218: "tirosina_g", 1219: "valina_g",
    1220: "arginina_g", 1221: "histidina_g", 1222: "alanina_g", 1223: "acido_aspartico_g", 1224: "acido_glutamico_g",
    1225: "glicina_g", 1226: "prolina_g", 1227: "serina_g", 1228: "hidroxiprolina_g"
]

@MainActor
func searchFDC(store: Store, query: String) async throws -> [Record] {
    let result = try await store.ai(["kind": .string("usda"), "model": .string("search"), "payload": .object(["query": .string(query)])])
    var seen = Set<Int>()
    return Array((result.object?.array("foods").compactMap(\.object) ?? []).filter { row in
        guard let id = row.number("fdcId").flatMap(Int.init(exactly:)), id > 0 else { return false }
        let type = row.text("dataType")
        return (type.isEmpty || ["Foundation", "SR Legacy"].contains(type)) && seen.insert(id).inserted
    }.prefix(6))
}

@MainActor
func fetchFDC(store: Store, id: Int) async throws -> Record {
    guard id > 0 else { throw NutriError("Identificador USDA inválido.") }
    let result = try await store.ai(["kind": .string("usda"), "model": .string("food"), "payload": .object(["fdcId": .number(Double(id))])])
    guard let data = result.object else { throw NutriError("Respuesta USDA inválida.") }
    return mapFDCFood(data)
}

func mapFDCFood(_ data: Record) -> Record {
    var food: Record = ["source": .string("usda"), "brand": .string(""), "name": .string(data.text("description"))]
    var micros: Record = [:]
    let macroKeys = Set(Domain.macroKeys.dropFirst())
    let unitByKey = Dictionary(uniqueKeysWithValues: Domain.micros.map { ($0.key, $0.unit) })
    let energyPriority = [1008: 3, 2048: 2, 2047: 1]
    var priority = 0
    for value in data.array("foodNutrients") {
        guard let value = value.object, let amount = value.number("amount"), amount >= 0 else { continue }
        let nutrient = value.object("nutrient")
        guard let id = nutrient.number("id").flatMap(Int.init(exactly:)) else { continue }
        let unit = nutrient.text("unitName").lowercased()
        if let rank = energyPriority[id], rank > priority, unit == "kcal" {
            food["kcal"] = .number(Domain.round(amount, 1))
            priority = rank
        }
        guard let key = fdcNutrients[id], let desired = macroKeys.contains(key) ? "g" : unitByKey[key] else { continue }
        let converted: Double
        switch (unit, desired) {
        case ("g", "mg"), ("mg", "µg"): converted = amount * 1000
        case ("g", "ml"): converted = amount
        case (let a, let b) where a == b: converted = amount
        default: continue
        }
        if macroKeys.contains(key) { food[key] = .number(Domain.round(converted, 2)) }
        else { micros[key] = .number(Domain.round(converted, 3)) }
    }
    food["micros"] = .object(micros)
    return food
}

@MainActor
func foodEmbedding(store: Store, text: String) async throws -> JSONValue {
    let payload: Record = ["content": .object(["parts": .array([.object(["text": .string(text)])])]), "outputDimensionality": .number(768)]
    let result = try await store.ai(["kind": .string("embed"), "model": .string("gemini-embedding-001"), "payload": .object(payload)])
    let values = result.object?.object("embedding").array("values").compactMap(\.number) ?? []
    let length = sqrt(values.map { $0 * $0 }.reduce(0, +))
    guard values.count == 768, length.isFinite, length > 0 else { throw NutriError("Vector de búsqueda inválido.") }
    return .string("[" + values.map { String($0 / length) }.joined(separator: ",") + "]")
}

@MainActor
func searchSemanticFoods(store: Store, query: String) async throws -> [Record] {
    let vector = try await foodEmbedding(store: store, text: query)
    let result = try await store.rpc("match_foods", ["q": vector, "n": .number(8), "max_dist": .number(0.65)])
    return result.array?.compactMap(\.object) ?? []
}

@MainActor private var fdcSpanishNames: [String: String] = [:]

/// Visual aid only: English USDA descriptions are kept as the fallback and never stored as translated data.
@MainActor
func translateFDCEnEs(_ text: String) async -> String {
    guard !text.isEmpty else { return text }
    if let name = fdcSpanishNames[text] { return name }
    var url = URLComponents()
    url.scheme = "https"
    url.host = "api.mymemory.translated.net"
    url.path = "/get"
    url.queryItems = [.init(name: "q", value: text), .init(name: "langpair", value: "en|es")]
    var result = text
    if let url = url.url,
       let (data, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
       (response as? HTTPURLResponse)?.statusCode == 200,
       let value = try? JSONDecoder().decode(Record.self, from: data), value.number("responseStatus") == 200 {
        let translated = value.object("responseData").text("translatedText")
        if !translated.isEmpty { result = translated }
    }
    if !Task.isCancelled { fdcSpanishNames[text] = result }
    return result
}

/// Mirrors the web ilike name query; the base list remains the offline fallback.
@MainActor
func searchCatalogNames(store: Store, table: String, term: String, limit: Int? = nil) async throws -> [Record] {
    var query = table == "foods" ? Store.catalogQuery : ["order": "name.asc"]
    query["name"] = "ilike.%\(term)%"
    if let limit { query["limit"] = String(limit); query["order"] = nil }
    let rows = try await store.read(table, query)
    return table == "foods" ? rows.filter { !Domain.water($0) } : rows
}
