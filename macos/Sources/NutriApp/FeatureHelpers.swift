import Foundation
#if os(macOS)
import AppKit
#else
import CoreTransferable
import PhotosUI
#endif
import SwiftUI
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

struct FeatureFileExport {
    #if os(iOS)
    fileprivate var file: Document?
    #endif

    @MainActor
    mutating func save(_ data: Data, name: String, type: UTType) throws {
        #if os(macOS)
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [type]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try data.write(to: url, options: .atomic)
        #else
        file = Document(data: data, name: name, type: type)
        #endif
    }

    #if os(iOS)
    fileprivate struct Document: FileDocument {
        static var readableContentTypes: [UTType] { [.commaSeparatedText, .pdf] }

        let data: Data
        let name: String
        let type: UTType

        init(data: Data, name: String, type: UTType) {
            self.data = data
            self.name = name
            self.type = type
        }

        init(configuration: ReadConfiguration) throws {
            guard let data = configuration.file.regularFileContents else {
                throw CocoaError(.fileReadCorruptFile)
            }
            self.init(data: data, name: configuration.file.preferredFilename ?? "", type: configuration.contentType)
        }

        func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
            FileWrapper(regularFileWithContents: data)
        }
    }
    #endif
}

extension View {
    @ViewBuilder
    func nutriFeatureExport(_ state: Binding<FeatureFileExport>, onFailure: @escaping (Error) -> Void) -> some View {
        #if os(iOS)
        let file = state.wrappedValue.file
        fileExporter(isPresented: Binding(
            get: { state.wrappedValue.file != nil },
            set: { if !$0 { state.wrappedValue.file = nil } }
        ), document: file, contentType: file?.type ?? .data, defaultFilename: file?.name) { result in
            if case let .failure(error) = result { onFailure(error) }
        }
        #else
        self
        #endif
    }

    @ViewBuilder
    func nutriChartPoint(_ update: @escaping (CGPoint?) -> Void) -> some View {
        #if os(macOS)
        onContinuousHover { phase in
            switch phase {
            case let .active(point): update(point)
            case .ended: update(nil)
            }
        }
        #else
        onTapGesture(count: 1, coordinateSpace: .local) { point in update(point) }
        #endif
    }
}

enum FeatureImage: Hashable {
    case file(URL)
    #if os(iOS)
    case library(PhotosPickerItem)
    case camera(Data)
    #endif

    static func files(_ urls: [URL]) -> [Self] {
        urls.compactMap { url in
            guard url.isFileURL else { return nil }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let type = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType) ?? UTType(filenameExtension: url.pathExtension)
            return type?.conforms(to: .image) == true ? .file(url) : nil
        }
    }

    func jpeg(maxSide: Int = 1280, quality: Double = 0.85) async throws -> Data {
        switch self {
        case .file(let url): return try jpegData(url, maxSide: maxSide, quality: quality)
        #if os(iOS)
        case .camera(let data): return try jpegData(data, maxSide: maxSide, quality: quality)
        case .library(let item):
            guard let image = try await item.loadTransferable(type: LibraryImage.self) else {
                throw FeatureError("No se pudo abrir la imagen.")
            }
            return try jpegData(image.data, maxSide: maxSide, quality: quality)
        #endif
        }
    }

    #if os(iOS)
    private struct LibraryImage: Transferable {
        let data: Data

        static var transferRepresentation: some TransferRepresentation {
            DataRepresentation(importedContentType: .image) { Self(data: $0) }
        }
    }
    #endif
}

struct FeaturePhotoPicker<Label: View>: View {
    @EnvironmentObject private var store: Store
    var maximum: Int? = nil
    let onPick: (Result<[FeatureImage], Error>) -> Void
    @ViewBuilder let label: () -> Label
    @State private var filesOpen = false
    #if os(iOS)
    @State private var libraryOpen = false
    @State private var cameraOpen = false
    @State private var libraryItems: [PhotosPickerItem] = []
    #endif

    var body: some View {
        control.nutriFilePicker(isPresented: $filesOpen, types: [.image], multiple: maximum != 1) { result in
            onPick(result.map { $0.prefix(maximum ?? $0.count).map(FeatureImage.file) })
        }
    }

    @ViewBuilder private var control: some View {
        #if os(iOS)
        Menu {
            if nutriCameraAvailable {
                Button { cameraOpen = true } label: { SwiftUI.Label(store.tr("Tomar foto"), systemImage: "camera") }
            }
            Button { libraryOpen = true } label: { SwiftUI.Label(store.tr("Fototeca"), systemImage: "photo.on.rectangle") }
            Button { filesOpen = true } label: { SwiftUI.Label(store.tr("Archivos"), systemImage: "folder") }
        } label: { label() }
        .nutriCamera(isPresented: $cameraOpen) { result in
            onPick(result.map { [.camera($0)] })
        }
        .photosPicker(isPresented: $libraryOpen, selection: $libraryItems, maxSelectionCount: maximum, matching: .images)
        .onChange(of: libraryItems) { _, items in
            guard !items.isEmpty else { return }
            onPick(.success(items.map(FeatureImage.library)))
            libraryItems = []
        }
        #else
        Button { filesOpen = true } label: { label() }
        #endif
    }
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

func aiImagePart(_ image: FeatureImage, maxSide: Int = 1024) async throws -> Record {
    let jpeg = try await image.jpeg(maxSide: maxSide, quality: 0.8)
    return ["inline_data": .object(["mime_type": .string("image/jpeg"), "data": .string(jpeg.base64EncodedString())])]
}
