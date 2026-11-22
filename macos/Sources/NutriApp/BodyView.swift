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

    static let englishHeaders = [
        "day": "day", "note": "note",
        "peso_kg": "weight", "grasa_pct": "body_fat", "musculo_kg": "muscle", "agua_pct": "body_water",
        "agua_l": "body_water_l",
        "hueso_kg": "bone_mass", "grasa_visceral": "visceral_fat", "metabolismo_basal_kcal": "bmr",
        "cintura_cm": "waist", "cadera_cm": "hip", "pecho_cm": "chest", "cuello_cm": "neck",
        "biceps_der_cm": "right_biceps", "biceps_izq_cm": "left_biceps",
        "pierna_izq_cm": "left_leg", "pierna_der_cm": "right_leg",
        "pantorrilla_izq_cm": "left_calf", "pantorrilla_der_cm": "right_calf",
        "magra_tronco_kg": "ffm_trunk", "magra_brazo_izq_kg": "ffm_arm_l", "magra_brazo_der_kg": "ffm_arm_r",
        "magra_pierna_izq_kg": "ffm_leg_l", "magra_pierna_der_kg": "ffm_leg_r",
        "grasa_tronco_kg": "fat_trunk", "grasa_brazo_izq_kg": "fat_arm_l", "grasa_brazo_der_kg": "fat_arm_r",
        "grasa_pierna_izq_kg": "fat_leg_l", "grasa_pierna_der_kg": "fat_leg_r",
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

    static func preview(_ text: String) throws -> [(value: Self?, preview: CatalogCSVRow)] {
        var days = Set<String>()
        return try CSV.parse(text).map { row in
            let date = ["day", "date", "fecha"].compactMap { row[$0].map(cleanText) }.first { !$0.isEmpty } ?? ""
            var warnings: [String] = []
            var metrics: Record = [:]
            for column in row.keys.sorted() {
                let normalized = column.lowercased()
                let key = BodyMetric.aliases[normalized] ?? normalized
                guard let metric = BodyMetric.fields.first(where: { $0.key == key }), let number = decimal(row[column] ?? ""), number >= 0 else { continue }
                if let max = metric.max, number > max, !warnings.contains("fuera de rango") { warnings.append("fuera de rango") }
                if let previous = metrics[key]?.number, previous != number {
                    warnings.append("Dos columnas para \(metric.label)")
                }
                metrics[key] = .number(number)
            }
            let count = metrics.count
            if isoDate(date) == nil { warnings.append("fecha") }
            else if count == 0 { warnings.append("sin medidas") }
            let valid = isoDate(date) != nil && count > 0 && !warnings.contains(where: { $0.hasPrefix("Dos columnas") })
            let note = cleanText(row["note"] ?? "").isEmpty ? cleanText(row["nota"] ?? "") : cleanText(row["note"] ?? "")
            let unique = !valid || days.insert(date).inserted
            if !unique { warnings.append("Fecha repetida") }
            let value = valid && unique ? Self(day: date, metrics: metrics, note: note, warnings: warnings) : nil
            return (value, CatalogCSVRow(label: date.isEmpty ? "—" : date, suffix: "%n medidas", count: count, warnings: warnings, valid: value != nil))
        }
    }

}

