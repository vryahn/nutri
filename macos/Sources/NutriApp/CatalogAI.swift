import NutriCore
import SwiftUI
import UniformTypeIdentifiers

private func nameLanguage(_ language: String) -> String { language == "en" ? "in English" : "en español" }

// Prompts come from src/lib/ai.js via macos/scripts/sync-domain.mjs (Contracts.json).
func foodPrompt(language: String) -> String {
    (Domain.prompts["food"] ?? "").replacingOccurrences(of: "{{name_lang}}", with: nameLanguage(language))
}

func recipePrompt(language: String, catalogNames: [String]) -> String {
    (Domain.prompts["recipe"] ?? "")
        .replacingOccurrences(of: "{{catalog}}", with: catalogNames.isEmpty ? "(vacío)" : catalogNames.joined(separator: ", "))
        .replacingOccurrences(of: "{{name_lang}}", with: nameLanguage(language))
}

private let catalogMicroSchema = Dictionary(uniqueKeysWithValues: Domain.micros.map { ($0.key, aiSchema("NUMBER", nullable: true)) })
private let catalogMacroSchema = Dictionary(uniqueKeysWithValues: Domain.macroKeys.map { ($0, aiSchema("NUMBER", nullable: true)) })

func foodAISchema() -> Record {
    let metadata: Record = ["mode": aiSchema("STRING"), "basis": aiSchema("STRING"), "ean": aiSchema("STRING", nullable: true),
                            "confidence": aiSchema("STRING"), "usda_query": aiSchema("STRING", nullable: true),
                            "name": aiSchema("STRING"), "brand": aiSchema("STRING", nullable: true),
                            "density_g_ml": aiSchema("NUMBER", nullable: true),
                            "micros": .object(aiObject(catalogMicroSchema, required: Domain.micros.map(\.key)))]
    return aiObject(metadata.merging(catalogMacroSchema) { _, number in number }, required: ["mode", "name", "micros"])
}

func recipeAISchema() -> Record {
    let ingredient: Record = ["name_es": aiSchema("STRING"), "grams": aiSchema("NUMBER"),
                              "db_match": aiSchema("STRING", nullable: true), "usda_query": aiSchema("STRING", nullable: true),
                              "micros": .object(aiObject(catalogMicroSchema))]
    let properties: Record = ["name": aiSchema("STRING"), "confidence": aiSchema("STRING"),
                              "total_weight_g": aiSchema("NUMBER", nullable: true), "kcal_total_estimate": aiSchema("NUMBER", nullable: true),
                              "ingredients": aiArray(.object(aiObject(ingredient.merging(catalogMacroSchema) { _, number in number }, required: ["name_es", "grams"])))]
    return aiObject(properties, required: ["name", "ingredients"])
}

// Fixed local demos use the web fixtures and never contact a model provider.
func catalogAIDemo(recipe: Bool, language: String) throws -> Record {
    let food = #"{"mode":"estimacion","basis":"100g","ean":null,"confidence":"media","usda_query":null,"name":"Yogur griego natural","brand":"","kcal":94.5,"protein_g":8.8,"carbs_g":4.8,"fat_g":4.3,"micros":{"grasa_sat_g":2.5,"azucar_g":4,"sodio_mg":45,"potasio_mg":141,"magnesio_mg":11,"calcio_mg":111},"density_g_ml":"","ai_model":"demo","demo":true}"#
    let dish = #"{"name":"Avena con plátano y chía","confidence":"media","total_weight_g":560,"kcal_total_estimate":620,"ingredients":[{"name_es":"Avena, cocida","grams":250,"db_match":null,"usda_query":null,"kcal":71,"protein_g":2.5,"carbs_g":12,"fat_g":1.5,"micros":{"fibra_g":1.7,"sodio_mg":4,"potasio_mg":61,"magnesio_mg":27}},{"name_es":"Leche entera","grams":200,"db_match":null,"usda_query":null,"kcal":61,"protein_g":3.2,"carbs_g":4.8,"fat_g":3.3,"micros":{"calcio_mg":113,"sodio_mg":43,"potasio_mg":132,"azucar_g":4.8}},{"name_es":"Plátano, crudo","grams":100,"db_match":null,"usda_query":null,"kcal":89,"protein_g":1.1,"carbs_g":22.8,"fat_g":0.3,"micros":{"fibra_g":2.6,"azucar_g":12.2,"potasio_mg":358,"magnesio_mg":27}},{"name_es":"Semilla de chía","grams":15,"db_match":null,"usda_query":null,"kcal":486,"protein_g":16.5,"carbs_g":42.1,"fat_g":30.7,"micros":{"fibra_g":34.4,"calcio_mg":631,"magnesio_mg":335,"potasio_mg":407}}],"demo":true}"#
    var result = try JSONDecoder().decode(Record.self, from: Data((recipe ? dish : food).utf8))
    if language == "en" {
        result["name"] = .string(recipe ? "Oatmeal with banana and chia" : "Greek yogurt, plain")
        if recipe {
            let names = ["Oatmeal, cooked", "Whole milk", "Banana, raw", "Chia seeds"]
            result["ingredients"] = .array(zip(result.array("ingredients"), names).map { value, name in
                .object((value.object ?? [:]).merging(["name_es": .string(name)]) { _, name in name })
            })
        }
    }
    return result
}

