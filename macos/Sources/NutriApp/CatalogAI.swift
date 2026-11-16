import AppKit
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

private let catalogNutrientUnits = Domain.micros.map { "\($0.key) (\($0.unit))" }.joined(separator: ", ")

// Native request contract mirrors production src/lib/ai.js (the eval-only path is separate).
func foodPrompt(language: String) -> String {
    """
    Eres un asistente de nutrición para México. Devuelve SIEMPRE los valores por 100 unidades de porción comestible (100 g, o 100 ml si el alimento es líquido y la etiqueta declara por ml).
    Puedes recibir hasta dos imágenes del MISMO producto (p. ej. frente del empaque con nombre/marca/código de barras y tabla nutrimental): combínalas como una sola fuente. Si ambas muestran etiqueta nutrimental, transcribe solo la más legible — nunca promedies valores entre imágenes.
    Sigue esta jerarquía, en orden:
    1. Si alguna imagen contiene una etiqueta nutrimental (NOM-051 o similar) legible: TRANSCRIBE los valores declarados, NO estimes. Si la etiqueta declara por gramos, normaliza a 100 g con el tamaño de porción declarado (p. ej. porción de 30 g → multiplica cada valor por 100/30) y basis = "100g". Si la etiqueta declara por mililitros (p. ej. "por 100 ml" o "por porción de 240 ml"), normaliza a 100 ml de la MISMA forma pero sin convertir a gramos — nunca inventes una densidad — y basis = "100ml". mode = "etiqueta".
    2. Si hay un código de barras con dígitos impresos legibles, devuélvelos en "ean" (solo dígitos, 8-14 caracteres). Si no se leen completos y sin ambigüedad, ean = null — nunca adivines dígitos.
    3. Si no hay etiqueta legible: estima con base tipo USDA FoodData Central, priorizando productos y preparaciones comunes en México, siempre por 100 g (basis = "100g"). mode = "estimacion".
    Unidades: kcal en kcal; protein_g, carbs_g y fat_g en gramos; micros: \(catalogNutrientUnits).
    OBLIGATORIOS: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg y magnesio_mg deben traer SIEMPRE la mejor estimación disponible, aunque sea aproximada. Devuelve null SOLO si es imposible dar una cifra mínimamente fundada — nunca rellenes con 0 inventado ni omitas por pereza.
    El resto de los micros (incluida grasa saturada/trans, azúcares y fibra): SOLO con dato fiable de etiqueta o base tipo USDA; si no, null. Un 0 real (p. ej. grasa trans en una manzana) sí es válido cuando el valor real es cero.
    COMPLETITUD (crítico): NO omitas ningún valor que la etiqueta o tu fuente declare. Si la etiqueta lista polialcoholes/edulcorantes (eritritol, xilitol, sorbitol, maltitol, sucralosa, aspartamo, acesulfamo K, glucósidos de esteviol, etc.), azúcares individuales (glucosa, fructosa, sacarosa…), tipos de grasa (mono/poliinsaturada, omega-3/6, ALA/EPA/DHA), aminoácidos, cafeína u otros micros de la lista, TRANSCRÍBELOS todos a su clave. Los edulcorantes de alta intensidad (en mg) solo si la etiqueta declara la cantidad — nunca los estimes; si solo mencionan su presencia sin cifra, déjalos en null.
    Si el alimento es genérico y SIN marca (nunca para productos empaquetados, que devolverían variantes de EE. UU.), da "usda_query": su nombre en inglés apto para buscar en USDA FoodData Central; si no aplica, null.
    Si es líquido o bebida, da "density_g_ml" usando estos valores canónicos cuando el tipo coincida: \(foodDensityPresets.map { "\($0.0.lowercased()) \(draftNumber($0.1))" }.joined(separator: ", ")); para otro líquido, tu mejor estimación; si no es líquido, null.
    "confidence": "alta"|"media"|"baja" según qué tan fundada está tu respuesta. "name" corto, \(language == "en" ? "in English" : "en español"). "brand" solo si es identificable.
    """
}

