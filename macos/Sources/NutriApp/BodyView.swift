import AppKit
import Charts
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

struct BodyMetric: Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let unit: String
    let category: String
    let max: Double?

    static let derived = [
        BodyMetric(key: "ffm_kg", label: "Masa libre de grasa", unit: "kg", category: "Derivadas", max: nil),
        BodyMetric(key: "imc", label: "IMC", unit: "kg/m²", category: "Derivadas", max: nil),
        BodyMetric(key: "ffmi", label: "FFMI", unit: "kg/m²", category: "Derivadas", max: nil)
    ]
    static let fields = [
        BodyMetric(key: "peso_kg", label: "Peso", unit: "kg", category: "Composición", max: 500),
        BodyMetric(key: "sueno_corto", label: "Sueño", unit: "h", category: "Composición", max: nil),
        BodyMetric(key: "grasa_pct", label: "Grasa corporal", unit: "%", category: "Composición", max: 80),
        BodyMetric(key: "musculo_kg", label: "Masa muscular", unit: "kg", category: "Composición", max: 120),
        BodyMetric(key: "agua_pct", label: "Agua corporal", unit: "%", category: "Composición", max: 90),
        BodyMetric(key: "agua_l", label: "Agua corporal (L)", unit: "L", category: "Composición", max: 80),
        BodyMetric(key: "hueso_kg", label: "Masa ósea", unit: "kg", category: "Composición", max: 12),
        BodyMetric(key: "grasa_visceral", label: "Grasa visceral", unit: "nivel", category: "Composición", max: 60),
        BodyMetric(key: "metabolismo_basal_kcal", label: "Metabolismo basal", unit: "kcal", category: "Composición", max: 6000),
        BodyMetric(key: "cintura_cm", label: "Cintura", unit: "cm", category: "Circunferencias", max: 300),
        BodyMetric(key: "cadera_cm", label: "Cadera", unit: "cm", category: "Circunferencias", max: 300),
        BodyMetric(key: "pecho_cm", label: "Pecho", unit: "cm", category: "Circunferencias", max: 300),
        BodyMetric(key: "cuello_cm", label: "Cuello", unit: "cm", category: "Circunferencias", max: 120),
        BodyMetric(key: "biceps_der_cm", label: "Bíceps derecho", unit: "cm", category: "Circunferencias", max: 120),
        BodyMetric(key: "biceps_izq_cm", label: "Bíceps izquierdo", unit: "cm", category: "Circunferencias", max: 120),
        BodyMetric(key: "pierna_izq_cm", label: "Pierna izquierda", unit: "cm", category: "Circunferencias", max: 150),
        BodyMetric(key: "pierna_der_cm", label: "Pierna derecha", unit: "cm", category: "Circunferencias", max: 150),
        BodyMetric(key: "pantorrilla_izq_cm", label: "Pantorrilla izquierda", unit: "cm", category: "Circunferencias", max: 100),
        BodyMetric(key: "pantorrilla_der_cm", label: "Pantorrilla derecha", unit: "cm", category: "Circunferencias", max: 100),
        BodyMetric(key: "magra_tronco_kg", label: "Magra tronco", unit: "kg", category: "Segmental", max: 60),
        BodyMetric(key: "magra_brazo_izq_kg", label: "Magra brazo izq.", unit: "kg", category: "Segmental", max: 30),
        BodyMetric(key: "magra_brazo_der_kg", label: "Magra brazo der.", unit: "kg", category: "Segmental", max: 30),
        BodyMetric(key: "magra_pierna_izq_kg", label: "Magra pierna izq.", unit: "kg", category: "Segmental", max: 30),
        BodyMetric(key: "magra_pierna_der_kg", label: "Magra pierna der.", unit: "kg", category: "Segmental", max: 30),
        BodyMetric(key: "grasa_tronco_kg", label: "Grasa tronco", unit: "kg", category: "Segmental", max: 40),
        BodyMetric(key: "grasa_brazo_izq_kg", label: "Grasa brazo izq.", unit: "kg", category: "Segmental", max: 20),
        BodyMetric(key: "grasa_brazo_der_kg", label: "Grasa brazo der.", unit: "kg", category: "Segmental", max: 20),
        BodyMetric(key: "grasa_pierna_izq_kg", label: "Grasa pierna izq.", unit: "kg", category: "Segmental", max: 20),
        BodyMetric(key: "grasa_pierna_der_kg", label: "Grasa pierna der.", unit: "kg", category: "Segmental", max: 20),
    ]

    static let aliases = [
        "weight": "peso_kg",
        "peso": "peso_kg",
        "body_fat": "grasa_pct",
        "bodyfat": "grasa_pct",
        "body_fat_pct": "grasa_pct",
        "fat": "grasa_pct",
        "grasa": "grasa_pct",
        "muscle": "musculo_kg",
        "muscle_mass": "musculo_kg",
        "musculo": "musculo_kg",
        "water": "agua_pct",
        "body_water": "agua_pct",
        "body_water_l": "agua_l",
        "water_l": "agua_l",
        "tbw_l": "agua_l",
        "bone": "hueso_kg",
        "bone_mass": "hueso_kg",
        "visceral": "grasa_visceral",
        "visceral_fat": "grasa_visceral",
        "bmr": "metabolismo_basal_kcal",
        "waist": "cintura_cm",
        "hip": "cadera_cm",
        "hips": "cadera_cm",
        "chest": "pecho_cm",
        "neck": "cuello_cm",
        "right_biceps": "biceps_der_cm",
        "left_biceps": "biceps_izq_cm",
        "right_arm": "biceps_der_cm",
        "left_arm": "biceps_izq_cm",
        "left_leg": "pierna_izq_cm",
        "right_leg": "pierna_der_cm",
        "left_thigh": "pierna_izq_cm",
        "right_thigh": "pierna_der_cm",
        "left_calf": "pantorrilla_izq_cm",
        "right_calf": "pantorrilla_der_cm",
        "ffm_trunk": "magra_tronco_kg",
        "ffm_arm_l": "magra_brazo_izq_kg",
        "ffm_arm_r": "magra_brazo_der_kg",
        "ffm_leg_l": "magra_pierna_izq_kg",
        "ffm_leg_r": "magra_pierna_der_kg",
        "fat_trunk": "grasa_tronco_kg",
        "fat_arm_l": "grasa_brazo_izq_kg",
        "fat_arm_r": "grasa_brazo_der_kg",
        "fat_leg_l": "grasa_pierna_izq_kg",
        "fat_leg_r": "grasa_pierna_der_kg",
    ]
}