@MainActor
func estimateCatalogAI(store: Store, recipe: Bool = false, text: String, images: [FeatureImage], catalogNames: [String] = []) async throws -> Record {
    if store.demoActive || store.anonymous { return try catalogAIDemo(recipe: recipe, language: store.lang) }
    guard let owner = store.owner else { throw FeatureError("Sesión requerida.") }
    let entered = cleanText(text)
    var parts = [["text": JSONValue.string(entered.isEmpty ? "Analiza las imágenes." : entered)]]
    for image in images.prefix(2) {
        try Task.checkCancellation()
        parts.append(try await aiImagePart(image, maxSide: recipe ? 1024 : 2048))
        guard store.owner == owner else { throw CancellationError() }
    }
    return try await generateNutritionJSON(store: store,
        prompt: recipe ? recipePrompt(language: store.lang, catalogNames: catalogNames) : foodPrompt(language: store.lang),
        parts: parts, schema: recipe ? recipeAISchema() : foodAISchema())
}

struct CatalogAIDataCard<ResultLines: View>: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var text: String
    @Binding var images: [FeatureImage]
    let loading: Bool
    let error: String
    let placeholder: String
    let hint: String
    let submit: () -> Void
    @ViewBuilder let result: () -> ResultLines
    @State private var dragging = false
    @State private var thumbnails: [FeatureImage: NutriPlatformImage] = [:]
    @State private var thumbnailFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                NutriIcon("sparkles", size: 16).foregroundStyle(palette.accent)
                Text(store.tr("Datos con IA")).foregroundStyle(palette.text2)
            }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text).scrollContentBackground(.hidden).padding(.horizontal, 8).padding(.vertical, 5)
                    .frame(height: 62).accessibilityLabel(placeholder).disabled(loading)
                if text.isEmpty { Text(placeholder).foregroundStyle(palette.text3).padding(.horizontal, 12).padding(.top, 8).allowsHitTesting(false) }
            }.nutriCard(radius: 12, fill: palette.surface3)
            HStack(spacing: 8) {
                ForEach(images.indices, id: \.self) { index in
                    Button { images.remove(at: index) } label: {
                        Color.clear.frame(height: 44).overlay {
                            GeometryReader { space in
                                if let thumbnail = thumbnails[images[index]] {
                                    Image(nutriImage: thumbnail).resizable().scaledToFill()
                                        .frame(width: space.size.width, height: space.size.height).clipped()
                                }
                            }
                        }.overlay { palette.bg.opacity(0.35) }
                        .overlay { NutriIcon("x", size: 16).foregroundStyle(.white) }
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }.buttonStyle(.plain).accessibilityLabel(store.tr("Quitar foto")).disabled(loading)
                }
                if images.count < 2 {
                    FeaturePhotoPicker(maximum: 2 - images.count, onPick: add) {
                        HStack(spacing: 8) {
                            NutriIcon("image-plus", size: 18)
                            if images.isEmpty { Text(store.tr("Foto (etiqueta o platillo)")).lineLimit(1) }
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(NutriButtonStyle(.secondary, height: 44)).disabled(loading)
                        .accessibilityLabel(store.tr(images.isEmpty ? "Foto (etiqueta o platillo)" : "Otra foto"))
                }
                Button(action: submit) {
                    ZStack {
                        Text(store.tr("Obtener datos")).opacity(loading ? 0 : 1)
                        HStack(spacing: 6) {
                            Color.clear.frame(width: 16, height: 16).overlay {
                                if loading { ProgressView().controlSize(.small).colorScheme(.dark) }
                            }
                            Text(store.tr("Obteniendo…"))
                        }.opacity(loading ? 1 : 0)
                    }
                    .lineLimit(1).fixedSize()
                }.buttonStyle(NutriButtonStyle(.primary, height: 44, horizontal: 16))
                    .accessibilityLabel(store.tr(loading ? "Obteniendo…" : "Obtener datos"))
                    .disabled(loading || (cleanText(text).isEmpty && images.isEmpty))
            }
            if !error.isEmpty { Text(error).foregroundStyle(palette.danger) }
            else if thumbnailFailed { Text(store.tr("No se pudo abrir la imagen.")).foregroundStyle(palette.danger) }
            if store.demoActive || store.anonymous {
                Text(store.tr("En la demo la IA muestra un ejemplo fijo; en la app real analiza tu texto o foto.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
            result()
            if !hint.isEmpty { Text(hint).font(.nutriSans(12)).foregroundStyle(palette.text3) }
        }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
            .overlay { if dragging || loading { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.accentDeep, lineWidth: dragging ? 2 : 1).allowsHitTesting(false) } }
            .task(id: images) {
                var next: [FeatureImage: NutriPlatformImage] = [:]
                for photo in images {
                    if let cached = thumbnails[photo] { next[photo] = cached }
                    else if let data = try? await photo.jpeg(maxSide: 256), let image = NutriPlatformImage(data: data) { next[photo] = image }
                    if Task.isCancelled { return }
                }
                thumbnails = next
                thumbnailFailed = next.count != Set(images).count
            }
            .dropDestination(for: URL.self) { urls, _ in
                let files = FeatureImage.files(urls)
                guard !loading, !files.isEmpty else { return false }
                add(.success(files))
                return true
            } isTargeted: { dragging = $0 && !loading }
    }

    private func add(_ result: Result<[FeatureImage], Error>) {
        do { images = Array((images + (try result.get())).prefix(2)) }
        catch { store.report(error) }
    }
}
