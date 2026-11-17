import AppKit
import Foundation
import NutriCore
import UniformTypeIdentifiers

struct FeatureError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

let nutritionMacros = [
    (key: "kcal", label: "Energía", unit: "kcal"),
    (key: "protein_g", label: "Proteína", unit: "g"),
    (key: "carbs_g", label: "Carbohidratos", unit: "g"),
    (key: "fat_g", label: "Grasa", unit: "g")
]

func cleanText(_ string: String) -> String {
    string.trimmingCharacters(in: .whitespacesAndNewlines)
}

func featureNumber(_ string: String, label: String, minimum: Double = 0) throws -> Double? {
    let value = cleanText(string)
    guard !value.isEmpty else { return nil }
    guard let number = Double(value.replacingOccurrences(of: ",", with: ".")),
          number.isFinite, number >= minimum else {
        throw FeatureError("Valor inválido · \(label)")
    }
    return number
}

func numberText(_ value: Double?, digits: Int = 2) -> String {
    guard let value else { return "Sin datos" }
    return value.formatted(.number.precision(.fractionLength(0...digits)))
}

func optionalText(_ string: String) -> JSONValue {
    cleanText(string).isEmpty ? .null : .string(cleanText(string))
}

func dateFilter(_ start: String, _ end: String) -> [String: String] {
    ["and": "(day.gte.\(start),day.lte.\(end))", "order": "day.asc"]
}

func secureFileData(_ url: URL) throws -> Data {
    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
    return try Data(contentsOf: url)
}

@MainActor
func saveFeatureFile(_ data: Data, name: String, type: UTType) throws {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [type]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    try data.write(to: url, options: .atomic)
}

func nutritionValue(_ row: Record, _ key: String) -> Double? {
    row.number(key) ?? row.object("micros").number(key)
}

func aiSchema(_ type: String, nullable: Bool = false) -> JSONValue {
    .object(nullable ? ["type": .string(type), "nullable": .bool(true)] : ["type": .string(type)])
}

func aiObject(_ properties: Record, required: [String] = []) -> Record {
    var schema: Record = ["type": .string("OBJECT"), "properties": .object(properties)]
    if !required.isEmpty { schema["required"] = .array(required.map(JSONValue.string)) }
    return schema
}

func aiArray(_ items: JSONValue) -> JSONValue {
    .object(["type": .string("ARRAY"), "items": items])
}

private func standardAISchema(_ schema: Record) -> Record {
    var result = schema
    let type = schema.text("type").lowercased()
    result["type"] = schema["nullable"]?.bool == true ? .array([.string(type), .string("null")]) : .string(type)
    result["nullable"] = nil
    if let properties = schema["properties"]?.object {
        result["properties"] = .object(properties.mapValues { .object(standardAISchema($0.object ?? [:])) })
        result["required"] = .array(properties.keys.sorted().map(JSONValue.string))
        result["additionalProperties"] = .bool(false)
    }
    if let items = schema["items"]?.object { result["items"] = .object(standardAISchema(items)) }
    return result
}

@MainActor
func generateNutritionJSON(store: Store, prompt: String, parts: [Record], schema: Record) async throws -> Record {
    guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
    let limit = Date().addingTimeInterval(90)
    var lastError: Error = FeatureError("No hubo respuesta de IA.")
    for model in ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash", "mistral-small-latest"] {
        try Task.checkCancellation()
        guard store.owner == owner else { throw CancellationError() }
        let timeRemaining = limit.timeIntervalSinceNow
        guard timeRemaining > 0 else { throw FeatureError("La IA tardó demasiado. Captura los datos manualmente.") }
        let kind = model.hasPrefix("gemini") ? "gemini" : "mistral"
        let payload: Record
        if kind == "gemini" {
            payload = [
                "systemInstruction": .object(["parts": .array([.object(["text": .string(prompt)])])]),
                "contents": .array([.object(["parts": .array(parts.map(JSONValue.object))])]),
                "generationConfig": .object(["response_mime_type": .string("application/json"),
                    "response_schema": .object(schema), "temperature": .number(0), "mediaResolution": .string("MEDIA_RESOLUTION_HIGH")])
            ]
        } else {
            let content = parts.map { part -> JSONValue in
                if let text = part["text"] { return .object(["type": .string("text"), "text": text]) }
                let image = part.object("inline_data")
                let url = "data:\(image.text("mime_type"));base64,\(image.text("data"))"
                return .object(["type": .string("image_url"), "image_url": .string(url)])
            }
            let messages: [JSONValue] = [
                .object(["role": .string("system"), "content": .string(prompt)]),
                .object(["role": .string("user"), "content": .array(content)])
            ]
            payload = [
                "model": .string(model), "messages": .array(messages), "temperature": .number(0),
                "response_format": .object(["type": .string("json_schema"), "json_schema": .object([
                    "name": .string("nutri"), "strict": .bool(true), "schema": .object(standardAISchema(schema))
                ])])
            ]
        }
        do {
            let request: Record = ["kind": .string(kind), "model": .string(model), "payload": .object(payload)]
            let data = try await withThrowingTaskGroup(of: JSONValue.self) { tasks in
                tasks.addTask { try await store.ai(request) }
                tasks.addTask {
                    try await Task.sleep(for: .seconds(min(45, timeRemaining)))
                    throw FeatureError("La IA tardó demasiado. Captura los datos manualmente.")
                }
                defer { tasks.cancelAll() }
                guard let first = try await tasks.next() else { throw CancellationError() }
                return first
            }
            guard store.owner == owner else { throw CancellationError() }
            let text: String?
            if kind == "gemini" {
                let parts = data.object?.array("candidates").first?.object?.object("content").array("parts") ?? []
                text = parts.compactMap { $0.object?.text("text") }.joined()
            } else {
                text = data.object?.array("choices").first?.object?.object("message")["content"]?.string
            }
            guard let text, let value = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)).object else {
                throw FeatureError("Respuesta de IA inválida.")
            }
            return value.merging(["ai_model": .string("\(kind):\(model)")]) { _, model in model }
        } catch { lastError = error }
    }
    throw lastError
}

func aiImagePart(_ url: URL, maxSide: Int = 1024) throws -> Record {
    let jpeg = try jpegData(url, maxSide: maxSide, quality: 0.8)
    return ["inline_data": .object(["mime_type": .string("image/jpeg"), "data": .string(jpeg.base64EncodedString())])]
}