func derivedBody(_ values: Record, heightCm: Double?) -> Record {
    let weight = values.number("peso_kg").flatMap { $0 >= 0 ? $0 : nil }
    let fat = values.number("grasa_pct").flatMap { $0 >= 0 ? $0 : nil }
    let height = heightCm.flatMap { $0.isFinite && $0 > 0 ? $0 / 100 : nil }
    let lean = weight.flatMap { w in fat.map { w * (1 - $0 / 100) } }
    var result: Record = [:]
    if let lean { result["ffm_kg"] = .number((lean * 100).rounded() / 100) }
    if let height, let weight {
        result["imc"] = .number((weight / (height * height) * 10).rounded() / 10)
    }
    if let height, let lean {
        result["ffmi"] = .number((lean / (height * height) * 10).rounded() / 10)
    }
    return result
}

struct BodyImportRow: Identifiable {
    var id: String { day }
    let day: String
    let metrics: Record
    let note: String
    let warnings: [String]

    static func parse(_ text: String) throws -> [Self] {
        let raw = try CSV.parse(text)
        var days = Set<String>()
        return try raw.enumerated().map { index, row in
            let normalized = Dictionary(grouping: row.keys, by: { CSV.normalize($0) })
            func aliasedValue(_ aliases: [String]) throws -> String {
                let values = Set(aliases.flatMap { normalized[$0] ?? [] }
                    .compactMap { row[$0].map(cleanText) }.filter { !$0.isEmpty })
                guard values.count <= 1 else {
                    throw FeatureError("Columnas contradictorias · \(aliases[0]) · fila \(index + 2)")
                }
                return values.first ?? ""
            }
            let date = try aliasedValue(["day", "date", "fecha"])
            guard isoDate(date) != nil else {
                throw FeatureError("Fecha inválida en la fila \(index + 2).")
            }
            guard days.insert(date).inserted else { throw FeatureError("Fecha repetida · \(date)") }
            var metrics: Record = [:]
            var warnings: [String] = []
            for column in row.keys.sorted() {
                let lc = CSV.normalize(column)
                let key = BodyMetric.aliases[lc] ?? lc
                guard let metric = BodyMetric.fields.first(where: { $0.key == key }),
                      let number = try featureNumber(row[column] ?? "", label: "\(metric.label) · \(date)") else { continue }
                guard metrics[key] == nil else { throw FeatureError("Dos columnas para \(metric.label) · \(date)") }
                if let max = metric.max, number > max { warnings.append(metric.label) }
                metrics[key] = .number(number)
            }
            guard !metrics.isEmpty else { throw FeatureError("Sin medidas en la fila \(index + 2).") }
            let note = try aliasedValue(["note", "nota"])
            return Self(day: date, metrics: metrics, note: note, warnings: warnings)
        }
    }
}