struct BodyView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.nutriWindowWidth) private var windowWidth
    @FocusState private var focus: String?
    @State private var dateOpen = false
    @State private var photoDrag = false
    @State private var uploading = false
    @State private var trendHover: String?
    @State private var savedFlash = false
    @State private var importText = ""
    @State private var saveTask: Task<Void, Never>?
    @State private var day = Date()
    @State private var requestedDay: Date?
    @State private var loadingDay = true
    @State private var dayLoadFailed = false
    @State private var dayRequest = UUID()
    @State private var values: [String: String] = [:]
    @State private var note = ""
    @State private var photos: [String] = []
    @State private var existing: Record?
    @State private var history: [Record] = []
    @AppStorage("nutri.body.trendKey") private var trendKey = "peso_kg"
    @State private var more = false
    @State private var busy = false
    @State private var ready = false
    @State private var fileExport = FeatureFileExport()
    @State private var previewImport = false
    @State private var replace = false
    @State private var confirmDelete = false
    @State private var photoToDelete: String?
    @State private var message = ""
    @State private var selectedPhoto: String?
    @State private var importError = ""
    @State private var existingDays: Set<String> = []
    private let categories = ["Composición", "Circunferencias", "Segmental"]

    private var height: Double? { store.prefs.object("profile").number("height_cm") }
    private var favorites: [String] { store.prefs.array("fav_body").compactMap(\.string) }
    private var threshold: Double { store.prefs.number("sueno_umbral_h") ?? 6 }
    private var dayKey: String { Day.key(day) }
    private var requestedKey: String { Day.key(requestedDay ?? day) }
    private var navigationDay: Date { loadingDay ? requestedDay ?? day : day }
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
                VStack(alignment: .leading, spacing: 16) {
                    dateNavigation
                    Group {
                        capture(columns: windowWidth < 640 ? 2 : 3)
                        photoPanel
                    }
                    .disabled(!ready || loadingDay)
                    trendPanel
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 32)
                .frame(maxWidth: 768)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .font(.nutriSans(14)).foregroundStyle(palette.text)
        .task(id: requestedKey) { await loadDay() }
        .task {
            await refreshHistory()
            #if DEBUG
            if store.snapshotScenario == "body-import" {
                let recorded = history.last?.text("day") ?? "2026-07-07"
                importText = "day,weight,body_fat,waist\n" + recorded + ",80.5,22,86\n2026-07-08,75,82,85\n2026-02-30,80,24,90"
                previewImport = true
            }
            #endif
        }
        .onChange(of: focus) { previous, next in if previous != nil, previous != next { autosave() } }
        .onDisappear { autosave() }
        // Bloquear o salir no quita el foco: guarda lo tecleado al dejar de estar activa (pending evita escrituras vacías).
        .onChange(of: scenePhase) { _, phase in if phase != .active { autosave() } }
        .nutriSectionActions([.init("importar", label: store.tr("Importar"), icon: "upload", action: openImport)])
        .preference(key: NutriPresentedModalKey.self, value: presentedModal)
        .preference(key: NutriModalVisibleKey.self, value: previewImport || selectedPhoto != nil || confirmDelete)
        .nutriFeatureExport($fileExport) { store.report($0) }
        .nutriOnExitCommand {
            if previewImport, !busy { previewImport = false }
            if confirmDelete { confirmDelete = false; photoToDelete = nil }
            if selectedPhoto != nil { selectedPhoto = nil }
        }
    }

    private var presentedModal: NutriPresentedModal? {
        if previewImport {
            return NutriPresentedModal("body-import", close: closeImport, maxWidth: 512) { importSheet }
        }
        if let selectedPhoto {
            let close = { self.selectedPhoto = nil }
            return NutriPresentedModal("body-photo", close: close, maxWidth: 640) {
                VStack {
                    PrivateBodyPhoto(path: selectedPhoto).frame(maxWidth: .infinity, maxHeight: 420)
                    Button(store.tr("Cerrar"), action: close).buttonStyle(NutriButtonStyle(.secondary, height: 44))
                        .keyboardShortcut(.cancelAction)
                }.padding(16).nutriGlass(modal: true)
            }
        }
        if confirmDelete, let path = photoToDelete {
            let close = { confirmDelete = false; photoToDelete = nil }
            return NutriPresentedModal("body-delete-photo", close: close, maxWidth: 384) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(store.tr("¿Eliminar la foto?")).font(.nutriDisplay(19))
                    Text(store.tr("Se borra del almacenamiento y no se puede deshacer.")).foregroundStyle(palette.text2)
                    HStack {
                        Button(store.tr("Cancelar"), action: close)
                            .buttonStyle(NutriButtonStyle(.secondary, height: 44)).keyboardShortcut(.cancelAction)
                        Spacer()
                        Button(store.tr("Eliminar foto")) { close(); Task { await deletePhoto(path) } }
                            .buttonStyle(NutriButtonStyle(.danger, height: 44))
                    }
                }.padding(16).nutriGlass(modal: true)
            }
        }
        return nil
    }

    private func closeImport() {
        if !busy { previewImport = false }
    }

    private var dateNavigation: some View {
        HStack {
            Button { navigate(addingDays(-1, to: navigationDay)) } label: { NutriIcon("chevron-left", size: 22) }
                .accessibilityLabel(store.tr("Día anterior"))
            Spacer()
            Button { dateOpen.toggle() } label: {
                Text(dayKey == Day.key(Date()) ? store.tr("Hoy") : day.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).locale(locale)))
                    .font(.nutriDisplay(18)).foregroundStyle(palette.text).frame(minWidth: 180)
            }
            .accessibilityLabel(store.tr("Elegir fecha"))
            .popover(isPresented: $dateOpen) {
                DatePicker(store.tr("Elegir fecha"), selection: Binding(get: { day }, set: { dateOpen = false; navigate($0) }), displayedComponents: .date)
                    .labelsHidden().datePickerStyle(.graphical).padding(12)
            }
            Spacer()
            Button { navigate(addingDays(1, to: navigationDay)) } label: { NutriIcon("chevron-right", size: 22) }
                .accessibilityLabel(store.tr("Día siguiente"))
        }
        .buttonStyle(NutriButtonStyle(.quiet, height: windowWidth >= 768 ? 38 : 44))
        .overlay(alignment: .trailing) {
            Group {
                if loadingDay {
                    ProgressView().controlSize(.small).accessibilityLabel(store.tr("Cargando…"))
                } else if dayLoadFailed {
                    Button { Task { await loadDay() } } label: { NutriIcon("arrow.clockwise", size: 16).frame(width: 44, height: 44) }
                        .buttonStyle(.plain).foregroundStyle(palette.danger)
                        .accessibilityLabel(store.tr("Reintentar")).help(store.tr("Reintentar"))
                }
            }.padding(.trailing, 48)
        }
    }

    private func capture(columns: Int) -> some View {
        let grid = Array(repeating: GridItem(.flexible(), spacing: 12), count: columns)
        let extra = BodyMetric.fields.dropFirst(2)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(store.tr("Medidas del día")).foregroundStyle(palette.text3)
                Spacer()
                if !message.isEmpty {
                    Text(message).font(.nutriSans(12)).foregroundStyle(palette.danger).lineLimit(1).nutriHint(message)
                } else if savedFlash {
                    Text(store.tr("Guardado.")).font(.nutriSans(12)).foregroundStyle(palette.accent)
                }
            }.contentShape(Rectangle()).onTapGesture { focus = nil }
            LazyVGrid(columns: grid, spacing: 12) {
                ForEach(BodyMetric.fields.prefix(2)) { metricField($0) }
                ForEach(extra.filter { favorites.contains($0.key) }) { metricField($0, star: true) }
            }
            if !cleanText(values["peso_kg"] ?? "").isEmpty { derivedFields(grid) }
            if more {
                Text(store.tr("★ = favorito: aparece arriba junto a los principales.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                ForEach(categories, id: \.self) { category in
                    let fields = extra.filter { $0.category == category && !favorites.contains($0.key) }
                    if !fields.isEmpty {
                        Text(store.tr(category)).font(.nutriSans(12)).foregroundStyle(palette.text3)
                        LazyVGrid(columns: grid, spacing: 12) { ForEach(fields) { metricField($0, star: true) } }
                    }
                }
            }
            Button(store.tr(more ? "Menos medidas ▴" : "Más medidas ▾")) { more.toggle() }
                .buttonStyle(.plain).font(.nutriSans(12)).foregroundStyle(palette.accent).frame(minHeight: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(store.tr("Nota")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                TextField(store.tr("Contexto del día (opcional)"), text: $note, axis: .vertical)
                    .lineLimit(2...8).textFieldStyle(.plain).focused($focus, equals: "note")
                    .accessibilityIdentifier("body.note")
                    .font(.nutriSans(16)).padding(.horizontal, 12).padding(.vertical, 8).frame(minHeight: 66, alignment: .topLeading)
                    .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(focus == "note" ? palette.accent : palette.border).allowsHitTesting(false) }
            }
        }.padding(16).nutriCard()
    }

    private func derivedFields(_ grid: [GridItem]) -> some View {
        let draft = values.compactMapValues { decimal($0).map(JSONValue.number) }
        let fat = inheritedFat
        let derived = derivedBody(draft.merging(fat.map { ["grasa_pct": .number($0)] } ?? [:]) { current, _ in current }, heightCm: height)
        let formulas = ["ffm_kg": "peso × (1 − grasa% / 100)", "imc": "peso / altura² (altura del Perfil, en m)", "ffmi": "masa libre de grasa / altura² (altura del Perfil, en m)"]
        return VStack(alignment: .leading, spacing: 8) {
            Text(store.tr("Derivadas")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            LazyVGrid(columns: grid, spacing: 12) {
                ForEach(BodyMetric.derived) { metric in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 4) {
                            Text(store.tr(metric.label))
                            NutriHintButton(text: "\(store.tr(metric.label)) = \(store.tr(formulas[metric.key] ?? ""))") {
                                NutriIcon("circle-help", size: 12)
                            }
                        }.font(.nutriSans(12)).foregroundStyle(palette.text3)
                        HStack {
                            Text(derived.number(metric.key).map { numberText($0) } ?? "–").font(.nutriSans(16)).monospacedDigit().foregroundStyle(palette.text2)
                            Spacer()
                            Text(metric.unit).font(.nutriSans(12)).foregroundStyle(palette.text3)
                        }.padding(.horizontal, 12).frame(height: 44)
                            .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border, style: StrokeStyle(dash: [4, 3])) }
                    }
                }
            }
            if let fat {
                Text(store.tr("Se calculan con tu peso del día y tu última %s registrada.")
                    .replacingOccurrences(of: "%s", with: "\(store.tr("grasa")) \(numberText(fat)) %"))
            }
            if (height ?? 0) <= 0 { Text(store.tr("IMC y FFMI requieren tu altura — regístrala en tu Perfil (menú de usuario).")) }
        }.font(.nutriSans(11)).foregroundStyle(palette.text3)
    }

    private func metricField(_ metric: BodyMetric, star: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(store.tr(metric.label))
                if let max = metric.max, let value = decimal(values[metric.key] ?? ""), value > max {
                    NutriIcon("triangle-alert", size: 12).foregroundStyle(palette.danger).nutriHint(store.tr("Valor fuera de rango — revísalo"))
                }
                Spacer(minLength: 0)
                if star {
                    let favorite = favorites.contains(metric.key)
                    Button {
                        focus = nil
                        Task { await toggleFavorite(metric.key) }
                    } label: {
                        Image(systemName: favorite ? "star.fill" : "star").foregroundStyle(favorite ? palette.accent : palette.text3)
                            .frame(minWidth: nutriTouchSize(16), minHeight: nutriTouchSize(16)).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel(store.tr(favorite ? "Quitar de favoritos" : "Marcar como favorito") + " · " + store.tr(metric.label))
                        .accessibilityIdentifier("body.favorite." + metric.key)
                        .accessibilityAddTraits(favorite ? .isSelected : [])
                }
            }.font(.nutriSans(12)).foregroundStyle(palette.text3)
            if metric.key == "sueno_corto" {
                let on = (decimal(values[metric.key] ?? "") ?? 0) > 0
                Button {
                    focus = nil
                    values[metric.key] = on ? "" : draftNumber(threshold)
                    autosave()
                } label: {
                    HStack(spacing: 8) {
                        NutriIcon("moon", size: 16).foregroundStyle(on ? palette.accent : palette.text3)
                        Text(store.tr("Dormí menos de %n h").replacingOccurrences(of: "%n", with: numberText(threshold))).font(.nutriSans(12))
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 12).frame(height: 44)
                }.buttonStyle(.plain)
                    .background(on ? palette.accentDeep.opacity(0.15) : palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(on ? palette.accentDeep : palette.border) }
                    .accessibilityAddTraits(on ? .isSelected : [])
            } else {
                HStack(spacing: 4) {
                    TextField("–", text: Binding(get: { values[metric.key] ?? "" }, set: { values[metric.key] = $0 }))
                        .textFieldStyle(.plain).font(.nutriSans(16)).monospacedDigit().foregroundStyle(palette.text)
                        .nutriDecimalKeyboard()
                        .focused($focus, equals: metric.key)
                        .onSubmit { focus = nil; autosave() }
                        .accessibilityLabel(store.tr(metric.label))
                        .accessibilityIdentifier("body.metric." + metric.key)
                    Text(metric.unit).font(.nutriSans(12)).foregroundStyle(palette.text3)
                }.padding(.horizontal, 12).frame(height: 44)
                    .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
                    .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(focus == metric.key ? palette.accent : palette.border) }
            }
        }
    }

    private var photoPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(store.tr("Fotos de progreso")).foregroundStyle(palette.text3)
                Spacer()
                if uploading { Text(store.tr("Subiendo…")).font(.nutriSans(12)).foregroundStyle(palette.accent) }
            }
            if !photos.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(photos, id: \.self) { path in
                        Color.clear.aspectRatio(1, contentMode: .fit).overlay {
                            GeometryReader { region in
                                Button { selectedPhoto = path } label: {
                                    PrivateBodyPhoto(path: path, crop: true).frame(width: region.size.width, height: region.size.height).clipped()
                                }.buttonStyle(.plain).accessibilityLabel(store.tr("Abrir foto"))
                            }
                        }.background(palette.surface2).clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(alignment: .topTrailing) {
                            Button {
                                photoToDelete = path
                                confirmDelete = true
                            } label: {
                                NutriIcon("x", size: 16).foregroundStyle(.white).frame(width: 44, height: 44)
                                    .background(.black.opacity(0.55), in: Circle())
                            }.buttonStyle(.plain).padding(4).accessibilityLabel(store.tr("Eliminar foto"))
                        }
                    }
                }
            }
            if store.anonymous || store.demoActive {
                Text(store.tr("En la demo no se pueden subir fotos de progreso.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
            } else {
                FeaturePhotoPicker(onPick: { result in Task { await uploadPhotos(result) } }) {
                    HStack(spacing: 8) { NutriIcon("camera", size: 18); Text(store.tr("Añadir fotos")) }.frame(minHeight: 44)
                }.buttonStyle(.plain).foregroundStyle(palette.accent)
            }
        }.padding(16).nutriCard()
            .overlay { if photoDrag { RoundedRectangle(cornerRadius: 16).strokeBorder(palette.accentDeep, lineWidth: 2).allowsHitTesting(false) } }
            .dropDestination(for: URL.self) { urls, _ in
                let supported = FeatureImage.files(urls)
                guard !store.anonymous, !store.demoActive, !supported.isEmpty else { return false }
                Task { await uploadPhotos(.success(supported)) }; return true
            } isTargeted: { photoDrag = $0 && !store.anonymous && !store.demoActive }
            .disabled(busy)
    }

    private var trendPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(store.tr("Tendencia")).foregroundStyle(palette.text3)
                Spacer()
                NutriSelect(value: trendKey, select: { trendHover = nil; trendKey = $0 }, groups: categories.map { category in
                    NutriSelectGroup(label: store.tr(category), options: BodyMetric.fields
                        .filter { $0.category == category && $0.key != "sueno_corto" }.map { ($0.key, store.tr($0.label)) })
                }, height: 36, currentLabel: store.tr(trend.label))
                    .frame(width: 168).accessibilityLabel(store.tr("Medida a graficar"))

            }
            let points = history.compactMap { row -> (String, Double)? in
                guard let value = row.object("metrics").number(trend.key), value.isFinite else { return nil }
                return (String(row.text("day").suffix(5)), value)
            }
            if points.count < 2 {
                Text(store.tr("Registra esta medida en 2+ días para ver su tendencia."))
                    .foregroundStyle(palette.text2).frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                Chart {
                    if let trendHover, let point = points.first(where: { $0.0 == trendHover }) {
                        RuleMark(x: .value("Fecha", point.0)).foregroundStyle(palette.border)
                            .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit, y: .disabled)) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(point.0).foregroundStyle(palette.text)
                                    Text(store.tr(trend.label) + ": \(numberText(point.1, digits: 1)) \(trend.unit)").foregroundStyle(palette.protein)
                                }.font(.nutriSans(12)).padding(8).nutriCard(radius: 4, fill: palette.surface3)
                            }
                    }
                    ForEach(points.indices, id: \.self) { index in
                        LineMark(x: .value("Fecha", points[index].0), y: .value(trend.unit, points[index].1))
                            .interpolationMethod(.monotone).lineStyle(StrokeStyle(lineWidth: 2)).foregroundStyle(palette.protein)
                        PointMark(x: .value("Fecha", points[index].0), y: .value(trend.unit, points[index].1))
                            .symbolSize(13).foregroundStyle(palette.protein)
                            .accessibilityValue("\(numberText(points[index].1, digits: 1)) \(trend.unit)")
                    }
                }.chartYScale(domain: .automatic(includesZero: false))
                    .chartXAxis { AxisMarks(values: .automatic(desiredCount: min(points.count, 14))) { value in AxisValueLabel { if let text = value.as(String.self) { Text(text).font(.nutriSans(10)).foregroundStyle(palette.text3) } } } }
                    .chartYAxis { AxisMarks(position: .leading) { value in AxisGridLine().foregroundStyle(palette.border); AxisValueLabel { if let number = value.as(Double.self) { Text(numberText(number, digits: 1)).font(.nutriSans(10)).foregroundStyle(palette.text3) } } } }
                    .chartOverlay { proxy in
                        GeometryReader { geometry in
                            Rectangle().fill(.clear).contentShape(Rectangle()).nutriChartPoint { point in
                                guard let point, let frame = proxy.plotFrame, geometry[frame].contains(point) else {
                                    trendHover = nil
                                    return
                                }
                                let value: String? = proxy.value(atX: point.x - geometry[frame].minX)
                                #if os(iOS)
                                trendHover = trendHover == value ? nil : value
                                #else
                                trendHover = value
                                #endif
                            }
                        }
                    }
                    .frame(height: 220)
            }
        }.padding(16).nutriCard()
    }

    private var importSheet: some View {
        let parsed = Result { try BodyImportRow.preview(importText) }
        let rows = (try? parsed.get()) ?? []
        let valid = rows.compactMap(\.value)
        let collisions = valid.filter { existingDays.contains($0.day) }.count
        let parseError: String = { if case let .failure(error) = parsed { return error.localizedDescription }; return "" }()
        return CatalogCSVSheet(
            title: store.tr("Importar medidas"),
            description: store.tr("Sube o pega un CSV con una fila por día: una columna day (AAAA-MM-DD) y una columna por cada medida (%s…). Descarga la plantilla para ver los nombres exactos de las columnas.")
                .replacingOccurrences(of: "%s", with: store.lang == "en" ? "weight, body_fat, waist" : "peso_kg, grasa_pct, cintura_cm"),
            example: (store.lang == "en" ? "day,weight,body_fat,waist" : "day,peso_kg,grasa_pct,cintura_cm") + "\n2026-07-07,80.5,22,86",
            text: $importText, error: $importError, parseError: parseError, count: valid.count, busy: busy,
            close: closeImport, template: exportTemplate,
            commit: { Task { await commitImport(valid) } }
        ) {
            if collisions > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    Label(store.tr("%n días del CSV ya tienen medidas registradas.").replacingOccurrences(of: "%n", with: String(collisions)), systemImage: "exclamationmark.triangle")
                    HStack {
                        Button(store.tr("Complementar")) { replace = false }.buttonStyle(NutriButtonStyle(replace ? .secondary : .primary, height: 36))
                            .accessibilityAddTraits(replace ? [] : .isSelected)
                        Button(store.tr("Reemplazar")) { replace = true }.buttonStyle(NutriButtonStyle(replace ? .primary : .secondary, height: 36))
                            .accessibilityAddTraits(replace ? .isSelected : [])
                    }
                    Text(store.tr(replace ? "Reemplazar: el CSV sustituye por completo las medidas de esos días." : "Complementar: conserva tus medidas y solo agrega o actualiza las del CSV."))
                        .font(.nutriSans(11)).foregroundStyle(palette.text3)
                }.padding(10).nutriCard(radius: 12)
            }
            CatalogCSVPreview(rows: rows.map(\.preview))
        }.task {
            do { existingDays = Set(try await store.read("body_metrics", ["select": "day"]).map { $0.text("day") }) }
            catch { if !Task.isCancelled { store.report(error) } }
        }
    }

    private func openImport() {
        Task {
            await flushEdits()
            guard !busy, !pending, !loadingDay else { return }
            importText = ""; importError = ""; replace = false
            previewImport = true
        }
    }

    private func navigate(_ date: Date) {
        Task {
            await flushEdits()
            guard !busy, !pending else { return }
            if Day.key(date) == requestedKey {
                if dayLoadFailed { await loadDay() }
            } else {
                dayRequest = UUID()
                loadingDay = true
                requestedDay = date
            }
        }
    }

    private func autosave() {
        guard ready, pending else { return }
        let previous = saveTask
        saveTask = Task {
            await previous?.value
            if pending { await save() }
        }
    }

    private func flushEdits() async {
        focus = nil
        if pending { autosave() }
        await saveTask?.value
    }

    private func apply(_ row: Record?) {
        existing = row
        values = (row?.object("metrics") ?? [:]).compactMapValues { $0.number.map(draftNumber) }
        note = row?.text("note") ?? ""
        photos = row?.array("photo_paths").compactMap(\.string) ?? []
    }

    private func loadDay() async {
        let date = requestedDay ?? day
        let key = Day.key(date)
        let request = UUID()
        dayRequest = request
        loadingDay = true
        dayLoadFailed = false
        do {
            let result = try await store.read("body_metrics", ["day": "eq.\(key)"])
            guard request == dayRequest, key == requestedKey, !Task.isCancelled else { return }
            apply(result.first)
            day = date
            ready = true
            message = ""
            savedFlash = false
        } catch {
            guard request == dayRequest, key == requestedKey, !Task.isCancelled else { return }
            dayLoadFailed = true
            store.report(error)
        }
        loadingDay = false
    }

    private func refreshHistory() async {
        let query = ["select": "day,metrics", "day": "gte.\(Day.key(addingDays(-179, to: Date())))", "order": "day.asc"]
        if history.isEmpty, let cached = store.cached("body_metrics", query) { history = cached }
        do {
            let rows = try await store.read("body_metrics", query)
            if !Task.isCancelled { history = rows }
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
        guard ready, pending, !busy, let owner = store.owner else { return }
        busy = true
        defer { busy = false }
        do {
            let key = dayKey
            let original = originalValues
            let snapshot = values
            let savedNote = note
            let saveNote = noteChanged
            let editedMetrics = Set(snapshot.keys).union(original.keys).filter {
                cleanText(snapshot[$0] ?? "") != (original[$0] ?? "")
            }
            func applySaved(_ row: Record?) {
                let uncommitted = values.filter { key, value in value != snapshot[key] }
                let uncommittedNote = note == savedNote ? nil : note
                apply(row)
                for (key, value) in uncommitted { values[key] = value }
                if let uncommittedNote { note = uncommittedNote }
            }
            let latest = try await latestRecord(day: key, owner: owner)
            var metrics = latest?.object("metrics") ?? [:]
            for name in editedMetrics {
                let label = BodyMetric.fields.first { $0.key == name }?.label ?? name
                metrics[name] = try featureNumber(snapshot[name] ?? "", label: label).map(JSONValue.number)
            }
            let nextNote = saveNote ? optionalText(savedNote) : (latest?["note"] ?? .null)
            if let latest {
                if metrics.isEmpty, nextNote.string.map(cleanText)?.isEmpty ?? true, latest.array("photo_paths").isEmpty {
                    try await remove(latest)
                    applySaved(nil)
                } else {
                    var patch: Record = [:]
                    if !editedMetrics.isEmpty { patch["metrics"] = .object(metrics) }
                    if saveNote { patch["note"] = nextNote }
                    if patch.isEmpty { applySaved(latest) }
                    else {
                        let filter = try recordFilter(latest, matching: Array(patch.keys))
                        guard let written = try await store.update("body_metrics", filter, patch).first else { throw FeatureError("El registro cambió. Vuelve a salir del campo para reintentar.") }
                        applySaved(written)
                    }
                }
            } else if !metrics.isEmpty || nextNote != .null {
                applySaved(try await store.insert("body_metrics", [
                    "owner": .string(owner), "day": .string(key), "metrics": .object(metrics), "note": nextNote
                ]))
            } else { applySaved(nil) }
            message = ""
            savedFlash = true
            Task { try? await Task.sleep(for: .milliseconds(1200)); savedFlash = false }
            await refreshHistory()
        } catch { message = error.localizedDescription; store.report(error) }
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
        guard let deleted = try await store.delete("body_metrics", recordFilter(row, matching: ["metrics", "note", "photo_paths"])).first else {
            throw FeatureError("El servidor no confirmó el borrado.")
        }
        store.undo(store.tr("Medida borrada")) {
            guard store.owner == row.text("owner") else { throw CancellationError() }
            _ = try await store.insert("body_metrics", deleted)
            if dayKey == deleted.text("day") { apply(deleted) }
            await refreshHistory()
        }
    }

    private func uploadPhotos(_ result: Result<[FeatureImage], Error>) async {
        await flushEdits()
        guard ready, !loadingDay, !busy, !pending, !store.anonymous, !store.demoActive, let owner = store.owner else { return }
        let key = dayKey
        busy = true; uploading = true
        defer { busy = false; uploading = false }
        do {
            var failure: Error?
            for image in try result.get() {
                try Task.checkCancellation()
                guard store.owner == owner else { return }
                do {
                    let path = "\(owner)/\(UUID().uuidString.lowercased()).jpg"
                    let bytes = try await image.jpeg(quality: 0.8)
                    try Task.checkCancellation()
                    guard store.owner == owner else { return }
                    // Keep the unique path through an ambiguous upload result; do not repeat the write blindly.
                    let registered = try await setPhotoReference(path, present: true, day: key, owner: owner)
                    do {
                        _ = try await store.storage("POST", "object/body-photos/\(path)", body: bytes, contentType: "image/jpeg")
                        apply(registered)
                    } catch {
                        if store.owner == owner { apply(registered) }
                        if let status = (error as? NutriError)?.status, (400..<500).contains(status),
                           ![408, 409, 429].contains(status) {
                            apply(try await setPhotoReference(path, present: false, day: key, owner: owner))
                        }
                        throw error
                    }
                } catch { if failure == nil { failure = error } }
            }
            if let failure { store.report(failure) }
        } catch { store.report(error) }
    }

    private func deletePhoto(_ path: String) async {
        await flushEdits()
        guard ready, !loadingDay, !busy, !pending, let owner = store.owner,
              path.hasPrefix("\(owner)/"), !path.contains("..") else { return }
        let key = dayKey
        busy = true
        defer { busy = false }
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
                        let deleted = try await store.delete("body_metrics", recordFilter(latest, matching: ["metrics", "note", "photo_paths"]))
                        if !deleted.isEmpty { return nil }
                    } else {
                        let updated = try await store.update("body_metrics", recordFilter(latest, matching: ["photo_paths"]), [
                            "photo_paths": .array(next)
                        ]).first
                        if let updated { return updated }
                    }
                    continue
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
            let headers = ["day"] + BodyMetric.fields.map { store.lang == "en" ? BodyMetric.englishHeaders[$0.key] ?? $0.key : $0.key } + ["note"]
            try fileExport.save(Data((headers.joined(separator: ",") + "\n").utf8), name: "nutri_medidas_plantilla.csv", type: .commaSeparatedText)
        } catch { store.report(error) }
    }

    private func commitImport(_ importRows: [BodyImportRow]) async {
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
            store.toast(store.tr("%n días importados.").replacingOccurrences(of: "%n", with: String(payload.count)))
        } catch { importError = store.failure(error, "Error al importar.", networkOnly: true) }
    }
}

private struct PrivateBodyPhoto: View {
    @EnvironmentObject private var store: Store
    let path: String
    var crop = false
    @State private var image: NutriPlatformImage?
    @State private var error = false

    var body: some View {
        Group {
            if let image {
                Image(nutriImage: image).resizable().aspectRatio(contentMode: crop ? .fill : .fit).accessibilityLabel(store.tr("Foto de progreso"))
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
                image = NutriPlatformImage(data: data)
                error = image == nil
            } catch {
                if !Task.isCancelled { self.error = true }
            }
        }
    }
}