func recipePrompt(language: String, catalogNames: [String]) -> String {
    """
    Eres un asistente de nutrición para México. El usuario describe un platillo, bebida o receta (texto y/o hasta dos fotos; si hay dos, son del MISMO platillo — combínalas). Descompón en ingredientes con su cantidad en GRAMOS tal como van en la preparación.
    Prefiere pocos ingredientes compuestos ("leche entera", no "leche + grasa"). Máximo 15.
    Se te da la lista EXACTA de alimentos del catálogo del usuario. Para cada ingrediente, si uno de esos nombres corresponde claramente al ingrediente, devuelve ese nombre LITERAL en "db_match"; si no hay correspondencia clara, "db_match" = null. Nunca inventes nombres que no estén en la lista.
    Catálogo del usuario: \(catalogNames.isEmpty ? "(vacío)" : catalogNames.joined(separator: ", "))
    Para ingredientes genéricos sin match, da "usda_query" (nombre en inglés apto para buscar en USDA FoodData Central); si no aplica, null.
    Para CADA ingrediente da además sus valores nutricionales por 100 g de porción comestible, como respaldo revisable (base tipo USDA priorizando México). OBLIGATORIOS siempre con tu mejor estimación disponible: kcal, protein_g, carbs_g, fat_g, sodio_mg, potasio_mg, magnesio_mg (null SOLO si es imposible fundarlo, nunca 0 inventado). Resto de micros: solo con dato fiable, si no null. Unidades: kcal en kcal; protein_g/carbs_g/fat_g en gramos; micros: \(catalogNutrientUnits).
    Si el usuario indica tamaño total (p. ej. "350ml"), conviértelo a gramos con densidad razonable y devuélvelo en "total_weight_g"; si no lo indica, tu mejor estimación del peso total preparado; null si imposible.
    "kcal_total_estimate": tu estimación gruesa de kcal TOTALES del platillo completo (solo para verificación cruzada, jamás se persiste); null si no puedes fundarla.
    "name": nombre corto de la receta, \(language == "en" ? "in English" : "en español"). "confidence": "alta"|"media"|"baja".
    """
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
func estimateCatalogAI(store: Store, recipe: Bool = false, text: String, images: [URL], catalogNames: [String] = []) async throws -> Record {
    if store.demoActive || store.anonymous { return try catalogAIDemo(recipe: recipe, language: store.lang) }
    let entered = cleanText(text)
    let parts = [["text": JSONValue.string(entered.isEmpty ? "Analiza las imágenes." : entered)]] +
        (try images.prefix(2).map { try aiImagePart($0, maxSide: recipe ? 1024 : 2048) })
    return try await generateNutritionJSON(store: store,
        prompt: recipe ? recipePrompt(language: store.lang, catalogNames: catalogNames) : foodPrompt(language: store.lang),
        parts: parts, schema: recipe ? recipeAISchema() : foodAISchema())
}

struct CatalogAIDataCard<ResultLines: View>: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Binding var text: String
    @Binding var images: [URL]
    let loading: Bool
    let error: String
    let placeholder: String
    let hint: String
    let submit: () -> Void
    @ViewBuilder let result: () -> ResultLines
    @State private var dragging = false

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
                                if let image = try? jpegData(images[index], maxSide: 256), let thumbnail = NSImage(data: image) {
                                    Image(nsImage: thumbnail).resizable().scaledToFill()
                                        .frame(width: space.size.width, height: space.size.height).clipped()
                                }
                            }
                        }.overlay { palette.bg.opacity(0.35) }
                        .overlay { NutriIcon("x", size: 16).foregroundStyle(.white) }
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }.buttonStyle(.plain).accessibilityLabel(store.tr("Quitar foto")).disabled(loading)
                }
                if images.count < 2 {
                    Button { add(openFiles([.image], multiple: true)) } label: {
                        HStack(spacing: 8) {
                            NutriIcon("image-plus", size: 18)
                            if images.isEmpty { Text(store.tr("Foto (etiqueta o platillo)")).lineLimit(1) }
                        }.frame(maxWidth: .infinity)
                    }.buttonStyle(NutriButtonStyle(.secondary, height: 44)).disabled(loading)
                        .accessibilityLabel(store.tr(images.isEmpty ? "Foto (etiqueta o platillo)" : "Otra foto"))
                }
                Button(action: submit) {
                    HStack(spacing: 6) {
                        if loading { ProgressView().controlSize(.small).colorScheme(.dark) }
                        Text(store.tr(loading ? "Obteniendo…" : "Obtener datos")).lineLimit(1).fixedSize()
                    }
                }.buttonStyle(NutriButtonStyle(.primary, height: 44, horizontal: 16))
                    .disabled(loading || (cleanText(text).isEmpty && images.isEmpty))
            }
            if !error.isEmpty { Text(error).foregroundStyle(palette.danger) }
            if store.demoActive || store.anonymous {
                Text(store.tr("En la demo la IA muestra un ejemplo fijo; en la app real analiza tu texto o foto.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            }
            result()
            if !hint.isEmpty { Text(hint).font(.nutriSans(12)).foregroundStyle(palette.text3) }
        }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
            .overlay { if dragging || loading { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.accentDeep, lineWidth: dragging ? 2 : 1).allowsHitTesting(false) } }
            .dropDestination(for: URL.self) { urls, _ in
                guard !loading else { return false }; add(urls); return !urls.isEmpty
            } isTargeted: { dragging = $0 && !loading }
    }

    private func add(_ urls: [URL]) {
        let imageURLs = urls.filter { url in
            guard let type = try? url.resourceValues(forKeys: [.contentTypeKey]).contentType else { return false }
            return type.conforms(to: .image)
        }
        images = Array((images + imageURLs).prefix(2))
    }
}