struct BodyView: View {
    @EnvironmentObject private var store: Store
    @State private var day = Date()
    @State private var values: [String: String] = [:]
    @State private var note = ""
    @State private var photos: [String] = []
    @State private var existing: Record?
    @State private var history: [Record] = []
    @State private var trendKey = "peso_kg"
    @State private var more = false
    @State private var busy = false
    @State private var ready = false
    @State private var importingPhotos = false
    @State private var importingCSV = false
    @State private var previewImport = false
    @State private var importRows: [BodyImportRow] = []
    @State private var replace = false
    @State private var confirmDelete = false
    @State private var photoToDelete: String?
    @State private var message = ""
    @State private var selectedPhoto: String?
    @State private var importError = ""

    private var height: Double? { store.prefs.object("profile").number("height_cm") }
    private var favorites: [String] { store.prefs.array("fav_body").compactMap(\.string) }
    private var threshold: Double { store.prefs.number("sueno_umbral_h") ?? 6 }
    private var dayKey: String { Day.key(day) }
    private var trend: BodyMetric { (BodyMetric.fields + BodyMetric.derived).first { $0.key == trendKey } ?? BodyMetric.fields[0] }
    private var originalValues: [String: String] {
        (existing?.object("metrics") ?? [:]).compactMapValues { $0.number.map(draftNumber) }
    }
    private var pending: Bool {
        values.filter { !cleanText($0.value).isEmpty } != originalValues || noteChanged
    }
    private var noteChanged: Bool { cleanText(note) != cleanText(existing?.text("note") ?? "") }
    private var inheritedFat: Double? {
        guard cleanText(values["grasa_pct"] ?? "").isEmpty else { return nil }
        return history.reversed().compactMap { $0.object("metrics").number("grasa_pct") }.first { $0 >= 0 }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(store.tr("Medidas")).font(.largeTitle.bold())
                    Spacer()
                    Menu(store.tr("Importar"), systemImage: "square.and.arrow.down") {
                        Button(store.tr("Importar CSV…")) { importingCSV = true }
                        Button(store.tr("Descargar plantilla CSV…")) { exportTemplate() }
                    }
                    .disabled(busy || pending)
                }
                HStack {
                    Button { day = addingDays(-1, to: day) } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel(store.tr("Día anterior"))
                    DatePicker(store.tr("Fecha"), selection: $day, displayedComponents: .date)
                    Button { day = addingDays(1, to: day) } label: { Image(systemName: "chevron.right") }
                        .accessibilityLabel(store.tr("Día siguiente"))
                    Button(store.tr("Hoy")) { day = Date() }
                }
                .disabled(busy || pending)
                if !message.isEmpty { Text(message).foregroundStyle(.secondary) }
                if !ready && !busy {
                    Button(store.tr("Reintentar")) { Task { await loadDay() } }
                }
                if busy { ProgressView().controlSize(.small) }
                if ready { capture.disabled(busy) }
                trendPanel
            }.padding(24)
        }
        .task(id: dayKey) { await loadDay() }
        .task { await refreshHistory() }
        .fileImporter(isPresented: $importingPhotos, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            Task { await uploadPhotos(result) }
        }
        .fileImporter(isPresented: $importingCSV, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            do {
                let data = try secureFileData(result.get())
                guard let text = String(data: data, encoding: .utf8) else { throw FeatureError("El archivo debe estar en UTF-8.") }
                importRows = try BodyImportRow.parse(text)
                guard !importRows.isEmpty else { throw FeatureError("No hay medidas en el CSV.") }
                replace = false
                importError = ""
                previewImport = true
            } catch { store.report(error) }
        }
        .sheet(isPresented: $previewImport) { importSheet }
        .sheet(isPresented: Binding(get: { selectedPhoto != nil }, set: { if !$0 { selectedPhoto = nil } })) {
            if let selectedPhoto {
                VStack {
                    PrivateBodyPhoto(path: selectedPhoto).frame(minWidth: 550, minHeight: 420)
                    Button(store.tr("Cerrar")) { self.selectedPhoto = nil }.keyboardShortcut(.cancelAction)
                }.padding()
            }
        }
        .confirmationDialog(store.tr("¿Eliminar esta foto permanentemente?"), isPresented: $confirmDelete) {
            Button(store.tr("Eliminar foto"), role: .destructive) { Task { await deletePhoto() } }
        } message: { Text(store.tr("La foto se eliminará de tu almacenamiento privado.")) }
    }

    private var capture: some View {
        GroupBox(store.tr("Registro del día")) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(BodyMetric.fields.filter { $0.key == "peso_kg" || $0.key == "sueno_corto" || favorites.contains($0.key) }) { metricField($0) }
                DisclosureGroup(store.tr("Más medidas"), isExpanded: $more) {
                    ForEach(["Composición", "Circunferencias", "Segmental"], id: \.self) { category in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(store.tr(category)).font(.headline)
                            ForEach(BodyMetric.fields.filter { $0.category == category && !["peso_kg", "sueno_corto"].contains($0.key) }) { metric in
                                HStack {
                                    metricField(metric)
                                    Button { Task { await toggleFavorite(metric.key) } } label: {
                                        Image(systemName: favorites.contains(metric.key) ? "star.fill" : "star")
                                    }.accessibilityLabel(store.tr("Favorito"))
                                }
                            }
                        }.padding(.vertical, 6)
                    }
                }
                let draft = values.compactMapValues { decimal($0).map(JSONValue.number) }
                let fat = inheritedFat
                let derived = derivedBody(draft.merging(fat.map { ["grasa_pct": .number($0)] } ?? [:]) { current, _ in current }, heightCm: height)
                HStack(spacing: 20) {
                    ForEach(BodyMetric.derived) { metric in
                        VStack(alignment: .leading) {
                            Text(store.tr(metric.label)).font(.caption)
                            Text(derived.number(metric.key).map { "\(numberText($0)) \(metric.unit)" } ?? store.tr("Faltan medidas o altura"))
                        }
                    }
                }.padding(.vertical, 4)
                if let fat, derived.number("ffm_kg") != nil {
                    Text("\(store.tr("Última grasa corporal registrada")) · \(numberText(fat)) %")
                        .font(.caption).foregroundStyle(.secondary)
                }
                TextField(store.tr("Notas"), text: $note, axis: .vertical).lineLimit(2...8).textFieldStyle(.roundedBorder)
                photoPanel
                HStack {
                    if pending {
                        Button(store.tr("Descartar cambios")) { apply(existing) }
                    }
                    if existing != nil && photos.isEmpty {
                        Button(store.tr("Eliminar registro"), role: .destructive) { Task { await deleteRecord() } }
                    }
                    Spacer()
                    Button(store.tr("Guardar")) { Task { await save() } }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut("s", modifiers: [.command])
                        .disabled(!pending)
                }
            }.padding(8)
        }
    }

    private func metricField(_ metric: BodyMetric) -> some View {
        HStack {
            if metric.key == "sueno_corto" {
                Toggle(store.tr("Sueño corto"), isOn: Binding(
                    get: { (Double(values[metric.key] ?? "") ?? 0) > 0 },
                    set: { values[metric.key] = $0 ? draftNumber(threshold) : "" }
                ))
                Text("< \(values[metric.key].flatMap(Double.init).map { numberText($0) } ?? numberText(threshold)) h").foregroundStyle(.secondary)
            } else {
                Text(store.tr(metric.label)).frame(maxWidth: .infinity, alignment: .leading)
                TextField(metric.unit, text: Binding(get: { values[metric.key] ?? "" }, set: { values[metric.key] = $0 }))
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 100)
                    .accessibilityLabel(store.tr(metric.label))
                Text(metric.unit).foregroundStyle(.secondary).frame(width: 42, alignment: .leading)
                if let max = metric.max, let number = Double((values[metric.key] ?? "").replacingOccurrences(of: ",", with: ".")), number > max {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).help(store.tr("Fuera de rango"))
                }
            }
        }
    }

    private var photoPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(store.tr("Añadir fotos privadas…"), systemImage: "photo.badge.plus") { importingPhotos = true }
                .disabled(pending || store.anonymous)
            ScrollView(.horizontal) {
                HStack {
                    ForEach(photos, id: \.self) { path in
                        VStack {
                            Button { selectedPhoto = path } label: {
                                PrivateBodyPhoto(path: path).frame(width: 100, height: 100).clipped()
                            }.buttonStyle(.plain).accessibilityLabel(store.tr("Abrir foto"))
                            Button(store.tr("Eliminar foto"), systemImage: "trash") {
                                photoToDelete = path
                                confirmDelete = true
                            }.labelStyle(.iconOnly).disabled(pending)
                        }
                    }
                }
            }
        }
    }

    private var trendPanel: some View {
        GroupBox(store.tr("Tendencia · últimos 180 días")) {
            VStack(alignment: .leading) {
                Picker(store.tr("Medida"), selection: $trendKey) {
                    ForEach(BodyMetric.fields.filter { $0.key != "sueno_corto" } + BodyMetric.derived) {
                        Text(store.tr($0.label)).tag($0.key)
                    }
                }.frame(maxWidth: 320)
                let points = history.compactMap { row -> (Date, Double)? in
                    guard let date = isoDate(row.text("day")) else { return nil }
                    let values = row.object("metrics")
                    guard let value = values.number(trendKey) ?? derivedBody(values, heightCm: height).number(trendKey) else { return nil }
                    return (date, value)
                }
                if points.isEmpty {
                    Text(store.tr("Sin medidas para esta tendencia")).foregroundStyle(.secondary).padding(.vertical, 8)
                } else {
                    Chart {
                        ForEach(points.indices, id: \.self) { index in
                            LineMark(x: .value("Fecha", points[index].0), y: .value(trend.unit, points[index].1))
                            PointMark(x: .value("Fecha", points[index].0), y: .value(trend.unit, points[index].1))
                        }
                    }.chartYScale(domain: .automatic(includesZero: false)).frame(height: 180)
                }
            }.padding(8)
        }
    }

    private var importSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.tr("Importar medidas")).font(.title2.bold())
            Toggle(store.tr("Reemplazar medidas y notas de fechas existentes"), isOn: $replace)
            Text(store.tr(replace ? "Se conservan las fotos." : "El CSV complementa las medidas actuales y conserva notas sin reemplazo y fotos."))
                .foregroundStyle(.secondary)
            List(importRows) { row in
                VStack(alignment: .leading) {
                    Text("\(row.day) · \(row.metrics.count) \(store.tr("medidas"))")
                    if !row.warnings.isEmpty {
                        Text("\(store.tr("Fuera de rango")) · \(row.warnings.joined(separator: ", "))").foregroundStyle(.orange)
                    }
                }
            }.frame(minHeight: 180)
            if !importError.isEmpty { Text(importError).foregroundStyle(.red) }
            HStack {
                Button(store.tr("Cancelar")) { previewImport = false }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(store.tr("Importar")) { Task { await commitImport() } }.buttonStyle(.borderedProminent)
            }.disabled(busy)
        }.padding(20).frame(width: 560).interactiveDismissDisabled(busy)
    }

    private func apply(_ row: Record?) {
        existing = row
        values = (row?.object("metrics") ?? [:]).compactMapValues { $0.number.map(draftNumber) }
        note = row?.text("note") ?? ""
        photos = row?.array("photo_paths").compactMap(\.string) ?? []
    }

    private func loadDay() async {
        let key = dayKey
        ready = false
        message = ""
        do {
            let result = try await store.read("body_metrics", ["day": "eq.\(key)"])
            guard key == dayKey, !Task.isCancelled else { return }
            apply(result.first)
            ready = true
        } catch {
            guard !Task.isCancelled else { return }
            store.report(error)
        }
    }

    private func refreshHistory() async {
        do {
            history = try await store.read("body_metrics", ["select": "day,metrics", "day": "gte.\(Day.key(addingDays(-179, to: Date())))", "order": "day.asc"])
        } catch {
            if !Task.isCancelled { store.report(error) }
        }
    }

    private func toggleFavorite(_ key: String) async {
        let next = favorites.contains(key) ? favorites.filter { $0 != key } : favorites + [key]
        do { try await store.patchPrefs(["fav_body": .array(next.map(JSONValue.string))]) }
        catch { store.report(error) }
    }

    private func save() async {
        guard !busy, let owner = store.owner else { return }
        busy = true
        defer { busy = false }
        do {
            let key = dayKey
            let original = originalValues
            let editedMetrics = Set(values.keys).union(original.keys).filter {
                cleanText(values[$0] ?? "") != (original[$0] ?? "")
            }
            let latest = try await latestRecord(day: key, owner: owner)
            var metrics = latest?.object("metrics") ?? [:]
            for name in editedMetrics {
                let label = BodyMetric.fields.first { $0.key == name }?.label ?? name
                metrics[name] = try featureNumber(values[name] ?? "", label: label).map(JSONValue.number)
            }
            let nextNote = noteChanged ? optionalText(note) : (latest?["note"] ?? .null)
            if let latest {
                if metrics.isEmpty, nextNote.string.map(cleanText)?.isEmpty ?? true, latest.array("photo_paths").isEmpty {
                    try await remove(latest)
                    apply(nil)
                } else {
                    var patch: Record = [:]
                    if !editedMetrics.isEmpty { patch["metrics"] = .object(metrics) }
                    if noteChanged { patch["note"] = nextNote }
                    if patch.isEmpty { apply(latest) }
                    else {
                        let filter = try recordFilter(latest, matching: Array(patch.keys))
                        apply(try await store.update("body_metrics", filter, patch).first)
                    }
                }
            } else if !metrics.isEmpty || nextNote != .null {
                apply(try await store.insert("body_metrics", [
                    "owner": .string(owner), "day": .string(key), "metrics": .object(metrics), "note": nextNote
                ]))
            } else { apply(nil) }
            message = store.tr("Guardado")
            await refreshHistory()
        } catch { store.report(error) }
    }

    private func latestRecord(day key: String, owner: String) async throws -> Record? {
        let result = try await store.read("body_metrics", ["day": "eq.\(key)"])
        guard store.owner == owner, !Task.isCancelled else { throw CancellationError() }
        return result.first
    }

    private func recordFilter(_ row: Record, matching fields: [String]) throws -> [String: String] {
        let id = row.text("id")
        guard !id.isEmpty else { throw FeatureError("Registro no disponible.") }
        var filter = ["id": "eq.\(id)"]
        for field in fields {
            switch row[field] {
            case nil, .null: filter[field] = "is.null"
            case let .string(value): filter[field] = "eq.\(value)"
            case let value?:
                let data = try JSONEncoder().encode(value)
                filter[field] = "eq." + String(decoding: data, as: UTF8.self)
            }
        }
        return filter
    }

    private func remove(_ row: Record) async throws {
        guard row.array("photo_paths").isEmpty else {
            throw FeatureError("Elimina primero las fotos del registro.")
        }
        _ = try await store.delete("body_metrics", recordFilter(row, matching: ["metrics", "note", "photo_paths"]))
        store.undo(store.tr("Medidas eliminadas")) {
            guard store.owner == row.text("owner") else { throw CancellationError() }
            _ = try await store.insert("body_metrics", row)
            if dayKey == row.text("day") { apply(row) }
            await refreshHistory()
        }
    }

    private func deleteRecord() async {
        guard !busy, let existing else { return }
        busy = true
        defer { busy = false }
        do {
            try await remove(existing)
            apply(nil)
            await refreshHistory()
        } catch { store.report(error) }
    }

    private func uploadPhotos(_ result: Result<[URL], Error>) async {
        guard !busy, !pending, !store.anonymous, let owner = store.owner else { return }
        let key = dayKey
        busy = true
        defer { busy = false }
        do {
            for url in try result.get() {
                let path = "\(owner)/\(UUID().uuidString.lowercased()).jpg"
                let bytes = try jpegData(url)
                // Record the unique path before upload so an ambiguous response
                // cannot leave the only copy of a private photo unreferenced.
                let registered = try await setPhotoReference(path, present: true, day: key, owner: owner)
                do {
                    _ = try await store.storage("POST", "object/body-photos/\(path)", body: bytes, contentType: "image/jpeg")
                    apply(registered)
                } catch {
                    apply(registered)
                    if let status = (error as? NutriError)?.status, (400..<500).contains(status),
                       ![408, 409, 429].contains(status) {
                        apply(try await setPhotoReference(path, present: false, day: key, owner: owner))
                    }
                    throw error
                }
            }
        } catch { store.report(error) }
    }

    private func deletePhoto() async {
        guard !busy, !pending, let path = photoToDelete, let owner = store.owner,
              path.hasPrefix("\(owner)/"), !path.contains("..") else { return }
        let key = dayKey
        busy = true
        defer { busy = false; photoToDelete = nil }
        do {
            let body = try JSONEncoder().encode(["prefixes": [path]])
            let data = try await store.storage("DELETE", "object/body-photos", body: body, contentType: "application/json")
            let removed = (try? JSONDecoder().decode([Record].self, from: data)) ?? []
            if removed.isEmpty && !store.demoActive {
                // A replay after a successful deletion can return no records.
                do {
                    _ = try await store.storage("GET", "object/authenticated/body-photos/\(path)")
                    throw FeatureError("El almacenamiento todavía contiene la foto.")
                } catch let error as NutriError where error.status == 404 ||
                    ["not_found", "nosuchkey"].contains(error.code?.lowercased() ?? "") {
                    // The object is already absent. Metadata can be retried safely.
                }
            }
            apply(try await setPhotoReference(path, present: false, day: key, owner: owner))
        } catch { store.report(error) }
    }

    private func setPhotoReference(_ path: String, present: Bool, day key: String, owner: String) async throws -> Record? {
        for attempt in 0...1 {
            let latest = try await latestRecord(day: key, owner: owner)
            do {
                if let latest {
                    let previous = latest.array("photo_paths")
                    let value = JSONValue.string(path)
                    let next = present ? (previous.contains(value) ? previous : previous + [value]) : previous.filter { $0 != value }
                    guard next != previous else { return latest }
                    if next.isEmpty, latest.object("metrics").isEmpty, cleanText(latest.text("note")).isEmpty {
                        _ = try await store.delete("body_metrics", recordFilter(latest, matching: ["metrics", "note", "photo_paths"]))
                        return nil
                    }
                    return try await store.update("body_metrics", recordFilter(latest, matching: ["photo_paths"]), [
                        "photo_paths": .array(next)
                    ]).first
                }
                guard present else { return nil }
                return try await store.insert("body_metrics", [
                    "owner": .string(owner), "day": .string(key), "photo_paths": .array([.string(path)])
                ])
            } catch let error as NutriError where attempt == 0 && ["PGRST116", "23505"].contains(error.code ?? "") {
                // Another client changed the row. Reapply this one path to its latest version.
            }
        }
        throw FeatureError("No se pudo actualizar la referencia de la foto.")
    }

    private func exportTemplate() {
        do {
            let csv = CSV.encode([["day"] + BodyMetric.fields.map(\.key) + ["note"]])
            try saveFeatureFile(Data(csv.utf8), name: "nutri_medidas.csv", type: .commaSeparatedText)
        } catch { store.report(error) }
    }

    private func commitImport() async {
        guard let owner = store.owner else { return }
        busy = true
        importError = ""
        defer { busy = false }
        do {
            var existingByDay: [String: Record] = [:]
            for start in stride(from: 0, to: importRows.count, by: 75) {
                let dates = importRows[start..<min(start + 75, importRows.count)].map(\.day).joined(separator: ",")
                let rows = try await store.read("body_metrics", ["day": "in.(\(dates))"])
                for row in rows { existingByDay[row.text("day")] = row }
            }
            let payload = importRows.map { item -> Record in
                let previous = existingByDay[item.day] ?? [:]
                let metrics = replace ? item.metrics : previous.object("metrics").merging(item.metrics) { _, new in new }
                let note = !replace && item.note.isEmpty ? (previous["note"] ?? .null) : optionalText(item.note)
                return ["owner": .string(owner), "day": .string(item.day), "metrics": .object(metrics), "note": note]
            }
            _ = try await store.upsert("body_metrics", payload, onConflict: "owner,day")
            previewImport = false
            await loadDay()
            await refreshHistory()
            message = "\(payload.count) \(store.tr("registros importados"))"
        } catch { importError = error.localizedDescription }
    }
}

private struct PrivateBodyPhoto: View {
    @EnvironmentObject private var store: Store
    let path: String
    @State private var image: NSImage?
    @State private var error = false

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image).resizable().scaledToFit().accessibilityLabel(store.tr("Foto de progreso"))
            } else if error {
                Label(store.tr("Foto no disponible"), systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }.task(id: path) {
            image = nil
            error = false
            guard let owner = store.owner, path.hasPrefix("\(owner)/"), !path.contains("..") else { error = true; return }
            do {
                let data = try await store.storage("GET", "object/authenticated/body-photos/\(path)")
                guard !Task.isCancelled else { return }
                image = NSImage(data: data)
                error = image == nil
            } catch {
                if !Task.isCancelled { self.error = true }
            }
        }
    }
}
