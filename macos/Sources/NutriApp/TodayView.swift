import AppKit
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

struct TodayView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.nutriWindowWidth) private var width
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.nutriHasAccountOverlay) private var accountOverlay
    @AppStorage("nutri.today.collapsed") private var collapsedSections = "[]"
    @State private var date = Date()
    @State private var serverRows: [Record] = []
    @State private var loadedDay = ""
    @State private var labels: [Record] = []
    @State private var targets: [Record] = []
    @State private var history: [Record] = []
    @State private var catalog = JournalCatalog()
    @State private var focusQuickAdd = 0
    @State private var proposal: PhaseProposal?
    @State private var editor: Sheet?
    @State private var loading = true
    @State private var confirmingDeleteDay = false
    @State private var busy = false
    @State private var waterAmount = ""
    @State private var splashWater: Double?
    @State private var energy = ""
    @State private var quickLabel = ""
    @State private var quickFood: Record?
    @State private var quickKey = 0
    @State private var preview: Record?
    @State private var previewedID: String?
    @State private var scrollDestination: String?
    @State private var summaryBottom: CGFloat = 1
    @State private var showCalendar = false
    @State private var sectionHover: String?
    @State private var rowHover: String?
    @State private var entryDropActive = false
    @State private var entryDropReset: Task<Void, Never>?

    private enum Sheet: Identifiable {
        case entry(Record?, String, Record?, Double?)
        case labels, templates, summary, water, importing
        var id: String {
            switch self {
            case let .entry(row, label, food, _): return "entry-" + (row?.text("id") ?? "") + label + (food?.text("id") ?? "")
            case .labels: return "labels"
            case .templates: return "templates"
            case .summary: return "summary"
            case .water: return "water"
            case .importing: return "import"
            }
        }
    }

    private var day: String { Day.key(date) }
    private var rows: [Record] { store.queuedDay(loadedDay == day ? serverRows : [], day) }
    private var waterID: String { store.prefs.text("water_food_id") }
    private var foodRows: [Record] { journalFoods(rows, waterID: waterID) }
    private var waterRows: [Record] { rows.filter { !$0.text("food_id").isEmpty && $0.text("food_id") == waterID } }
    private var currentTarget: Record? { Domain.resolveTarget(targets, day) }
    private var totals: Record {
        let dayRows = rows.filter { $0.text("id") != previewedID } + (preview.map { [$0] } ?? [])
        var result = Domain.totals(dayRows)
        for key in Domain.macroKeys {
            result[key] = .number(dayRows.compactMap { $0.number(key) }.reduce(0, +))
        }
        return result
    }
    private var hasFood: Bool { !foodRows.isEmpty || preview != nil }
    private var desktop: Bool { width >= 1024 }
    private var viewMode: String {
        #if DEBUG
        if store.snapshotScenario == "today-goals" { return "objetivos" }
        if store.snapshotScenario == "today-mini" { return "mini" }
        #endif
        return journalViews.contains(store.prefs.text("today_view")) ? store.prefs.text("today_view") : "estado"
    }
    private var collapsed: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: Data(collapsedSections.utf8))) ?? [])
    }
    private var editingInline: Bool {
        guard desktop, case .entry(let row, _, _, _) = editor else { return false }
        return row != nil
    }

    private var hasModal: Bool { confirmingDeleteDay || editor != nil && !editingInline }

    var body: some View {
        Group {
            if desktop {
                GeometryReader { geometry in
                    HStack(alignment: .top, spacing: 24) {
                        journal.frame(width: max(0, geometry.size.width - 376), height: geometry.size.height)
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                summary
                                if editingInline, case let .entry(row, label, food, amount) = editor {
                                    editorForm(row, label: label, food: food, amount: amount, placement: .rail)
                                        .id(row?.text("id"))
                                } else { waterPanel }
                            }
                            .padding(.top, 16).padding(.bottom, 48)
                        }
                        .scrollIndicators(.hidden)
                        .frame(width: 320, height: geometry.size.height)
                    }.padding(.horizontal, 16)
                }
            } else {
                journal.padding(.horizontal, 16)
                    .overlay(alignment: .top) { fixedSummary }
                    .overlay(alignment: .bottomTrailing) { floatingAdd }
            }
        }
        .preference(key: NutriPresentedModalKey.self, value: presentedModal)
        .preference(key: NutriModalVisibleKey.self, value: hasModal)
        .nutriSectionActions(sectionActions)
        .task(id: day) { await loadDay(); await loadReference() }
        .task { await loadCatalog() }
        .background {
            JournalKeys { command in
                guard !accountOverlay else { return false }
                if command == .escape, editor != nil || confirmingDeleteDay {
                    if confirmingDeleteDay { confirmingDeleteDay = false }
                    else { dismissEditor() }
                    return true
                }
                guard !hasModal else { return false }
                switch command {
                case .previous: date = Day.add(date, -1)
                case .next: date = Day.add(date, 1)
                case .search:
                    guard desktop else { return false }
                    focusQuickAdd += 1
                    scrollDestination = "quick-add"
                case .escape: return false
                }
                return true
            }
        }
        #if DEBUG
        .task {
            switch store.snapshotScenario {
            case "today-add":
                editor = .entry(nil, "", nil, nil)
            case "today-summary":
                editor = .summary
            case "today-import":
                editor = .importing
            default: break
            }
        }
        #endif
        .onChange(of: day) { _, _ in
            energy = ""
            preview = nil
            previewedID = nil
        }
        .onChange(of: store.entryVersion) { _, _ in
            if store.pending == 0 {
                if let cached = store.cached("entry_nutrients", Store.entriesQuery(day)) {
                    loadedDay = day
                    serverRows = cached
                }
                Task { await loadDay() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nutriLabelsChanged)) { _ in Task { await loadLabels() } }
        .onAppear { openFromFood() }
        .onChange(of: store.logFood) { _, _ in openFromFood() }
    }

    private var presentedModal: NutriPresentedModal? {
        if confirmingDeleteDay {
            let close = { confirmingDeleteDay = false }
            return NutriPresentedModal("delete-" + day, close: close, maxWidth: 384) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(store.tr("Borrar día")).font(.nutriDisplay(19))
                    Text(store.tr("¿Borrar los %n registros de alimentos de este día? No se puede deshacer.")
                        .replacingOccurrences(of: "%n", with: String(foodRows.count)))
                        .font(.nutriSans(14)).foregroundStyle(palette.text2)
                    Button {
                        close()
                        run(clearDay)
                    } label: {
                        Text(store.tr("Borrar día")).font(.nutriSans(16, weight: .medium))
                            .foregroundStyle(palette.bg).frame(maxWidth: .infinity, minHeight: 44)
                            .background(palette.danger, in: RoundedRectangle(cornerRadius: 12, style: .circular))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Button(action: close) {
                        Text(store.tr("Cancelar")).font(.nutriSans(16))
                            .foregroundStyle(palette.text2).frame(maxWidth: .infinity, minHeight: 44)
                            .nutriCard(radius: 12, fill: .clear).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).keyboardShortcut(.cancelAction)
                }
                .padding(16).nutriGlass(modal: true)
            }
        }
        guard let editor, !editingInline else { return nil }
        let modalWidth: CGFloat = editor.id == "import" ? 512 : 384
        return NutriPresentedModal(editor.id, close: dismissEditor, maxWidth: modalWidth) { editorContent(editor) }
    }

    private var journal: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    dayToolbar
                    if desktop {
                        editorForm(nil, label: quickLabel, food: quickFood, amount: nil, placement: .inline)
                            .id(quickKey)
                            .id("quick-add")
                    } else {
                        summary.id("summary")
                            .background {
                                GeometryReader { proxy in
                                    Color.clear.preference(key: SummaryBottomKey.self,
                                                           value: proxy.frame(in: .named("journal")).maxY)
                                }
                            }
                    }
                    if let proposal { proposalCard(proposal) }
                    if !desktop { waterPanel }
                    if loading && rows.isEmpty {
                        VStack(spacing: 8) {
                            ForEach(0..<2) { _ in
                                RoundedRectangle(cornerRadius: 16).fill(palette.surface).frame(height: 56)
                            }
                        }
                    } else {
                        if labels.isEmpty && foodRows.isEmpty {
                            Text(store.tr("Sin registros este día")).foregroundStyle(palette.text2)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        }
                        ForEach(labels, id: \.self) { label in section(label).id(label.text("id")) }
                        if !entries(in: "").isEmpty || entryDropActive { section(nil).id("none") }
                    }
                }
                .padding(.top, 16).padding(.bottom, desktop ? 80 : 88)
            }
            .coordinateSpace(name: "journal")
            .onPreferenceChange(SummaryBottomKey.self) { summaryBottom = $0 }
            .onChange(of: scrollDestination) { _, value in
                guard let value else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { scroll.scrollTo(value, anchor: .top) }
                scrollDestination = nil
            }
        }
    }

    private var dayToolbar: some View {
        HStack(spacing: 0) {
            iconButton("chevron-left", "Día anterior", size: 22) { date = Day.add(date, -1) }
            Spacer()
            Button { showCalendar.toggle() } label: {
                Text(day == Day.key(.now) ? store.tr("Hoy") : formattedDate(date, weekday: true))
                    .font(.nutriDisplay(18)).foregroundStyle(palette.text)
                    .frame(maxWidth: .infinity, minHeight: 36)
            }.buttonStyle(.plain)
                .accessibilityLabel(store.tr("Elegir fecha"))
                .popover(isPresented: $showCalendar, arrowEdge: .bottom) {
                    DatePicker(store.tr("Elegir fecha"), selection: $date, displayedComponents: .date)
                        .datePickerStyle(.graphical).labelsHidden().padding(8)
                        .onChange(of: date) { _, _ in showCalendar = false }
                }
            Spacer()
            iconButton("chevron-right", "Día siguiente", size: 22) { date = Day.add(date, 1) }
        }
        .frame(height: 38)
        .background {
            if desktop {
                Button { beginAdd("") } label: { EmptyView() }
                    .buttonStyle(.plain).keyboardShortcut("n", modifiers: .command)
                    .accessibilityHidden(true)
            }
        }
    }

    private func formattedDate(_ date: Date, weekday: Bool = false) -> String {
        let locale = Locale(identifier: store.lang == "en" ? "en_US" : "es_MX")
        let style = Date.FormatStyle().day().month(.abbreviated).locale(locale)
        return date.formatted(weekday ? style.weekday(.abbreviated) : style)
    }

    private var sectionActions: [NutriSectionAction] {
        var actions: [NutriSectionAction] = []
        if day == Day.key(.now) {
            actions.append(.init("yesterday", label: store.tr("Ayer"), icon: "history", enabled: !busy) {
                run { try await copy(from: Day.key(Day.add(date, -1))) }
            })
        }
        actions.append(.init("copy-" + day, label: store.tr("Copiar"), icon: "copy") {
            do {
                try store.copyDay(day)
                store.toast(store.tr("Día copiado."))
            } catch { store.report(error) }
        })
        if let copiedDay = store.copiedDay, let copiedDate = Day.date(copiedDay) {
            actions.append(.init("paste-" + day + copiedDay,
                                 label: store.tr("Pegar %n").replacingOccurrences(of: "%n", with: formattedDate(copiedDate)),
                                 icon: "clipboard-paste", enabled: !busy) {
                run { try await copy(from: copiedDay) }
            })
        }
        actions.append(.init("templates", label: store.tr("Plantillas"), icon: "bookmark") { editor = .templates })
        actions.append(.init("import", label: store.tr("Importar"), icon: "upload") { editor = .importing })
        actions.append(.init("clear-" + day, label: store.tr("Borrar día"), icon: "trash-2", enabled: !busy) {
            if foodRows.isEmpty { store.toast(store.tr("Este día no tiene alimentos.")) }
            else { confirmingDeleteDay = true }
        })
        return actions
    }

    private var summary: some View {
        JournalSummary(mode: viewMode, totals: totals, target: currentTarget, hasFood: hasFood,
                       energy: $energy, desktop: desktop, customize: { editor = .summary }) {
            let next = journalViews[(journalViews.firstIndex(of: viewMode)! + 1) % journalViews.count]
            run { try await store.patchPrefs(["today_view": .string(next)]) }
        }
    }

    @ViewBuilder
    private var fixedSummary: some View {
        if summaryBottom < 0, currentTarget != nil || hasFood {
            Button { scrollDestination = "summary" } label: {
                JournalSummary(mode: "mini", totals: totals, target: currentTarget, hasFood: hasFood,
                               energy: $energy, desktop: false, fixed: true, customize: {}, cycle: {})
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(palette.bg)
                    .overlay(alignment: .bottom) { Rectangle().fill(palette.border).frame(height: 1) }
            }
            .buttonStyle(.plain).accessibilityLabel(store.tr("Ver resumen"))
        }
    }

    private var floatingAdd: some View {
        Button {
            editor = .entry(nil, "", nil, nil)
        } label: { NutriIcon("plus", size: 24).frame(width: 56) }
            .buttonStyle(NutriButtonStyle(.primary, height: 56, horizontal: 0, radius: 28))
            .keyboardShortcut("n", modifiers: .command)
            .accessibilityLabel(store.tr("Añadir registro"))
            .padding(.trailing, 16).padding(.bottom, width >= 768 ? 96 : 36)
    }

    private func proposalCard(_ proposal: PhaseProposal) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.tr("Regla de fase")).font(.nutriSans(13.5, weight: .medium))
                Text(proposal.reason).font(.nutriSans(12.5)).foregroundStyle(palette.text2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(store.tr("Propuesta pendiente de revisión en el plan maestro. Los objetivos no se modifican automáticamente."))
                .font(.nutriSans(12)).foregroundStyle(palette.text2)
        }.padding(16).nutriCard()
    }

    @ViewBuilder
    private func editorContent(_ sheet: Sheet) -> some View {
        switch sheet {
        case let .entry(row, label, food, amount):
            JournalSheet(row?.text("item") ?? store.tr("Añadir registro")) {
                VStack(alignment: .leading, spacing: 12) {
                    JournalSummary(mode: "mini", totals: totals, target: currentTarget, hasFood: hasFood,
                                   energy: $energy, desktop: false, live: true, customize: {}, cycle: {})
                    Rectangle().fill(palette.border).frame(height: 1)
                    editorForm(row, label: label, food: food, amount: amount, placement: .sheet)
                }
            }
        case .labels: MealLabelsView(close: dismissEditor)
        case .templates: MealTemplatesView(day: day, entries: foodRows, close: dismissEditor, reload: loadDay)
        case .summary: SummarySettingsView(close: dismissEditor)
        case .water:
            WaterSettingsView(close: dismissEditor)
        case .importing:
            EntryImportView(labels: labels, close: dismissEditor, reload: loadDay)
        }
    }

    private func editorForm(_ row: Record?, label: String, food: Record?, amount: Double?, placement: EntryEditor.Placement) -> some View {
        EntryEditor(row: row, day: day, initialLabel: label, initialFood: food, initialAmount: amount,
                    labels: labels, frequent: frequent, catalog: catalog, placement: placement,
                    focusToken: placement == .inline ? focusQuickAdd : 0,
                    autoFocus: placement == .inline && quickKey > 0, close: dismissEditor,
                    onPreview: { result in
                        if placement == .inline && editingInline { return }
                        previewedID = result == nil ? nil : row?.text("id")
                        preview = result
                    }, onSave: { label in
                        dismissEditor()
                        if placement == .inline {
                            quickLabel = label
                            quickFood = nil
                            quickKey += 1
                        }
                        scrollDestination = label.isEmpty ? "none" : label
                    })
    }

    private func dismissEditor() { editor = nil; preview = nil; previewedID = nil }

    private var waterPanel: some View {
        let storedGlass = store.prefs.number("water_glass_ml") ?? 1000
        let glass = storedGlass > 0 ? storedGlass : 1000
        let water = waterRows.reduce(0.0) { $0 + ($1.number("grams") ?? 0) }
        let filled = floor(water / glass)
        let fraction = water.truncatingRemainder(dividingBy: glass) / glass
        let splashIndex = fraction > 0 ? filled : filled - 1
        let bounds = currentTarget?.object("bounds").object("agua_ml") ?? [:]
        let goal = currentTarget.flatMap { Domain.value($0, "agua_ml") }
        let end = bounds.number("max") ?? goal ?? bounds.number("min")
        let glasses = Int(min(16, max(end.map { ceil($0 / glass) } ?? 3, filled + 1)))
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 4) {
                NutriFlow(spacing: 6, lineSpacing: 4) {
                    Text(store.tr("Agua")).font(.nutriSans(16, weight: .medium))
                    waterCaption(water, goal: goal, bounds: bounds)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                iconButton("settings", "Ajustes de agua", size: 18, width: 34) { editor = .water }
                    .padding(.trailing, -8)
            }
            NutriFlow(spacing: 8) {
                ForEach(0..<glasses, id: \.self) { index in
                    let full = Double(index) < filled
                    let part = Double(index) == filled ? fraction : 0
                    Button {
                        if full, let row = waterRows.last {
                            do { try store.removeEntry(row.text("id"), row: row) }
                            catch { store.report(error) }
                        }
                        else { run { try await addWater(glass) } }
                    } label: {
                        WaterGlass(fraction: full ? 1 : part, full: full, next: Double(index) == filled,
                                   animating: splashWater == water && Double(index) == splashIndex)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(full ? store.tr("Quitar último registro de agua")
                        : store.tr("Añadir vaso de %n").replacingOccurrences(of: "%n", with: volume(glass)))
                    .disabled(busy)
                }
            }
            HStack(spacing: 8) {
                TextField(store.tr(store.units == "us" ? "Cantidad (fl oz)" : "Cantidad (ml)"), text: $waterAmount)
                    .font(.nutriMono(16)).nutriInput().onSubmit(addCustomWater)
                Button(store.tr("Añadir"), action: addCustomWater)
                    .buttonStyle(NutriButtonStyle(.secondary, horizontal: 16))
            }
        }
        .padding(16).nutriCard()
    }

    private func waterCaption(_ water: Double, goal: Double?, bounds: Record) -> some View {
        func show(_ ml: Double, current: Bool = false) -> String {
            if store.units == "us" { return volume(ml) }
            return journalNumber(current && ml >= 1000 ? floor(ml / 100) / 10 : ml / 1000, digits: 3) + "L"
        }
        let min = bounds.number("min")
        let max = bounds.number("max")
        let target = goal.flatMap { $0 > 0 ? $0 : nil }
        return HStack(spacing: 4) {
            Text(show(water, current: true))
            if min != nil || max != nil || target != nil { Text("/") }
            if let min { Text("≥ " + show(min)) }
            if let target {
                if min != nil { Text("–") }
                NutriIcon("target", size: 13)
                Text(show(target)).help(store.tr("Meta de agua"))
            }
            if let max {
                if min != nil || target != nil { Text("–") }
                NutriIcon("arrow-up-to-line", size: 13)
                Text(show(max)).help(store.tr("Máximo de agua"))
            }
        }
        .font(.nutriMono(14)).foregroundStyle(palette.text3)
        .lineLimit(1).minimumScaleFactor(0.7)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(waterAccessibility(water, goal: target, min: min, max: max))
    }

    private func waterAccessibility(_ water: Double, goal: Double?, min: Double?, max: Double?) -> String {
        [volume(water), min.map { store.tr("Mín.") + " " + volume($0) }, goal.map { store.tr("Meta de agua") + " " + volume($0) },
         max.map { store.tr("Máximo de agua") + " " + volume($0) }].compactMap { $0 }.joined(separator: " · ")
    }

    private func addCustomWater() {
        guard let value = decimal(waterAmount), value >= 1 else { return }
        run {
            try await addWater(value * (store.units == "us" ? Domain.mlPerFluidOunce : 1))
            waterAmount = ""
        }
    }

    private func entries(in label: String) -> [Record] {
        let active = Set(labels.map { $0.text("id") })
        return foodRows.filter { row in
            let value = row.text("meal_label_id")
            return label.isEmpty ? !active.contains(value) : label == value
        }.sorted(by: Self.rowOrder)
    }

    private func section(_ label: Record?) -> some View {
        let id = label?.text("id") ?? ""
        let name = label?.text("name") ?? store.tr("Sin etiqueta")
        let entries = entries(in: id)
        let totals = Domain.totals(entries)
        let key = id.isEmpty ? "none" : id
        let hidden = collapsed.contains(key)
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    if !entries.isEmpty { toggleCollapsed(key) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            if !entries.isEmpty { NutriIcon(hidden ? "chevron-right" : "chevron-down", size: 13) }
                            Text(name.uppercased()).font(.nutriSans(11, weight: .semibold)).tracking(0.55)
                        }
                        .foregroundStyle(entries.isEmpty ? palette.text2 : palette.accent)
                        if !entries.isEmpty {
                            NutriFlow(spacing: 10, lineSpacing: 2) {
                                ForEach(macroChips(totals), id: \.key) { chip in
                                    Text(chip.text).font(.nutriMono(13)).foregroundStyle(palette.nutrient(chip.key, fallback: palette.text3))
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel((hidden ? store.tr("Expandir") : store.tr("Contraer")) + " " + name)
                .modifier(SectionDraggable(id: id, day: day, owner: store.owner, enabled: !busy))
                if !entries.isEmpty {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(journalNumber(totals.number("kcal") ?? 0, digits: 0)).font(.nutriMono(20, weight: .semibold))
                        Text("kcal").font(.nutriSans(12)).foregroundStyle(palette.text2)
                    }
                }
                if label != nil {
                    Button { beginAdd(id) } label: {
                        NutriIcon("plus").foregroundStyle(palette.accent).frame(width: 40, height: 40)
                    }.buttonStyle(.plain)
                        .accessibilityLabel(store.tr("Añadir a %n").replacingOccurrences(of: "%n", with: name))
                }
            }
            .padding(.leading, 12).padding(.trailing, label == nil ? 12 : 8)
            .padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(sectionHover == key ? palette.accent.opacity(0.55) : entries.isEmpty ? palette.border : palette.accent.opacity(0.4)).allowsHitTesting(false) }
            .dropDestination(for: String.self, action: { items, _ in
                guard let payload = items.first else { return false }
                return move(payload, label: id, over: nil)
            }, isTargeted: { sectionHover = $0 ? key : nil })
            if !hidden {
                ForEach(entries, id: \.self) { row in entryCard(row, label: id) }
            }
        }
    }

    private func entryCard(_ row: Record, label: String) -> some View {
        let id = row.text("id")
        let selected = editingInline && editor?.id.contains(id) == true
        return HStack(spacing: 12) {
            Button { editor = .entry(row, label, nil, nil) } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        (Text(row.text("item")).font(.nutriSans(16, weight: .medium))
                         + Text(row.text("brand").isEmpty ? "" : "  " + row.text("brand"))
                            .font(.nutriSans(14)).foregroundColor(palette.text3))
                            .lineLimit(2)
                        NutriFlow(spacing: 6, lineSpacing: 2) {
                            Text(weight(row.number("grams") ?? 0))
                            ForEach(macroChips(row), id: \.key) { chip in
                                Text("|").foregroundStyle(palette.text3)
                                Text(chip.text)
                            }
                        }
                        .font(.nutriMono(14)).foregroundStyle(palette.text2)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 6) {
                        if let sodium = Domain.value(row, "sodio_mg"), sodium >= 460 {
                            foodBadge("Na", sodium, color: palette.danger, help: "Alto en sodio")
                        }
                        if let potassium = Domain.value(row, "potasio_mg"), potassium >= 940 {
                            foodBadge("K", potassium, color: palette.warn, help: "Alto en potasio")
                        }
                        if row["_pending"]?.bool == true {
                            NutriIcon("cloud-off", size: 14).foregroundStyle(palette.text3)
                                .accessibilityLabel(store.tr("Pendiente de sincronizar"))
                        }
                        Text(row.number("kcal").map { journalNumber($0) + " kcal" } ?? "— kcal")
                            .font(.nutriMono(16)).foregroundStyle(palette.text2)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if rowHover == id {
                Button(role: .destructive) { remove(row) } label: {
                    NutriIcon("trash-2", size: 16).foregroundStyle(palette.danger)
                }
                .buttonStyle(.plain).accessibilityLabel(store.tr("Borrar"))
            }
        }
        .padding(12)
        .background(selected ? palette.surface2 : palette.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(selected ? palette.accent : palette.border).allowsHitTesting(false) }
        .onHover { rowHover = $0 ? id : nil }
        .contextMenu {
            Button(store.tr("Editar")) { editor = .entry(row, label, nil, nil) }
            Button(store.tr("Borrar"), role: .destructive) { remove(row) }
        }
        .accessibilityAction(named: store.tr("Borrar")) { remove(row) }
        .onDrag {
            entryDropActive = true
            entryDropReset?.cancel()
            entryDropReset = Task {
                do { try await Task.sleep(for: .seconds(30)); entryDropActive = false }
                catch { }
            }
            return NSItemProvider(object: dragKey("entry", id) as NSString)
        }
        .dropDestination(for: String.self) { items, _ in
            guard let payload = items.first else { return false }
            return move(payload, label: label, over: id)
        }
    }

    private func foodBadge(_ symbol: String, _ value: Double, color: Color, help: String) -> some View {
        Text(symbol + " " + journalNumber(value, digits: 0)).font(.nutriSans(10, weight: .medium))
            .foregroundStyle(color).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
            .help(store.tr(help))
    }

    private func macroChips(_ row: Record) -> [(key: String, text: String)] {
        var specs = [("protein_g","P"), ("carbs_g","C"), ("fat_g",store.tr("G"))]
        if desktop { specs += [("sodio_mg","Na"), ("potasio_mg","K"), ("magnesio_mg","Mg")] }
        return specs.compactMap { key, name in
            guard let value = Domain.value(row, key), value > 0 else { return nil }
            return (key, name + " " + journalNumber(value, digits: Domain.macroKeys.contains(key) ? 1 : 0))
        }
    }

    private func iconButton(_ icon: String, _ label: String, size: CGFloat = 16, width: CGFloat = 36, action: @escaping () -> Void) -> some View {
        Button(action: action) { NutriIcon(icon, size: size).frame(width: width, height: 34) }
            .buttonStyle(NutriButtonStyle(.quiet, height: 34, horizontal: 0))
            .accessibilityLabel(store.tr(label))
    }

    private func beginAdd(_ label: String) {
        if desktop {
            quickLabel = label
            quickFood = nil
            quickKey += 1
            scrollDestination = "quick-add"
        } else { editor = .entry(nil, label, nil, nil) }
    }

    private func toggleCollapsed(_ key: String) {
        var value = collapsed
        if !value.insert(key).inserted { value.remove(key) }
        if let data = try? JSONEncoder().encode(value.sorted()) { collapsedSections = String(decoding: data, as: UTF8.self) }
    }

    private func dragKey(_ type: String, _ id: String) -> String { journalDragKey(type, id: id, day: day, owner: store.owner) }

    private func move(_ payload: String, label: String, over: String?) -> Bool {
        defer { entryDropActive = false; entryDropReset?.cancel() }
        guard !busy, let id = payload.split(separator: "/").last.map(String.init) else { return false }
        if payload == dragKey("section", id), !label.isEmpty, over == nil, id != label,
           let from = labels.firstIndex(where: { $0.text("id") == id }),
           let to = labels.firstIndex(where: { $0.text("id") == label }) {
            run {
                var reordered = labels
                let item = reordered.remove(at: from)
                reordered.insert(item, at: to)
                labels = reordered
                do {
                    for (position, row) in reordered.enumerated() where row.number("sort_order") != Double(position) {
                        _ = try await store.update("meal_labels", ["id": "eq." + row.text("id")], ["sort_order": .number(Double(position))])
                    }
                } catch {
                    await loadLabels()
                    throw error
                }
                await loadLabels()
            }
            return true
        }
        let ordered = labels.flatMap { entries(in: $0.text("id")) } + entries(in: "")
        guard payload == dragKey("entry", id), id != over, let moving = ordered.first(where: { $0.text("id") == id }) else { return false }
        let source = labels.contains { $0.text("id") == moving.text("meal_label_id") } ? moving.text("meal_label_id") : ""
        var destination = entries(in: label).filter { $0.text("id") != id }
        if let over, let index = destination.firstIndex(where: { $0.text("id") == over }) {
            let from = ordered.firstIndex { $0.text("id") == id } ?? 0
            let to = ordered.firstIndex { $0.text("id") == over } ?? 0
            destination.insert(moving, at: index + (from < to ? 1 : 0))
        } else { destination.append(moving) }
        do {
            try writeOrder(destination, label: label, movingID: id)
            if source != label { try writeOrder(entries(in: source).filter { $0.text("id") != id }, label: source, movingID: "") }
        } catch { store.report(error) }
        return true
    }

    private func writeOrder(_ rows: [Record], label: String, movingID: String) throws {
        for (order, row) in rows.enumerated() {
            let id = row.text("id")
            var patch: Record = ["sort_order": .number(Double(order))]
            if id == movingID {
                patch["meal_label_id"] = label.isEmpty ? .null : .string(label)
                patch["meal"] = labels.first(where: { $0.text("id") == label })?["name"] ?? .null
            }
            if row.number("sort_order") == Double(order), id != movingID { continue }
            let payload = patch.filter { $0.key != "meal" }
            try store.editEntry(id, patch: payload, row: row.merging(patch) { _, new in new })
        }
    }

    private static func rowOrder(_ a: Record, _ b: Record) -> Bool {
        let lhs = a.number("sort_order") ?? .infinity
        let rhs = b.number("sort_order") ?? .infinity
        if lhs != rhs { return lhs < rhs }
        return a.text("created_at") < b.text("created_at")
    }

    private func weight(_ grams: Double) -> String {
        journalQuantity(grams, dimension: .mass, us: store.units == "us")
    }

    private func volume(_ ml: Double) -> String {
        journalQuantity(ml, dimension: .volume, us: store.units == "us")
    }

    private func loadDay() async {
        let key = day
        let query = Store.entriesQuery(key)
        if let cache = store.cached("entry_nutrients", query) { serverRows = cache; loadedDay = key }
        loading = loadedDay != key
        defer { if day == key { loading = false } }
        do {
            let result = try await store.read("entry_nutrients", query)
            if day == key, !Task.isCancelled { serverRows = result; loadedDay = key }
        } catch { store.report(error) }
    }

    private func loadLabels() async {
        let query = ["archived_at": "is.null", "order": "sort_order.asc,name.asc"]
        if let cached = store.cached("meal_labels", query) { labels = cached }
        do { labels = try await store.read("meal_labels", query) } catch { store.report(error) }
    }

    private func loadCatalog() async {
        do {
            async let foodRows = store.catalog()
            async let recipeRows = store.read("recipes", ["order": "name.asc"])
            async let nutrientRows = store.read("recipe_per_100g")
            let (foods, recipes, nutrients) = try await (foodRows, recipeRows, nutrientRows)
            guard !Task.isCancelled else { return }
            catalog = JournalCatalog(foods: foods, recipes: recipes, recipeMeta: nutrients, loaded: true)
        } catch { store.report(error) }
    }

    private func loadReference() async {
        await loadLabels()
        let key = day
        let start = Day.key(Day.add(date, -30))
        do {
            async let recent = store.read("entry_nutrients", dateFilter(start, key))
            async let targetRows = store.read("targets", ["order": "valid_from.desc.nullslast,dow.asc"])
            let (loadedHistory, loadedTargets) = try await (recent, targetRows)
            guard day == key, !Task.isCancelled else { return }
            history = loadedHistory
            targets = loadedTargets
            let now = Date()
            let today = Day.key(now)
            let active = Domain.activePhase(targets, day: today)
            if active.contains(where: { !$0.object("rules").isEmpty || $0.text("goal") == "deficit" }) {
                let filter = dateFilter(Day.key(Day.add(now, -34)), today)
                async let body = store.read("body_metrics", filter)
                async let totals = store.read("daily_totals", filter)
                let result = try await phaseProposal(targets: targets, phase: active, body: body, totals: totals, today: now)
                if day == key, !Task.isCancelled { proposal = result }
            } else { proposal = nil }
        } catch { store.report(error) }
    }

    private func frequent(_ label: String) -> [Record] {
        journalFrequent(history, date: date, label: label, waterID: waterID, currentRows: rows, dayReady: loadedDay == day)
    }

    private func openFromFood() {
        guard let food = store.logFood else { return }
        if let dated = Day.date(food.text("day")) { date = dated }
        let label = food.text("meal_label_id")
        if desktop {
            quickLabel = label
            quickFood = food
            quickKey += 1
        } else { editor = .entry(nil, label, food, nil) }
        store.logFood = nil
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { store.report(error) }
        }
    }

    private func addWater(_ ml: Double) async throws {
        let meta: Record = ["kcal": .number(0), "protein_g": .number(0), "carbs_g": .number(0), "fat_g": .number(0),
                            "micros": .object(["agua_ml": .number(100)])]
        var food: Record?
        if !waterID.isEmpty {
            do { food = try await store.read("foods", ["id": "eq." + waterID]).first(where: Domain.water) }
            catch let error as URLError where error.code != .cancelled { food = ["id": .string(waterID)] }
        }
        if food == nil {
            guard let owner = store.owner else { throw CancellationError() }
            let own = try await store.read("foods", ["owner": "eq." + owner, "name": "eq.Agua"])
            if let existing = own.first(where: Domain.water) { food = existing }
            else {
                food = try await store.insert("foods", meta.merging(["name": .string("Agua"), "source": .string("manual")]) { _, new in new })
            }
            if let id = food?.text("id") { try await store.patchPrefs(["water_food_id": .string(id)]) }
        }
        guard let id = food?.text("id"), !id.isEmpty else { throw NutriError("No se encontró el alimento para registrar agua.") }
        let payload: Record = ["id": .string(UUID().uuidString.lowercased()), "day": .string(day), "grams": .number(ml),
                               "food_id": .string(id), "recipe_id": .null, "meal_label_id": .null]
        let row = payload.merging(Domain.scaled(meta, grams: ml)) { _, new in new }
            .merging(["item": .string("Agua"), "created_at": .string(Date.now.ISO8601Format())]) { _, new in new }
        splashWater = waterRows.reduce(0) { $0 + ($1.number("grams") ?? 0) } + ml
        try store.addEntry(payload, row: row)
    }

    private func remove(_ row: Record) {
        do {
            try store.removeEntry(row.text("id"), row: row)
            store.undo(store.tr("Registro borrado")) {
                var payload = entryPayload(row)
                payload["day"] = row["day"]
                payload["id"] = .string(UUID().uuidString.lowercased())
                payload["sort_order"] = row["sort_order"] ?? .null
                try store.addEntry(payload, row: row.merging(payload) { _, new in new })
            }
        } catch { store.report(error) }
    }

    private func copy(from source: String) async throws {
        let sourceRows = try await store.read("entry_nutrients", Store.entriesQuery(source))
        let sourceFood = journalFoods(sourceRows, waterID: waterID)
        guard !sourceFood.isEmpty else { throw NutriError("Ese día no tiene registros.") }
        let payload: [Record] = sourceFood.map { entryPayload($0).merging(["day": .string(day)]) { _, new in new } }
        _ = try await store.insert("entries", payload)
        store.toast("\(payload.count) " + store.tr("registros copiados."))
        await loadDay()
    }

    private func clearDay() async throws {
        let snapshot = foodRows
        let ids = snapshot.map { $0.text("id") }
        guard !ids.isEmpty else { return }
        for row in snapshot where row["_pending"]?.bool == true {
            try store.removeEntry(row.text("id"), row: row)
        }
        let synced = snapshot.filter { $0["_pending"]?.bool != true }.map { $0.text("id") }
        if !synced.isEmpty {
            _ = try await store.delete("entries", ["day": "eq." + day, "id": "in.(" + synced.joined(separator: ",") + ")"])
        }
        store.toast(store.tr("%n registros borrados.").replacingOccurrences(of: "%n", with: String(ids.count)))
        await loadDay()
    }


}

private func entryPayload(_ row: Record) -> Record {
    ["meal_label_id": row["meal_label_id"] ?? .null, "food_id": row["food_id"] ?? .null,
     "recipe_id": row["recipe_id"] ?? .null, "grams": row["grams"] ?? .null]
}

private struct EntryEditor: View {
    enum Placement { case inline, rail, sheet }

    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @FocusState private var queryFocused: Bool
    let row: Record?
    let day: String
    let initialLabel: String
    let initialFood: Record?
    let initialAmount: Double?
    let labels: [Record]
    let frequent: (String) -> [Record]
    let catalog: JournalCatalog
    let placement: Placement
    let focusToken: Int
    let autoFocus: Bool
    let close: () -> Void
    let onPreview: (Record?) -> Void
    let onSave: (String) -> Void
    @State private var remoteChoices: [Record]?
    @State private var search = ""
    @State private var selected: Record?
    @State private var unit = "g"
    @State private var amount = ""
    @State private var suggested: Double?
    @State private var label = ""
    @State private var activeIndex = -1
    @State private var hasInitialized = false

    private var density: Double? { selected?.number("density_g_ml") }
    private var grams: Double? {
        if amount.isEmpty { return suggested }
        guard let value = decimal(amount), let g = Domain.grams(value, unit: unit, density: density) else { return nil }
        return unit == "g" ? g : Domain.round(g, 1)
    }
    private var isRecipe: Bool { selected?["_recipe"]?.bool == true }
    private var isAdding: Bool { row == nil }
    private var meta: Record {
        guard let selected else { return [:] }
        if isRecipe { return catalog.recipeMeta.first { $0.text("recipe_id") == selected.text("id") } ?? [:] }
        return selected["item"] != nil ? [:] : selected
    }
    private var livePreview: Record? {
        guard selected != nil, let grams, !meta.isEmpty else { return nil }
        return Domain.scaled(meta, grams: grams)
    }

    private var choices: [Record] {
        guard selected == nil else { return [] }
        return remoteChoices ?? localChoices(cleanText(search))
    }

    private func localChoices(_ query: String) -> [Record] {
        let needle = query.lowercased()
        guard !needle.isEmpty else { return [] }
        func matches(_ value: Record) -> Bool {
            value.text("name").lowercased().contains(needle) || value.text("brand").lowercased().contains(needle)
        }
        let foods = Array(catalog.foods.lazy.filter(matches).prefix(8))
        let recipes = Array(catalog.recipes.lazy.filter(matches).prefix(8))
        return mergedChoices(foods: foods, recipes: recipes)
    }

    private func mergedChoices(foods: [Record], recipes: [Record]) -> [Record] {
        let water = store.prefs.text("water_food_id")
        let all = foods.filter { $0.text("id") != water } + recipes.map { $0.merging(["_recipe": .bool(true)]) { _, new in new } }
        return all.filter { $0.text("source") != "usda" } + all.filter { $0.text("source") == "usda" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if placement == .rail {
                HStack(alignment: .firstTextBaseline) {
                    (Text(row?.text("item") ?? "").font(.nutriDisplay(18)) +
                     Text(row?.text("brand").isEmpty == false ? "  " + (row?.text("brand") ?? "") : "")
                        .font(.nutriSans(14)).foregroundColor(palette.text3))
                    Spacer(minLength: 0)
                    Button(action: close) { NutriIcon("x").frame(width: 36, height: 36) }
                        .buttonStyle(.plain).keyboardShortcut(.cancelAction).accessibilityLabel(store.tr("Cerrar"))
                }
            }
            if isAdding {
                labelPicker
                if selected == nil { frequentChips }
                queryField
                if selected == nil { newFoodButton }
            }
            if selected != nil {
                quantityField
                if !isAdding { labelPicker }
                buttons
                if !isAdding { contributionPanel }
            }
        }
        .padding(placement == .sheet ? 0 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if placement != .sheet {
                RoundedRectangle(cornerRadius: 16).fill(palette.surface)
                RoundedRectangle(cornerRadius: 16).strokeBorder(palette.border)
            }
        }
        .task {
            if !hasInitialized {
                hasInitialized = true
                label = row?.text("meal_label_id") ?? initialLabel
                unit = store.units == "us" ? "oz" : "g"
                if let row { pick(row, suggested: row.number("grams")) }
                else if let initialFood { pick(initialFood, suggested: initialAmount) }
                if autoFocus { queryFocused = true }
            }
        }
        .task(id: search) { await searchCatalog() }
        .onChange(of: catalog.loaded) { _, loaded in
            if loaded, let selected, let full = catalogItem(selected.text("id")) { self.selected = full }
        }
        .onChange(of: focusToken) { _, _ in queryFocused = true }
        .onChange(of: choices.map { $0.text("id") }) { _, _ in activeIndex = -1 }
        .onChange(of: livePreview) { _, value in onPreview(value) }
        .onChange(of: store.units) { _, units in changeUnit(units == "us" ? "oz" : "g") }
        .onDisappear { if livePreview != nil { onPreview(nil) } }
    }

    private var labelPicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel("Etiqueta")
            NutriSelect(value: label, select: { label = $0 },
                        options: [("", store.tr("Sin etiqueta"))] + labels.map { ($0.text("id"), $0.text("name")) },
                        currentLabel: store.tr("Sin etiqueta"))
            .accessibilityLabel(store.tr("Etiqueta"))
        }
    }

    @ViewBuilder
    private var frequentChips: some View {
        let list = frequent(label)
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(store.tr("Elementos frecuentes")).font(.nutriSans(14)).foregroundStyle(palette.text3)
                NutriFlow {
                    ForEach(list, id: \.self) { item in
                        Button { pick(item, suggested: item.number("grams")) } label: {
                            (Text(item.text("item")).font(.nutriSans(14)).foregroundColor(palette.text)
                             + Text(item.text("brand").isEmpty ? "" : " " + item.text("brand")).font(.nutriSans(12)).foregroundColor(palette.text3))
                                .lineLimit(1)
                        }.buttonStyle(NutriButtonStyle(.secondary, radius: 22))
                    }
                }
            }
        }
    }

    private var queryField: some View {
        VStack(alignment: .leading, spacing: 4) {
            fieldLabel("Alimento o receta")
            TextField(store.tr("Alimento o receta"), text: Binding(get: { search }, set: { value in
                search = value
                selected = nil
                suggested = nil
                remoteChoices = nil
            }), prompt: Text(store.tr("Buscar…")).foregroundColor(palette.text3))
            .nutriInput(focus: $queryFocused)
            .onKeyPress(.downArrow) { highlight(1) }
            .onKeyPress(.upArrow) { highlight(-1) }
            .onSubmit {
                if choices.indices.contains(activeIndex) { pick(choices[activeIndex], suggested: nil) }
                else if selected != nil { save() }
            }
            if !choices.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(choices.enumerated()), id: \.element) { index, choice in
                        Button {
                            pick(choice, suggested: nil)
                        } label: {
                            HStack {
                                (Text(choice.text("name")) +
                                 Text(choice.text("brand").isEmpty ? "" : "  " + choice.text("brand"))
                                    .font(.nutriSans(14)).foregroundColor(palette.text3))
                                Spacer()
                                if choice["_recipe"]?.bool == true {
                                    Text(store.tr("receta")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                                }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(activeIndex == index ? palette.surface3 : .clear)
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }.nutriCard(radius: 12, fill: palette.surface2)
            }
        }
    }

    private func highlight(_ delta: Int) -> KeyPress.Result {
        guard !choices.isEmpty else { return .ignored }
        activeIndex = min(choices.count - 1, max(0, activeIndex + delta))
        return .handled
    }

    private var newFoodButton: some View {
        Button {
            store.newFood = ["name": .string(cleanText(search)), "day": .string(day), "meal_label_id": label.isEmpty ? .null : .string(label)]
        } label: {
            Text("＋ " + store.tr("Nuevo alimento")).font(.nutriSans(14))
                .foregroundStyle(palette.accent).frame(minHeight: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    private var quantityField: some View {
        let title = unit == "ml" ? store.tr("Mililitros") : unit == "fl oz" ? "Fl oz" : unit == "oz" ? "Oz" : store.tr("Gramos")
        let portions = selected?.array("portions").compactMap(\.object) ?? []
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                fieldLabel(title)
                Spacer()
                if let density, density > 0 {
                    let options = store.units == "us" ? ["oz", "fl oz"] : ["g", "ml"]
                    HStack(spacing: 0) {
                        ForEach(options, id: \.self) { option in
                            Button { changeUnit(option) } label: {
                                Text(option).font(.nutriSans(14, weight: .medium)).padding(.horizontal, 16)
                                    .frame(height: 28)
                                    .foregroundStyle(unit == option ? palette.bg : palette.text2)
                                    .background(unit == option ? palette.accent : palette.surface2)
                            }.buttonStyle(.plain).accessibilityAddTraits(unit == option ? .isSelected : [])
                        }
                    }.nutriCard(radius: 8).clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            TextField(title, text: $amount, prompt: Text(suggested.map { journalNumber(convert($0, to: unit), digits: unit == "g" || unit == "ml" ? 1 : 2) } ?? "")
                .foregroundColor(palette.text3))
                .font(.nutriMono(16)).nutriInput().onSubmit(save)
            if unit != "g", !amount.isEmpty, let grams {
                Text(massEstimate(grams)).font(.nutriMono(12)).foregroundStyle(palette.text3)
            }
            if !portions.isEmpty {
                NutriFlow {
                    ForEach(portions, id: \.self) { portion in
                        let g = portion.number("grams") ?? 0
                        Button {
                            let entered = amount.isEmpty ? 0 : grams ?? 0
                            amount = draftNumber(convert(Domain.round(entered + g, 1), to: unit))
                        } label: {
                            Text("+ " + portion.text("name") + " (" +
                                 (store.units == "us" ? journalNumber(g / Domain.gramsPerOunce) + " oz" : journalNumber(g, digits: 3) + " g") + ")")
                                .foregroundStyle(palette.text)
                        }
                        .buttonStyle(NutriButtonStyle(.secondary, height: 36, radius: 18))
                    }
                }.padding(.top, 4)
            }
        }
    }

    private func massEstimate(_ grams: Double) -> String {
        let estimate = "≈ \(journalNumber(grams)) g"
        guard unit == "ml" || unit == "fl oz", let density else { return estimate }
        let label = store.tr("densidad")
        let value = journalNumber(density, digits: 4)
        return "\(estimate) (\(label) \(value) g/ml)"
    }

    private var buttons: some View {
        Group {
            if isAdding {
                HStack(spacing: 8) {
                    Button {
                        selected = nil
                        search = ""
                        amount = ""
                        suggested = nil
                        queryFocused = true
                    } label: { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                        .buttonStyle(NutriButtonStyle())
                    saveButton
                }
            } else {
                VStack(spacing: 16) {
                    saveButton
                    Button {
                        if let row { remove(row) }
                    } label: { Text(store.tr("Borrar")).frame(maxWidth: .infinity) }
                        .buttonStyle(NutriButtonStyle(.danger))
                        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.danger).allowsHitTesting(false) }
                }
            }
        }
    }

    private var saveButton: some View {
        Button(action: save) { Text(store.tr(isAdding ? "Registrar" : "Guardar")).frame(maxWidth: .infinity) }
            .buttonStyle(NutriButtonStyle(.primary)).disabled(grams == nil)
    }

    private var contributionPanel: some View {
        let data = livePreview ?? row ?? [:]
        let favorites = Set(store.prefs.array("fav_micros").compactMap(\.string))
        let base = Set(Domain.micros.prefix(8).map(\.key)).union(favorites)
        let visible = Domain.micros.filter { base.contains($0.key) && $0.key != "agua_ml" }
        let hidden = Domain.micros.filter { !base.contains($0.key) && $0.key != "agua_ml" }
        return VStack(alignment: .leading, spacing: 0) {
            Text(store.tr("Aporta")).font(.nutriSans(14)).foregroundStyle(palette.text3).padding(.bottom, 8)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(Domain.macroKeys, id: \.self) { key in
                    VStack(spacing: 2) {
                        let value = data.number(key) ?? 0
                        Text(journalNumber(value) + (key == "kcal" ? "" : " g")).font(.nutriMono(18))
                            .foregroundStyle(value == 0 ? palette.text3 : palette.nutrient(key))
                            .lineLimit(1).minimumScaleFactor(0.60)
                        let label = ["kcal":"Kcal","protein_g":"Prot","carbs_g":"Carbs","fat_g":"Grasa"][key] ?? key
                        Text(store.tr(label)).font(.nutriSans(12)).foregroundStyle(palette.text3)
                    }
                }
            }.padding(.bottom, 12)
            ForEach(visible) { nutrient in contribution(nutrient.label, nutrient.key, nutrient.unit, data: data) }
            if !hidden.isEmpty {
                DisclosureGroup(store.tr("Más micros (%n)").replacingOccurrences(of: "%n", with: String(hidden.count))) {
                    VStack(alignment: .leading, spacing: 0) {
                        let categories = hidden.reduce(into: [String]()) {
                            if !$0.contains($1.category) { $0.append($1.category) }
                        }
                        ForEach(categories, id: \.self) { category in
                            Text(store.tr(category).uppercased()).font(.nutriSans(12)).tracking(0.3)
                                .foregroundStyle(palette.text3).padding(.top, 12).padding(.bottom, 4)
                            ForEach(hidden.filter { $0.category == category }) { nutrient in
                                contribution(nutrient.label, nutrient.key, nutrient.unit, data: data)
                            }
                        }
                    }
                }.font(.nutriSans(14)).foregroundStyle(palette.text2).padding(.vertical, 12)
            }
        }.padding(12).nutriCard(radius: 12, fill: palette.surface2)
    }

    private func contribution(_ label: String, _ key: String, _ unit: String, data: Record) -> some View {
        let coverage = Domain.coverage(data, key)
        let value = Domain.value(data, key)
        let amount = value.map { journalNumber($0, digits: 2) + " " + unit } ?? store.tr("Sin dato")
        let partial = coverage == .partial ? " · " + store.tr("Datos parciales") : ""
        return VStack(spacing: 0) {
            Rectangle().fill(palette.border).frame(height: 1)
            HStack {
                Text(store.tr(label)).foregroundStyle(palette.text2)
                Spacer(minLength: 6)
                Text(amount + partial).font(.nutriMono(14)).foregroundStyle(coverage == .complete ? palette.text : palette.text3)
            }.font(.nutriSans(14)).padding(.vertical, 6)
        }
    }

    private func fieldLabel(_ label: String) -> some View {
        Text(store.tr(label)).font(.nutriSans(14)).foregroundStyle(palette.text2)
    }

    private func searchCatalog() async {
        let query = cleanText(search)
        guard selected == nil, !query.isEmpty, !store.offline, !store.demoActive else { return }
        do {
            try await Task.sleep(for: .milliseconds(250))
            let sanitized = query.replacingOccurrences(of: "[,()]", with: " ", options: .regularExpression)
            async let foods = store.read("foods", ["select":"id,name,brand,source", "or":"(name.ilike.%\(sanitized)%,brand.ilike.%\(sanitized)%)", "limit":"8"])
            async let recipes = store.read("recipes", ["select":"id,name", "name":"ilike.%\(sanitized)%", "limit":"8"])
            let (lexical, recipeHits) = try await (foods, recipes)
            var hits = lexical
            if query.count >= 3, hits.count < 8, !store.anonymous {
                let semantic = (try? await searchSemanticFoods(store: store, query: query)) ?? []
                var ids = Set(hits.map { $0.text("id") })
                hits += semantic.filter { ids.insert($0.text("id")).inserted }.prefix(8 - hits.count)
            }
            guard !Task.isCancelled, cleanText(search) == query, selected == nil else { return }
            remoteChoices = mergedChoices(foods: hits, recipes: recipeHits)
        } catch { }
    }

    private func catalogItem(_ id: String) -> Record? {
        if let food = catalog.foods.first(where: { $0.text("id") == id }) { return food }
        return catalog.recipes.first(where: { $0.text("id") == id }).map {
            $0.merging(["_recipe": .bool(true)]) { _, new in new }
        }
    }

    private func pick(_ item: Record, suggested: Double?) {
        let recipe = item.text("recipe_id")
        let food = item.text("food_id")
        let id = recipe.isEmpty ? food.isEmpty ? item.text("id") : food : recipe
        var value = catalogItem(id) ?? item
        value["id"] = .string(id)
        if !recipe.isEmpty { value["_recipe"] = .bool(true) }
        if value.text("name").isEmpty { value["name"] = item["item"] ?? .null }
        selected = value
        search = value.text("name")
        amount = ""
        self.suggested = suggested
        activeIndex = -1
        if catalogItem(id) == nil || !store.offline && !store.demoActive {
            let recipe = value["_recipe"]?.bool == true
            Task {
                do {
                    let full = try await store.read(recipe ? "recipes" : "foods", ["id": "eq." + id]).first
                    guard selected?.text("id") == id, let full else { return }
                    selected = recipe ? full.merging(["_recipe": .bool(true)]) { _, new in new } : full
                } catch { if catalogItem(id) == nil { store.report(error) } }
            }
        }
    }

    private func convert(_ grams: Double, to unit: String) -> Double {
        switch unit {
        case "oz": return grams / Domain.gramsPerOunce
        case "ml": return grams / (density ?? 1)
        case "fl oz": return grams / ((density ?? 1) * Domain.mlPerFluidOunce)
        default: return grams
        }
    }

    private func changeUnit(_ next: String) {
        if !amount.isEmpty, let grams { amount = draftNumber(convert(grams, to: next)) }
        unit = next
    }

    private func save() {
        guard let grams, let selected else { return }
        do {
            let id = selected.text("id")
            guard UUID(uuidString: id) != nil else { throw NutriError("Elige un alimento o una receta.") }
            guard !meta.isEmpty || (row != nil && row?.number("grams") == grams) else {
                throw NutriError("Los datos del alimento aún no están disponibles.")
            }
            let patch: Record = ["grams": .number(grams), "meal_label_id": label.isEmpty ? .null : .string(label)]
            var payload = patch
            payload["day"] = .string(day)
            payload["id"] = row?["id"] ?? .string(UUID().uuidString.lowercased())
            payload["food_id"] = isRecipe ? .null : .string(id)
            payload["recipe_id"] = isRecipe ? .string(id) : .null
            if let row, row.text("meal_label_id") == label { payload["sort_order"] = row["sort_order"] }
            let nutrients = livePreview ?? row?.filter {
                Domain.macroKeys.contains($0.key) || ["micros", "micros_complete"].contains($0.key)
            } ?? [:]
            let preview = payload.merging(nutrients) { _, new in new }.merging([
                "item": .string(selected.text("name")), "brand": selected["brand"] ?? .null,
                "created_at": row?["created_at"] ?? .string(Date.now.ISO8601Format()),
                "meal": labels.first(where: { $0.text("id") == label })?["name"] ?? .null
            ]) { _, new in new }
            if let row {
                var update = patch
                if row.text("meal_label_id") != label { update["sort_order"] = .null }
                try store.editEntry(row.text("id"), patch: update, row: preview)
            } else {
                try store.addEntry(payload, row: preview)
            }
            onSave(label)
        } catch { store.report(error) }
    }

    private func remove(_ row: Record) {
        do {
            try store.removeEntry(row.text("id"), row: row)
            store.undo(store.tr("Registro borrado")) {
                var payload = entryPayload(row)
                payload["day"] = row["day"]
                payload["id"] = .string(UUID().uuidString.lowercased())
                payload["sort_order"] = row["sort_order"] ?? .null
                try store.addEntry(payload, row: row.merging(payload) { _, new in new })
            }
            close()
        } catch { store.report(error) }
    }
}

struct MealLabelsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let close: () -> Void
    @State private var labels: [Record] = []
    @State private var name = ""
    @State private var draftNames: [String: String] = [:]
    @FocusState private var focused: String?
    @State private var busy = false

    private let query = ["archived_at": "is.null", "order": "sort_order.asc,name.asc"]

    var body: some View {
        NutriSheet(store.tr("Etiquetas"), close: close, showsFooter: false) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    TextField(store.tr("Nueva etiqueta"), text: $name).nutriInput().onSubmit(add)
                    Button(store.tr("Añadir"), action: add).buttonStyle(NutriButtonStyle(.primary, horizontal: 16))
                        .disabled(cleanText(name).isEmpty)
                }
                if labels.isEmpty {
                    Text(store.tr("Sin etiquetas aún")).foregroundStyle(palette.text2)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                }
                VStack(spacing: 8) {
                    ForEach(Array(labels.enumerated()), id: \.offset) { index, row in
                        HStack(spacing: 8) {
                            let id = row.text("id")
                            TextField(store.tr("Nombre"), text: Binding(get: { draftNames[id] ?? row.text("name") },
                                                                      set: { draftNames[id] = $0 }))
                                .textFieldStyle(.plain)
                                .focused($focused, equals: id)
                                .onSubmit { rename(row) }
                            labelIcon("arrow-up", "Subir") { run { try await move(index, -1) } }.disabled(index == 0)
                            labelIcon("arrow-down", "Bajar") { run { try await move(index, 1) } }.disabled(index + 1 == labels.count)
                            labelIcon("trash-2", "Borrar", destructive: true) { run { try await archive(row) } }
                        }
                        .padding(.leading, 12).padding(.trailing, 8).padding(.vertical, 4)
                        .nutriCard(radius: 12, fill: palette.surface2)
                    }
                }
                if store.undoTitle == store.tr("Etiqueta borrada") {
                    JournalUndoInline()
                }
            }.disabled(busy)
        } footer: { EmptyView() }
        .task { do { try await reload() } catch { store.report(error) } }
        .onChange(of: focused) { previous, _ in
            if let previous, let row = labels.first(where: { $0.text("id") == previous }) { rename(row) }
        }
    }

    private func labelIcon(_ icon: String, _ label: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { NutriIcon(icon, size: 16).frame(width: 24) }
            .buttonStyle(NutriButtonStyle(destructive ? .danger : .quiet, height: 32, horizontal: 0))
            .accessibilityLabel(store.tr(label))
    }

    private func reload() async throws {
        labels = try await store.read("meal_labels", query)
        NotificationCenter.default.post(name: .nutriLabelsChanged, object: nil)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action(); try await reload() } catch { store.report(error) }
        }
    }

    private func add() {
        run {
            let label = cleanText(name)
            guard !label.isEmpty, let owner = store.owner else { return }
            let all = try await store.read("meal_labels", ["owner": "eq." + owner])
            let order = (labels.compactMap { $0.number("sort_order") }.max() ?? 0) + 1
            if let same = all.first(where: { $0.text("name") == label }) {
                guard let flag = same["archived_at"], flag != .null else { throw NutriError("Ya existe una etiqueta con ese nombre.") }
                _ = try await store.update("meal_labels", ["id": "eq." + same.text("id")], ["archived_at": .null, "sort_order": .number(order)])
            } else {
                _ = try await store.insert("meal_labels", ["name": .string(label), "sort_order": .number(order)])
            }
            name = ""
        }
    }

    private func rename(_ row: Record) {
        let id = row.text("id")
        guard let draft = draftNames.removeValue(forKey: id), cleanText(draft) != row.text("name"), !cleanText(draft).isEmpty else { return }
        Task {
            do {
                _ = try await store.update("meal_labels", ["id": "eq." + id], ["name": .string(cleanText(draft))])
                try await reload()
            } catch { store.report(error) }
        }
    }

    private func archive(_ row: Record) async throws {
        let filter = ["id": "eq." + row.text("id")]
        let timestamp = Date.now.ISO8601Format()
        _ = try await store.update("meal_labels", filter, ["archived_at": .string(timestamp)])
        labels.removeAll { $0.text("id") == row.text("id") }
        store.undo(store.tr("Etiqueta borrada")) {
            _ = try await store.update("meal_labels", filter.merging(["archived_at": "eq." + timestamp]) { _, new in new }, ["archived_at": .null])
            try await reload()
        }
    }

    private func move(_ index: Int, _ offset: Int) async throws {
        var ordered = labels
        guard ordered.indices.contains(index + offset) else { return }
        ordered.swapAt(index, index + offset)
        for (position, label) in ordered.enumerated() where label.number("sort_order") != Double(position) {
            _ = try await store.update("meal_labels", ["id": "eq." + label.text("id")], ["sort_order": .number(Double(position))])
        }
    }
}

private struct MealTemplatesView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let day: String
    let entries: [Record]
    let close: () -> Void
    let reload: () async -> Void
    @State private var name = ""
    @State private var busy = false

    private var templates: [Record] { store.prefs.array("meal_templates").compactMap(\.object) }

    var body: some View {
        NutriSheet(store.tr("Plantillas de comida"), close: close, showsFooter: false) {
            VStack(alignment: .leading, spacing: 12) {
                if templates.isEmpty {
                    Text(store.tr("Aún no tienes plantillas. Guarda el día actual como una para reutilizarla en cualquier fecha."))
                        .font(.nutriSans(14)).foregroundStyle(palette.text2)
                }
                ForEach(templates, id: \.self) { row in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.text("name")).font(.nutriSans(14)).lineLimit(1)
                            Text(store.tr("%n alimentos").replacingOccurrences(of: "%n", with: String(row.array("items").count)))
                                .font(.nutriSans(12)).foregroundStyle(palette.text3)
                        }
                        Spacer(minLength: 4)
                        Button(store.tr("Añadir")) { run { try await apply(row) } }.buttonStyle(NutriButtonStyle(.primary, height: 40, radius: 8))
                        Button(role: .destructive) { run { try await remove(row) } } label: { NutriIcon("trash-2", size: 18) }
                            .buttonStyle(NutriButtonStyle(.quiet, height: 40, horizontal: 8)).accessibilityLabel(store.tr("Borrar"))
                    }.padding(8).nutriCard(radius: 12, fill: .clear)
                }
                Rectangle().fill(palette.border).frame(height: 1)
                TextField(store.tr("Nombre de la plantilla"), text: $name).nutriInput().onSubmit { run(save) }
                Button { run(save) } label: {
                    Text(store.tr("Guardar el día actual como plantilla")).frame(maxWidth: .infinity)
                }
                .buttonStyle(NutriButtonStyle(.primary)).disabled(entries.isEmpty || cleanText(name).isEmpty)
                if entries.isEmpty {
                    Text(store.tr("Este día no tiene alimentos que guardar.")).font(.nutriSans(12)).foregroundStyle(palette.text3)
                }
                Button(action: close) { Text(store.tr("Cerrar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle())
                if store.undoTitle == store.tr("Plantilla borrada") { JournalUndoInline() }
            }.disabled(busy)
        } footer: { EmptyView() }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { store.report(error) }
        }
    }

    private func write(_ values: [Record]) async throws {
        try await store.patchPrefs(["meal_templates": .array(values.map(JSONValue.object))])
    }

    private func save() async throws {
        guard !entries.isEmpty, !cleanText(name).isEmpty else { return }
        let template: Record = ["id": .string(UUID().uuidString.lowercased()), "name": .string(cleanText(name)),
                                "items": .array(entries.map { .object(entryPayload($0)) })]
        try await write(templates + [template])
        name = ""
        store.toast(store.tr("Plantilla guardada."))
    }

    private func remove(_ row: Record) async throws {
        let previous = templates
        let index = previous.firstIndex(of: row) ?? previous.count
        try await write(previous.filter { $0.text("id") != row.text("id") })
        store.undo(store.tr("Plantilla borrada")) {
            var current = templates.filter { $0.text("id") != row.text("id") }
            current.insert(row, at: min(index, current.count))
            try await write(current)
        }
    }

    private func apply(_ template: Record) async throws {
        async let foodRows = store.catalog()
        async let recipeRows = store.read("recipes", ["select": "id"])
        let (foods, recipes) = try await (foodRows, recipeRows)
        let foodIDs = Set(foods.map { $0.text("id") })
        let recipeIDs = Set(recipes.map { $0.text("id") })
        let items = template.array("items").compactMap(\.object)
        let valid = items.filter { foodIDs.contains($0.text("food_id")) || recipeIDs.contains($0.text("recipe_id")) }
        guard !valid.isEmpty else { throw NutriError("Los alimentos o recetas de la plantilla ya no existen.") }
        _ = try await store.insert("entries", valid.map { item in entryPayload(item).merging(["day": .string(day)]) { _, new in new } })
        let message = valid.count < items.count ? store.tr("%n añadidos · %m omitidos").replacingOccurrences(of: "%m", with: String(items.count - valid.count))
            : store.tr("%n registros copiados.")
        store.toast(message.replacingOccurrences(of: "%n", with: String(valid.count)))
        await reload()
        close()
    }
}

private struct SummarySettingsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let close: () -> Void
    @State private var saving = false

    private var activeView: String {
        let value = store.prefs.text("today_view")
        return journalViews.contains(value) ? value : "estado"
    }
    private var all: Record { store.prefs.object("today_card") }
    private var config: Record {
        ["items": .array(journalDefaultItems.map(JSONValue.string)),
         "showRanges": .bool(false), "mode": .string(activeView == "estado" ? "meta" : "delta")]
            .merging(all.object(activeView)) { _, new in new }
    }
    private var items: [String] { config.array("items").compactMap(\.string) }
    private var choices: [String] { (Domain.macroKeys + Domain.micros.map(\.key)).filter { !items.contains($0) && $0 != "agua_ml" } }

    var body: some View {
        JournalSheet(store.tr("Personalizar resumen")) {
            VStack(alignment: .leading, spacing: 12) {
                Text(store.tr("Diseño actual") + ": " + store.tr(journalViewNames[activeView] ?? "")
                     + " · " + store.tr("cámbialo con las flechas de la card"))
                    .font(.nutriSans(12)).foregroundStyle(palette.text3)
                VStack(alignment: .leading, spacing: 4) {
                    caption("Variable principal")
                    mode("delta", label: "Faltante absoluto", example: "−318 kcal")
                    mode("pct", label: "Faltante en %", example: "−18%")
                    mode("meta", label: "Metas", example: "1482/1800")
                }
                VStack(alignment: .leading, spacing: 4) {
                    caption("Nutrientes")
                    if activeView == "objetivos" {
                        Text(store.tr("El orden asigna el lugar: 1º anillo, 2º–4º barras, resto tarjetas."))
                            .font(.nutriSans(12)).foregroundStyle(palette.text3)
                    }
                    ForEach(Array(items.enumerated()), id: \.offset) { index, key in
                        if let nutrient = JournalNutrient(key, totals: [:], target: nil, hasFood: false, bands: [:]) {
                            HStack(spacing: 0) {
                                (Text(store.tr(nutrient.label)) + Text(" " + nutrient.unit)
                                    .font(.nutriSans(12)).foregroundColor(palette.text3))
                                    .font(.nutriSans(14)).lineLimit(1)
                                Spacer()
                                icon("chevron-up", "Subir") { move(index, to: index - 1) }.disabled(index == 0)
                                icon("chevron-down", "Bajar") { move(index, to: index + 1) }.disabled(index + 1 == items.count)
                                icon("x", "Quitar") { changeItems(items.filter { $0 != key }) }.disabled(items.count <= 1)
                            }
                            .draggable("summary/" + key)
                            .dropDestination(for: String.self) { values, _ in
                                guard let value = values.first, value.hasPrefix("summary/"),
                                      let j = items.firstIndex(of: String(value.dropFirst(8))) else { return false }
                                move(j, to: index)
                                return true
                            }
                        }
                    }
                    NutriSelect(value: "", select: { changeItems(items + [$0]) }, groups: nutrientGroups,
                                currentLabel: store.tr("Añadir nutriente…"))
                        .disabled(choices.isEmpty)
                }
                Rectangle().fill(palette.border).frame(height: 1)
                VStack(spacing: 0) {
                    toggle("Mostrar rangos", checked: config["showRanges"]?.bool == true) {
                        patch(["showRanges": .bool(config["showRanges"]?.bool != true)])
                    }
                    toggle("Aplicar a los 3 diseños", checked: all["sync"]?.bool == true) {
                        var values = all
                        let enabled = all["sync"]?.bool != true
                        values["sync"] = .bool(enabled)
                        if enabled {
                            for key in journalViews { values[key] = .object(config) }
                        }
                        save(values)
                    }
                }
            }.disabled(saving)
        }
    }

    private var nutrientGroups: [NutriSelectGroup] {
        let macros = Domain.macroKeys.filter { choices.contains($0) }
        let micros = Domain.micros.filter { choices.contains($0.key) }
        let categories = micros.reduce(into: [String]()) { if !$0.contains($1.category) { $0.append($1.category) } }
        let general = NutriSelectGroup(label: store.tr("Básicos"), options: macros.map { key in
            (key, store.tr(JournalNutrient(key, totals: [:], target: nil, hasFood: false, bands: [:])?.label ?? key))
        })
        return (macros.isEmpty ? [] : [general]) + categories.map { category in
            NutriSelectGroup(label: store.tr(category),
                             options: micros.filter { $0.category == category }.map { ($0.key, store.tr($0.label)) })
        }
    }

    private func caption(_ key: String) -> some View {
        Text(store.tr(key).uppercased()).font(.nutriSans(12)).tracking(0.3).foregroundStyle(palette.text3)
    }

    private func mode(_ id: String, label: String, example: String) -> some View {
        let active = config.text("mode") == id
        return Button { patch(["mode": .string(id)]) } label: {
            HStack {
                Text(store.tr(label)).foregroundStyle(active ? palette.text : palette.text2)
                Spacer()
                Text(example).font(.nutriMono(12)).foregroundStyle(palette.text3)
            }
            .font(.nutriSans(14)).padding(.horizontal, 12).frame(height: 44)
            .background(active ? palette.surface2 : Color.clear, in: RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(active ? palette.accent : palette.border) }
            .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityAddTraits(active ? .isSelected : [])
    }

    private func icon(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { NutriIcon(symbol, size: 16).frame(width: 44) }
            .buttonStyle(NutriButtonStyle(.quiet, height: 44, horizontal: 0))
            .accessibilityLabel(store.tr(label))
    }

    private func toggle(_ label: String, checked: Bool, action: @escaping () -> Void) -> some View {
        Toggle(isOn: Binding(get: { checked }, set: { _ in action() })) { Text(store.tr(label)).font(.nutriSans(14)).foregroundStyle(palette.text2) }
            .toggleStyle(.switch).tint(palette.accentDeep).frame(minHeight: 44)
    }

    private func move(_ from: Int, to: Int) {
        guard items.indices.contains(from), items.indices.contains(to), from != to else { return }
        var ordered = items
        let item = ordered.remove(at: from)
        ordered.insert(item, at: to)
        changeItems(ordered)
    }

    private func changeItems(_ values: [String]) { patch(["items": .array(values.map(JSONValue.string))]) }

    private func patch(_ values: Record) {
        var all = all
        let next = config.merging(values) { _, new in new }
        for key in all["sync"]?.bool == true ? journalViews : [activeView] { all[key] = .object(next) }
        save(all)
    }

    private func save(_ next: Record) {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do { try await store.patchPrefs(["today_card": .object(next)]) }
            catch { store.report(error) }
        }
    }
}

private let journalViews = ["estado", "objetivos", "mini"]
private let journalViewNames = ["estado": "Estado actual", "objetivos": "Objetivos", "mini": "Mini"]
private let journalDefaultItems = ["kcal", "protein_g", "carbs_g", "fat_g", "sodio_mg", "potasio_mg"]

extension Notification.Name {
    static let nutriLabelsChanged = Notification.Name("nutri.labelsChanged")
}

private struct SummaryBottomKey: PreferenceKey {
    static let defaultValue: CGFloat = 1
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private func journalNumber(_ value: Double, digits: Int = 1) -> String {
    let factor = pow(10, Double(digits))
    let rounded = floor(value * factor + 0.5) / factor
    return rounded.formatted(.number.grouping(.never).precision(.fractionLength(0...digits)).locale(Locale(identifier: "en_US_POSIX")))
}

private func journalDragKey(_ type: String, id: String, day: String, owner: String?) -> String {
    "nutri/\(owner ?? "")/\(day)/\(type)/\(id)"
}

private struct SectionDraggable: ViewModifier {
    let id: String
    let day: String
    let owner: String?
    let enabled: Bool

    func body(content: Content) -> some View {
        if id.isEmpty || !enabled { content }
        else { content.draggable(journalDragKey("section", id: id, day: day, owner: owner)) }
    }
}

private struct JournalNutrient: Identifiable {
    let id: String
    let label: String
    let unit: String
    let decimals: Int
    let short: String
    let value: Double?
    let target: Double?
    let bounds: (min: Double?, max: Double?)
    let explicit: Record
    let implied: (min: Double?, max: Double?)
    let status: Domain.Adherence?
    let coverage: Domain.Coverage
    let coupled: Bool
    let hasFood: Bool
    let hasTarget: Bool

    init?(_ key: String, totals: Record, target row: Record?, hasFood: Bool, bands: Record) {
        let macro = Domain.macroKeys.contains(key)
        let micro = Domain.micros.first { $0.key == key }
        guard macro || micro != nil else { return nil }
        id = key
        label = ["kcal": "Kcal", "protein_g": "Prot", "carbs_g": "Carbs", "fat_g": "Grasa"][key] ?? micro?.label ?? key
        unit = micro?.unit ?? (key == "kcal" ? "kcal" : "g")
        decimals = unit == "g" ? 1 : 0
        short = ["kcal":"kcal", "protein_g":"P", "carbs_g":"C", "fat_g":"G", "sodio_mg":"Na", "potasio_mg":"K",
                 "magnesio_mg":"Mg", "calcio_mg":"Ca", "hierro_mg":"Fe", "zinc_mg":"Zn"][key] ?? label
        coverage = macro ? .complete : Domain.coverage(totals, key)
        value = coverage == .unknown ? nil : (Domain.value(totals, key) ?? 0)
        let point = row.flatMap { Domain.value($0, key) }
        target = point.flatMap { $0 > 0 ? $0 : nil }
        explicit = row?.object("bounds").object(key) ?? [:]
        implied = Domain.impliedBounds(key, target: row, bands: bands)
        bounds = Domain.bounds(key, target: row, bands: bands)
        coupled = (key == "carbs_g" || key == "fat_g") && row?.object("rules").object("transition").text("kind") == "coupled_band"
        self.hasFood = hasFood
        hasTarget = row != nil
        if let value, !coupled, coverage == .complete { status = Domain.classify(key, value: value, target: row, hasFood: hasFood, bands: bands) }
        else { status = key == "sodio_mg" && hasFood && value.map { $0 < Domain.sodiumFloor } == true ? .danger : nil }
    }

    var hasExplicit: Bool { explicit.number("min") != nil || explicit.number("max") != nil }
    var lowSodium: Bool { id == "sodio_mg" && hasFood && value.map { $0 < Domain.sodiumFloor } == true }
    var highSodium: Bool { id == "sodio_mg" && hasFood && value.map { $0 > (bounds.max ?? Domain.sodiumCeiling) } == true }
    var met: Bool { coverage == .complete && hasFood && !coupled && status == .ok }

    var goalBounds: (min: Double?, max: Double?) {
        guard hasTarget else { return (nil, nil) }
        return coupled ? (explicit.number("min"), explicit.number("max")) : hasExplicit ? bounds : implied
    }

    var scaleEnd: Double? {
        guard coverage == .complete, hasTarget else { return nil }
        return goalBounds.max ?? (coupled ? nil : target) ?? goalBounds.min
    }

    var deviation: (delta: Double, base: Double)? {
        guard !coupled, let value, coverage == .complete || id == "sodio_mg" else { return nil }
        let limit: Double?
        if hasExplicit || id == "sodio_mg" {
            if let min = bounds.min, value < min { limit = min }
            else if let max = bounds.max, value > max { limit = max }
            else { limit = nil }
        } else { limit = target }
        guard let limit, limit > 0 else { return nil }
        return (value - limit, limit)
    }

    var pending: Bool {
        guard hasFood, !coupled, let status, status != .ok, let deviation else { return false }
        return abs(floor(deviation.delta + 0.5)) >= 1
    }

    var statusLabel: String? {
        guard hasFood else { return nil }
        if coverage == .unknown { return "Sin dato" }
        if coverage == .partial { return "Datos parciales" }
        if coupled { return "Según energía" }
        if met { return "En rango" }
        if let delta = deviation?.delta { return delta < 0 ? "Por debajo" : "Por encima" }
        return nil
    }

    @MainActor func amount(_ store: Store) -> String {
        value.map { journalNumber($0, digits: decimals) } ?? store.tr("Sin dato")
    }

    func color(_ p: NutriPalette) -> Color {
        if coverage != .complete { return status == .danger ? p.danger : p.text3 }
        if ["sodio_mg","potasio_mg"].contains(id), let value, let min = bounds.min, value < min { return p.text3 }
        if let status {
            switch status {
            case .ok: return p.ok
            case .warn: return p.warn
            case .danger: return p.danger
            }
        }
        return p.nutrient(id, fallback: id == "sodio_mg" ? p.text : p.warn)
    }

    func goalTone(forceDanger: Bool = true) -> JournalGoalTone {
        if forceDanger && status == .danger { return .danger }
        let b = goalBounds
        guard hasTarget && hasFood && coverage == .complete, let value, b.min != nil || b.max != nil else { return .neutral }
        if let max = b.max, value > max { return .danger }
        let min = b.min ?? 0
        if value < min { return .neutral }
        guard let ceiling = b.max, ceiling > min else { return .ok }
        let position = (value - min) / (ceiling - min)
        if position <= 0.5 { return .ok }
        if position <= 0.72 { return .towardNear((position - 0.5) / 0.22) }
        if position <= 0.9 { return .towardWarn((position - 0.72) / 0.18) }
        return .warn
    }

    func goalColor(_ p: NutriPalette, scheme: ColorScheme, forceDanger: Bool = true) -> Color {
        switch goalTone(forceDanger: forceDanger) {
        case .neutral: p.text3
        case .ok: p.ok
        case .towardNear(let mix): p.goalGradient(scheme: scheme, fromNear: false, fraction: mix)
        case .towardWarn(let mix): p.goalGradient(scheme: scheme, fromNear: true, fraction: mix)
        case .warn: p.warn
        case .danger: p.danger
        }
    }

}

private struct JournalSummary: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    @Environment(\.colorScheme) private var scheme
    let mode: String
    let totals: Record
    let target: Record?
    let hasFood: Bool
    @Binding var energy: String
    let desktop: Bool
    var fixed = false
    var live = false
    let customize: () -> Void
    let cycle: () -> Void

    private var config: Record { store.prefs.object("today_card").object(mode) }
    private var keys: [String] { config["items"]?.array?.compactMap(\.string) ?? journalDefaultItems }
    private var details: String { config["mode"]?.string ?? (mode == "estado" ? "meta" : "delta") }
    private var ranges: Bool { config["showRanges"]?.bool ?? false }
    private var nutrients: [JournalNutrient] { keys.compactMap(state) }

    var body: some View {
        if live { liveStrip }
        else if fixed { miniGrid.padding(.horizontal, 16).padding(.vertical, 8) }
        else {
            VStack(alignment: .leading, spacing: 12) {
                summaryHeader
                if mode == "objetivos" { objectives }
                else if mode == "mini" { miniGrid }
                else { stateGrid }
                if hasFood && nutrients.contains(where: { $0.coverage != .complete }) {
                    Text(store.tr("Faltan valores de nutrientes en uno o más registros, incluso agua simple; deja vacío lo desconocido, no captures 0."))
                        .font(.nutriSans(12)).foregroundStyle(palette.warn)
                }
                bandGuide
            }.padding(desktop ? 20 : 16).nutriCard()
        }
    }

    private func state(_ key: String) -> JournalNutrient? {
        JournalNutrient(key, totals: totals, target: target, hasFood: hasFood, bands: store.prefs.object("adherence_bands"))
    }

    private var summaryHeader: some View {
        HStack(spacing: 0) {
            Text(store.tr(journalViewNames[mode] ?? "Estado actual").uppercased())
                .font(.nutriSans(10)).tracking(0.25).foregroundStyle(palette.text3)
            Spacer()
            Button(action: customize) { NutriIcon("settings", size: 16).frame(width: 44, height: 24) }
                .buttonStyle(.plain).accessibilityLabel(store.tr("Personalizar resumen"))
            Button(action: cycle) { NutriIcon("arrow-left-right", size: 16).frame(width: 34, height: 24) }
                .buttonStyle(.plain).accessibilityLabel(store.tr("Ver") + " " + store.tr(journalViewNames[journalViews[(journalViews.firstIndex(of: mode)! + 1) % 3]]!))
        }
        .foregroundStyle(palette.text3)
    }

    private var stateGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 3), spacing: 8) {
            ForEach(nutrients) { s in
                VStack(spacing: 2) {
                    Text(s.amount(store)).font(.nutriMono(18)).foregroundStyle(s.color(palette)).lineLimit(1).minimumScaleFactor(0.7)
                        .frame(minHeight: 28)
                    Text(store.tr(s.label) + (s.id == "kcal" ? "" : " · " + s.unit))
                        .font(.nutriSans(12)).foregroundStyle(palette.text3).frame(minHeight: 16)
                    nutrientDetail(s, showRanges: ranges)
                }.multilineTextAlignment(.center).lineSpacing(2)
            }
        }
    }

    private var objectives: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let hero = nutrients.first { heroRing(hero) }
            if nutrients.count > 1 {
                rule
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(nutrients.dropFirst().prefix(3))) { s in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(store.tr(s.label)).font(.nutriSans(14)).foregroundStyle(palette.text3)
                                Spacer()
                                Text(s.amount(store) + " " + s.unit).font(.nutriMono(14))
                                    .foregroundStyle(s.goalColor(palette, scheme: scheme))
                            }
                            nutrientDetail(s, showRanges: false, hideCoupled: true)
                            rail(s, compact: false)
                        }
                    }
                }
            }
            if nutrients.count > 4 {
                rule
                let tiles = Array(nutrients.dropFirst(4))
                VStack(spacing: 8) {
                    ForEach(Array(stride(from: 0, to: tiles.count, by: 2)), id: \.self) { index in
                        JournalTileRow {
                            ForEach(Array(tiles[index..<min(index + 2, tiles.count)])) { s in
                                nutrientTile(s)
                            }
                        }
                    }
                }
            }
        }
    }

    private func nutrientTile(_ s: JournalNutrient) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(store.tr(s.label).uppercased()).font(.nutriSans(10)).tracking(0.25).foregroundStyle(palette.text3)
            (Text(s.amount(store)).font(.nutriMono(18)) + Text(" " + s.unit).font(.nutriMono(12)))
                .foregroundStyle(s.goalColor(palette, scheme: scheme)).lineLimit(1).minimumScaleFactor(0.75)
            nutrientDetail(s, showRanges: ranges, hideCoupled: true)
            rail(s, compact: true)
        }
        .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12, style: .circular))
    }

    private var rule: some View { Rectangle().fill(palette.border).frame(height: 1) }

    private var miniGrid: some View {
        let states = nutrients
        let extraSodium = !keys.contains("sodio_mg") ? state("sodio_mg").flatMap { $0.pending ? $0 : nil } : nil
        let pending = states.filter(\.pending) + (extraSodium.map { [$0] } ?? [])
        let present = hasFood && target != nil
        let orderedPending = pending.filter { $0.id == "sodio_mg" } + pending.filter { $0.id != "sodio_mg" }
        let visible = fixed ? (pending.isEmpty ? present ? states : [] : orderedPending)
            : ranges || details == "meta" ? states + (extraSodium.map { [$0] } ?? [])
            : !pending.isEmpty ? pending : present ? states : []
        return Group {
            if visible.isEmpty {
                let label = !hasFood ? "Sin registros" : target == nil ? "Sin objetivos" :
                    target?.object("rules").object("transition").text("kind") == "coupled_band" ? "C/G según energía" : ""
                if !label.isEmpty { Text(store.tr(label)).font(.nutriSans(14)).foregroundStyle(palette.text2) }
            } else {
                NutriFlow(spacing: 16, lineSpacing: fixed ? 4 : 8) {
                    ForEach(fixed ? Array(visible.prefix(3)) : visible) { s in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text(s.amount(store)).font(.nutriMono(fixed ? 12 : 14)).foregroundStyle(s.color(palette))
                                Text(store.tr(s.short) + (fixed ? (s.coupled ? " · " + store.tr("Según energía") : "") : " " + s.unit))
                                    .font(.nutriSans(fixed ? 12 : 11)).foregroundStyle(fixed ? palette.text2 : palette.text3)
                            }
                            if !fixed { nutrientDetail(s, showRanges: ranges) }
                        }
                    }
                    if fixed && visible.count > 3 {
                        Text("+\(visible.count - 3) · " + store.tr("Ver resumen")).font(.nutriSans(12)).foregroundStyle(palette.text2)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func nutrientDetail(_ s: JournalNutrient, showRanges: Bool, hideCoupled: Bool = false) -> some View {
        if hasFood, s.coverage != .complete {
            Text(store.tr(s.coverage == .unknown ? "Sin dato" : "Datos parciales") +
                 (s.lowSodium ? " · " + store.tr("Sodio observado bajo el piso; faltan datos.") : ""))
                .font(.nutriSans(12)).foregroundStyle(palette.warn)
        }
        if s.coupled && hasFood && !hideCoupled {
            Text(store.tr("Según energía")).font(.nutriSans(12)).foregroundStyle(palette.text2)
        }
        let difference = !s.met && hasFood && details != "meta" ? s.deviation : nil
        if let difference {
            let magnitude = details == "pct" ? journalNumber(abs(floor(difference.delta / difference.base * 100 + 0.5)), digits: 0) + "%"
                : journalNumber(abs(difference.delta), digits: s.decimals) + " " + s.unit
            Text((difference.delta < 0 ? "−" : "+") + magnitude + (s.lowSodium ? " " + store.tr("al piso") : s.highSodium ? " " + store.tr("sobre el techo") : ""))
                .font(.nutriMono(12)).foregroundStyle(palette.text2)
        } else if s.coverage == .complete, !s.met, !s.lowSodium, !s.coupled, let target = s.target, !s.hasExplicit {
            Text(store.tr("meta") + " " + journalNumber(target, digits: s.decimals) + " " + s.unit)
                .font(.nutriSans(12)).foregroundStyle(palette.text2)
        }
        if showRanges && s.hasExplicit {
            Text(rangeText(s.explicit.number("min"), s.explicit.number("max"), digits: s.decimals) +
                 " " + s.unit + (s.coupled && !hideCoupled ? " · " + store.tr("según energía") : ""))
                .font(.nutriSans(12)).foregroundStyle(palette.text3)
        }
    }

    private func boundProgress(_ value: Double?, _ end: Double) -> CGFloat {
        min(1, max(0, (value ?? 0) / end))
    }

    @ViewBuilder
    private func rail(_ s: JournalNutrient, compact: Bool) -> some View {
        if let end = s.scaleEnd, end > 0 {
            let floorMark = s.goalBounds.min.flatMap { $0 < end ? boundProgress($0, end) : nil }
            let t = s.coupled ? nil : s.target
            let targetMark = t.flatMap { $0 < end ? boundProgress($0, end) : nil }
            let current = boundProgress(s.value, end)
            let tone = s.goalColor(palette, scheme: scheme, forceDanger: false)
            VStack(alignment: .leading, spacing: 4) {
                GeometryReader { geometry in
                    let w = geometry.size.width
                    Capsule().fill(tone.opacity(0.16))
                    Capsule().fill(tone).frame(width: w * current)
                    if current < 1 { Circle().fill(tone).frame(width: 12, height: 12).position(x: w * current, y: 4) }
                    if let floorMark {
                        Capsule().fill(tone.opacity(0.55)).frame(width: w * (1 - floorMark), height: 2)
                            .offset(x: w * floorMark, y: -6)
                        if targetMark == nil || t != s.goalBounds.min {
                            Capsule().fill(palette.text).frame(width: 2, height: 6).position(x: w * floorMark, y: -5)
                        }
                    }
                    if let targetMark {
                        Rectangle().fill(palette.surface).overlay { Rectangle().strokeBorder(tone) }
                            .frame(width: 6, height: 6).rotationEffect(.degrees(45)).position(x: w * targetMark, y: -5)
                    }
                }
                .frame(height: 8)
                .padding(.top, floorMark == nil && targetMark == nil ? 6 : compact ? 18 : 15)
                if ranges && !compact {
                    HStack {
                        if let min = s.goalBounds.min { Text(store.tr("Mín.") + " " + journalNumber(min, digits: s.decimals) + " " + s.unit) }
                        Spacer(minLength: 4)
                        if let max = s.goalBounds.max { Text(journalNumber(max, digits: s.decimals) + " " + s.unit) }
                    }.font(.nutriMono(10)).foregroundStyle(palette.text3)
                }
            }.accessibilityElement(children: .combine)
        }
    }

    private func heroRing(_ s: JournalNutrient) -> some View {
        let tone = s.goalColor(palette, scheme: scheme)
        let end = s.scaleEnd
        let progress = end.flatMap { $0 > 0 ? boundProgress(s.value, $0) : nil }
        let bound = s.goalBounds
        let start = end.flatMap { e in bound.min.flatMap { $0 < e ? boundProgress($0, e) : nil } }
        let point = end.flatMap { e in s.target.flatMap { !s.coupled && $0 < e ? boundProgress($0, e) : nil } }
        return HStack(spacing: 16) {
            ZStack {
                Canvas { context, _ in
                    let center = CGPoint(x: 52, y: 52)
                    let outer: CGFloat = 45.07
                    let inner: CGFloat = 35.53
                    func at(_ fraction: CGFloat, radius: CGFloat) -> CGPoint {
                        CGPoint(x: 52 + radius * sin(2 * .pi * fraction), y: 52 - radius * cos(2 * .pi * fraction))
                    }
                    func ring(_ from: CGFloat, _ to: CGFloat, radius: CGFloat, width: CGFloat, color: Color, round: Bool) {
                        if to >= 1 && from == 0 {
                            context.stroke(Path(ellipseIn: CGRect(x: 52-radius,y: 52-radius,width:radius*2,height:radius*2)),
                                           with: .color(color), lineWidth: width)
                        } else if to > from {
                            var arc = Path()
                            arc.addArc(center: center, radius: radius,
                                       startAngle: .degrees(360 * from - 90), endAngle: .degrees(360 * to - 90),
                                       clockwise: false)
                            context.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: round ? .round : .butt))
                        }
                    }
                    ring(0, 1, radius: outer, width: 9.53, color: palette.surface2, round: false)
                    if let progress {
                        ring(0, progress, radius: outer, width: 9.53, color: tone, round: true)
                        if progress < 1 {
                            let p = at(progress, radius: outer)
                            context.fill(Path(ellipseIn: CGRect(x: p.x-5.2, y: p.y-5.2, width: 10.4, height: 10.4)), with: .color(tone))
                        }
                    }
                    if let start {
                        if bound.max != nil { ring(start, 1, radius: inner, width: 4.77, color: tone.opacity(0.9), round: false) }
                        if point != start {
                            var line = Path()
                            line.move(to: at(start, radius: 51.13))
                            line.addLine(to: at(start, radius: 35.1))
                            context.stroke(line, with: .color(palette.text), style: StrokeStyle(lineWidth: 1.73, lineCap: .round))
                        }
                    }
                    if let point {
                        let p = at(point, radius: bound.max != nil && bound.min != nil ? inner : outer)
                        let diamond = Path { path in
                            path.move(to: CGPoint(x: p.x, y: p.y - 3.7))
                            path.addLines([CGPoint(x: p.x + 3.7, y: p.y), CGPoint(x: p.x, y: p.y + 3.7), CGPoint(x: p.x-3.7, y: p.y)])
                            path.closeSubpath()
                        }
                        context.fill(diamond, with: .color(palette.surface))
                        context.stroke(diamond, with: .color(tone), lineWidth: 1.3)
                    }
                }.accessibilityHidden(true)
                VStack(spacing: 2) {
                    Text(s.amount(store)).font(.nutriMono(24)).lineLimit(1).minimumScaleFactor(0.5)
                    Text(s.unit).font(.nutriSans(10)).foregroundStyle(palette.text3)
                }.padding(.horizontal, 15)
            }
            .frame(width: 104, height: 104)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.tr(s.label)).font(.nutriSans(12)).foregroundStyle(palette.text3)
                nutrientDetail(s, showRanges: ranges, hideCoupled: true)
                if let label = s.statusLabel, !s.coupled, s.status != nil {
                    Text(store.tr(label)).font(.nutriSans(10)).foregroundStyle(palette.text2)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(tone.opacity(0.15), in: Capsule())
                }
                if s.target == nil, !s.hasExplicit {
                    Text(store.tr("sin meta de") + " " + store.tr(s.label).lowercased()).font(.nutriSans(12)).foregroundStyle(palette.text3)
                }
            }
        }
    }

    private var liveStrip: some View {
        let sodium = state("sodio_mg")
        let critical = sodium.flatMap { $0.lowSodium && !keys.contains("sodio_mg") ? [$0] : nil } ?? []
        let items = nutrients + critical
        let states = items.filter { $0.coupled || $0.bounds.min != nil || $0.bounds.max != nil }
        return VStack(alignment: .leading, spacing: 8) {
            Text((store.tr("Hoy") + " · " + store.tr("Diferencia en vivo")).uppercased())
                .font(.nutriSans(11)).tracking(0.25).foregroundStyle(palette.text3)
            if !hasFood || target == nil || states.isEmpty {
                Text(store.tr(hasFood ? "Sin objetivos" : "Sin registros")).font(.nutriSans(14)).foregroundStyle(palette.text2)
            } else {
                LazyVGrid(columns: [.init(.flexible(), spacing: 0), .init(.flexible(), spacing: 0)], spacing: 0) {
                    ForEach(Array(states.enumerated()), id: \.element.id) { index, s in
                        VStack(alignment: .leading, spacing: 4) {
                            let label = ["kcal":"Energía","protein_g":"Proteína","carbs_g":"Carbohidratos","fat_g":"Grasa"][s.id] ?? s.label
                            Text(store.tr(label)).font(.nutriSans(12)).foregroundStyle(palette.text3)
                            Text(liveValue(s)).font(s.coupled ? .nutriSans(14) : .nutriMono(18))
                                .foregroundStyle(s.color(palette)).lineLimit(1).minimumScaleFactor(0.65)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 10).padding(.horizontal, 12)
                        .overlay(alignment: .leading) { if index % 2 == 1 { Rectangle().fill(palette.border).frame(width: 1) } }
                        .overlay(alignment: .top) { if index > 1 { rule } }
                    }
                }.padding(.vertical, 4).background(palette.surface2, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func liveValue(_ s: JournalNutrient) -> String {
        if s.coupled { return store.tr("Según energía") }
        guard let value = s.value, s.coverage == .complete else { return store.tr(s.coverage == .unknown ? "Sin dato" : "Datos parciales") }
        let delta = s.bounds.min.flatMap { value < $0 ? value - $0 : nil }
            ?? s.bounds.max.flatMap { value > $0 ? value - $0 : nil } ?? 0
        return (delta > 0 ? "+" : "") + journalNumber(delta, digits: s.decimals) + " " + s.unit
    }

    @ViewBuilder
    private var bandGuide: some View {
        if let target, target.object("rules").object("transition").text("kind") == "coupled_band",
           let min = target.object("bounds").object("kcal").number("min"), let max = target.object("bounds").object("kcal").number("max") {
            rule
            DisclosureGroup(store.tr("Ver relación")) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(store.tr("Carbohidratos y grasa cambian juntos con la energía que elijas."))
                    let range = journalNumber(min, digits: 0) + "–" + journalNumber(max, digits: 0)
                    Text(store.tr("Consulta macros para tu energía elegida") + " (" + range + " kcal)")
                    TextField(store.tr("Consulta macros para tu energía elegida"), text: $energy, prompt: Text(range))
                        .font(.nutriMono(14)).nutriInput()
                    if let n = decimal(energy), let result = Domain.coupledBand(target, energy: n) {
                        let protein = numberText(result.number("protein_g"), digits: 1)
                        let carbs = numberText(result.number("carbs_g"), digits: 1)
                        let fat = numberText(result.number("fat_g"), digits: 1)
                        Text(verbatim: "P \(protein) g · C \(carbs) g · G \(fat) g")
                    } else if !energy.isEmpty { Text(store.tr("Elige una energía dentro de la banda.")) }
                    Text(store.tr("Consulta orientativa; no registra ingesta ni cambia tu plan.")).foregroundStyle(palette.text3)
                }.padding(.top, 8)
            }.font(.nutriSans(12)).foregroundStyle(palette.text2).padding(.vertical, 4)
        }
    }

    private func rangeText(_ min: Double?, _ max: Double?, digits: Int) -> String {
        if let min, let max { return journalNumber(min, digits: digits) + "–" + journalNumber(max, digits: digits) }
        if let min { return store.tr("Mín.") + " " + journalNumber(min, digits: digits) }
        if let max { return store.tr("Máx.") + " " + journalNumber(max, digits: digits) }
        return ""
    }
}

private struct WaterGlass: View {
    @Environment(\.nutriPalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let fraction: Double
    let full: Bool
    let next: Bool
    let animating: Bool
    @State private var waveStart: Date?

    var body: some View {
        NutriIcon("glass-water", size: 22)
            .foregroundStyle(full ? palette.carbs : palette.text3)
            .frame(width: 44, height: 44)
            .background(alignment: .bottom) {
                LinearGradient(colors: [palette.carbs.opacity(0.2), palette.carbs.opacity(0.4)], startPoint: .top, endPoint: .bottom)
                    .overlay(alignment: .top) {
                        if let start = waveStart {
                            TimelineView(.animation(minimumInterval: 1.0 / 60)) { context in
                                let seconds = min(0.5, max(0, context.date.timeIntervalSince(start)))
                                RoundedRectangle(cornerRadius: 37)
                                    .fill(palette.carbs.opacity(0.28))
                                    .frame(width: 88, height: 88)
                                    .rotationEffect(.degrees(1440 * seconds))
                                    .opacity(min(1, (0.5 - seconds) / 0.15))
                                    .position(x: 22, y: 36)
                            }
                        }
                    }
                    .overlay {
                        LinearGradient(colors: [.white.opacity(0.2), .clear], startPoint: .leading, endPoint: .center)
                    }
                    .frame(height: max(0, 44 * 0.68 * fraction))
                    .animation(reduceMotion || !animating ? nil : .timingCurve(0.2, 0.7, 0.3, 1, duration: 0.5), value: fraction)
            }
            .background(full ? palette.surface2 : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.border) }
            .overlay(alignment: .topTrailing) {
                if next { NutriIcon("plus", size: 11).foregroundStyle(palette.text2).padding(4) }
            }
            .contentShape(RoundedRectangle(cornerRadius: 12))
            .task(id: fraction) {
                guard !reduceMotion, animating else { waveStart = nil; return }
                waveStart = .now
                do {
                    try await Task.sleep(for: .milliseconds(500))
                    waveStart = nil
                } catch { }
            }
    }
}

private struct WaterSettingsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let close: () -> Void
    @State private var amount = ""
    @State private var saving = false

    var body: some View {
        JournalSheet(store.tr("Ajustes de agua")) {
            VStack(alignment: .leading, spacing: 16) {
                let label = store.tr(store.units == "us" ? "Tamaño de vaso (fl oz)" : "Tamaño de vaso (ml)")
                VStack(alignment: .leading, spacing: 4) {
                    Text(label).font(.nutriSans(14)).foregroundStyle(palette.text2)
                    TextField(label, text: $amount, prompt: Text("")).font(.nutriMono(16)).nutriInput()
                }
                Button(action: save) { Text(store.tr("Guardar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.primary)).disabled(saving || decimal(amount).map { $0 < 1 } != false)
            }.onSubmit(save)
        }
            .task {
                let ml = store.prefs.number("water_glass_ml") ?? 1000
                amount = journalNumber(store.units == "us" ? ml / Domain.mlPerFluidOunce : ml)
            }
    }

    private func save() {
        guard !saving, let number = decimal(amount), number >= 1 else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.patchPrefs(["water_glass_ml": .number(number * (store.units == "us" ? Domain.mlPerFluidOunce : 1))])
                close()
            } catch { store.report(error) }
        }
    }
}

private struct EntryImportView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let labels: [Record]
    let close: () -> Void
    let reload: () async -> Void
    @State private var text = ""
    @State private var catalog: [Record] = []
    @State private var loading = true
    @State private var targeted = false
    @State private var saving = false
    @State private var error = ""

    private struct Preview {
        let display: String
        let warnings: [String]
        let payload: Record?
    }

    private var preview: [Preview] {
        guard let rows = try? CSV.parse(text) else { return [] }
        let indexed = catalog.map { (CSV.normalize($0.text("name")), $0) }
        return rows.map { row in
            let name = row["food"].flatMap { $0.isEmpty ? nil : $0 } ?? row["name"] ?? ""
            let nameKey = CSV.normalize(name)
            let food = nameKey.isEmpty ? nil : indexed.first(where: { $0.0 == nameKey })?.1
                ?? unique(indexed.filter { $0.0.hasPrefix(nameKey) || nameKey.hasPrefix($0.0) })
                ?? unique(indexed.filter { $0.0.contains(nameKey) || nameKey.contains($0.0) })
            let rawLabel = row["meal"].flatMap { $0.isEmpty ? nil : $0 } ?? row["group"] ?? ""
            let label = labels.first { CSV.normalize($0.text("name")) == CSV.normalize(rawLabel) }
            let rawDay = row["day"].flatMap { $0.isEmpty ? nil : $0 } ?? row["date"] ?? ""
            let day = Day.date(rawDay) == nil ? nil : rawDay
            let grams = decimal(row["grams"].flatMap { $0.isEmpty ? nil : $0 } ?? row["amount"] ?? "") ?? 0
            var warnings: [String] = []
            if food == nil { warnings.append("sin alimento") }
            if grams <= 0 { warnings.append("gramos") }
            if day == nil { warnings.append("fecha") }
            let display = [rawDay, label?.text("name") ?? rawLabel, name].map { $0.isEmpty ? "—" : $0 }
                .joined(separator: " · ") + " · " + journalNumber(grams) + " g"
            let payload: Record?
            if let day, let id = food?["id"], grams > 0 {
                payload = ["day": .string(day), "grams": .number(grams), "food_id": id, "meal_label_id": label?["id"] ?? .null]
            } else { payload = nil }
            return Preview(display: display, warnings: warnings, payload: payload)
        }
    }

    var body: some View {
        let rows = preview
        let importable = rows.compactMap(\.payload)
        let warnings = rows.filter { !$0.warnings.isEmpty }.count
        NutriSheet(store.tr("Importar registros"), close: close, showsFooter: false) {
            VStack(alignment: .leading, spacing: 12) {
                Text(store.tr("Pega o sube un CSV: una fila por registro. Columnas: day (AAAA-MM-DD), meal, food, grams. El alimento se empareja por nombre con tu catálogo."))
                    .font(.nutriSans(14)).foregroundStyle(palette.text2)
                Button {
                    if let file = openFiles([.commaSeparatedText, .plainText]).first { read(file) }
                } label: {
                    HStack(spacing: 6) { NutriIcon("upload", size: 15); Text(store.tr("Subir archivo")) }
                }.buttonStyle(NutriButtonStyle(.secondary, height: 36))
                ZStack(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(targeted ? store.tr("Suelta el CSV aquí") : "day,meal,food,grams\n2026-07-07,Desayuno,Avena,60")
                            .foregroundStyle(palette.text3).padding(12).allowsHitTesting(false)
                    }
                    TextEditor(text: $text).scrollContentBackground(.hidden)
                        .padding(7)
                        .accessibilityLabel(store.tr("Importar registros"))
                }
                .font(.nutriMono(14)).frame(height: 122)
                .nutriCard(radius: 12, fill: palette.surface2)
                .overlay { if targeted { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.accentDeep, lineWidth: 2) } }
                if loading {
                    ProgressView().controlSize(.small)
                } else if !rows.isEmpty {
                    Text(store.tr("%n filas · %v se importarán")
                        .replacingOccurrences(of: "%n", with: String(rows.count))
                        .replacingOccurrences(of: "%v", with: String(importable.count))
                         + (warnings > 0 ? " · " + store.tr("%w con ⚠").replacingOccurrences(of: "%w", with: String(warnings)) : ""))
                        .font(.nutriSans(12)).foregroundStyle(palette.text3)
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                                HStack(spacing: 8) {
                                    Text(row.display).lineLimit(1).font(.nutriSans(14))
                                    Spacer(minLength: 0)
                                    if !row.warnings.isEmpty {
                                        NutriIcon("triangle-alert", size: 13).foregroundStyle(palette.warn)
                                        Text(row.warnings.map(store.tr).joined(separator: ", "))
                                            .font(.nutriSans(12)).foregroundStyle(palette.warn)
                                    }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .nutriCard(radius: 8, fill: .clear).opacity(row.payload == nil ? 0.6 : 1)
                            }
                        }
                    }.frame(height: min(CGFloat(rows.count) * 34, 200))
                }
                if !error.isEmpty { Text(error).font(.nutriSans(14)).foregroundStyle(palette.danger) }
                Button { save(importable) } label: {
                    Text(store.tr("Importar %n").replacingOccurrences(of: "%n", with: String(importable.count)))
                        .frame(maxWidth: .infinity)
                }.buttonStyle(NutriButtonStyle(.primary)).disabled(loading || saving || importable.isEmpty)
                Button(action: close) { Text(store.tr("Cancelar")).frame(maxWidth: .infinity) }
                    .buttonStyle(NutriButtonStyle(.secondary)).disabled(saving)
            }
        } footer: { EmptyView() }
        .dropDestination(for: URL.self, action: { files, _ in
            guard let file = files.first, file.isFileURL else { return false }
            read(file)
            return true
        }, isTargeted: { targeted = $0 })
        .onChange(of: text) { _, value in
            do { _ = try CSV.parse(value); error = "" }
            catch { self.error = error.localizedDescription }
        }
        .task {
            defer { loading = false }
            do { catalog = try await store.catalog() }
            catch { self.error = error.localizedDescription }
        }
    }

    private func unique(_ matches: [(String, Record)]) -> Record? { matches.count == 1 ? matches[0].1 : nil }

    private func read(_ file: URL) {
        do {
            guard ["csv", "txt"].contains(file.pathExtension.lowercased()),
                  let contents = String(data: try secureFileData(file), encoding: .utf8) else {
                throw NutriError("El CSV debe estar en UTF-8.")
            }
            text = contents
        } catch { self.error = error.localizedDescription }
    }

    private func save(_ rows: [Record]) {
        guard !saving, !rows.isEmpty else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                _ = try await store.insert("entries", rows)
                close()
                store.toast(store.tr("%n registros importados.").replacingOccurrences(of: "%n", with: String(rows.count)))
                await reload()
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct JournalUndoInline: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette

    var body: some View {
        HStack(spacing: 8) {
            Text(store.undoTitle ?? "").font(.nutriSans(14))
            Spacer()
            Button(store.tr("Deshacer"), action: store.performUndo)
                .buttonStyle(NutriButtonStyle(.quiet))
        }
        .padding(.horizontal, 8).nutriCard(radius: 12, fill: palette.surface3)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct JournalCatalog {
    var foods: [Record] = []
    var recipes: [Record] = []
    var recipeMeta: [Record] = []
    var loaded = false
}

private struct JournalKeys: NSViewRepresentable {
    enum Command { case previous, next, search, escape }

    let handle: (Command) -> Bool

    @MainActor
    final class Listener: NSView {
        var handle: ((Command) -> Bool)?
        var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, let window = self.window, event.window === window else { return event }
                if event.keyCode == 53 { return self.handle?(.escape) == true ? nil : event }
                guard !(window.firstResponder is NSTextView),
                      event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty else { return event }
                let command: Command
                switch (event.keyCode, event.charactersIgnoringModifiers) {
                case (123, _): command = .previous
                case (124, _): command = .next
                case (_, "/"): command = .search
                default: return event
                }
                return self.handle?(command) == true ? nil : event
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }

    func makeNSView(context: Context) -> Listener { Listener() }
    func updateNSView(_ view: Listener, context: Context) { view.handle = handle }
    static func dismantleNSView(_ view: Listener, coordinator: ()) { view.stop() }
}

private enum JournalQuantityDimension {
    case mass, volume
}

private func journalQuantity(_ value: Double, dimension: JournalQuantityDimension, us: Bool) -> String {
    let metric = dimension == .mass ? "g" : "ml"
    guard us else { return journalNumber(value) + " " + metric }
    let converted = value / (dimension == .mass ? Domain.gramsPerOunce : Domain.mlPerFluidOunce)
    return journalNumber(converted, digits: converted < 1 ? 2 : 1) + (dimension == .mass ? " oz" : " fl oz")
}

private func journalFoods(_ rows: [Record], waterID: String) -> [Record] {
    rows.filter { row in
        let foodID = row.text("food_id")
        return foodID.isEmpty || foodID != waterID
    }
}

/// Day-keyed counterpart to rankFrequent in src/lib/frequent.js.
private func journalFrequent(_ rows: [Record], date: Date, label: String, waterID: String,
                             currentRows: [Record], dayReady: Bool) -> [Record] {
    struct Item {
        let row: Record
        var score = 0.0
        var latest = ""
        var amounts: [Double] = []
    }
    func key(_ row: Record) -> String {
        let id = row.text("food_id")
        return id.isEmpty ? "recipe:" + row.text("recipe_id") : "food:" + id
    }
    func inLabel(_ row: Record) -> Bool { label.isEmpty || row.text("meal_label_id") == label }

    let day = Day.key(date)
    let days = Dictionary(uniqueKeysWithValues: (0...30).map { (Day.key(Day.add(date, -$0)), $0) })
    let current = currentRows.filter { $0.text("day") == day }
    let currentIDs = Set(current.map { $0.text("id") })
    let history = rows.filter {
        days[$0.text("day")] != nil && !(dayReady && $0.text("day") == day) && !currentIDs.contains($0.text("id"))
    }
    let candidates = history + current
    let repeats = Set(candidates.filter { $0.text("day") == day && inLabel($0) }.map(key))
    var ranking: [String: Item] = [:]
    for row in journalFoods(candidates, waterID: waterID) where inLabel(row) {
        let itemKey = key(row)
        guard !itemKey.hasSuffix(":"), let age = days[row.text("day")] else { continue }
        ranking[itemKey, default: Item(row: row)].score += pow(2, -Double(age) / 7)
        if ranking[itemKey]?.latest ?? "" < row.text("day") { ranking[itemKey]?.latest = row.text("day") }
        if let grams = row.number("grams") { ranking[itemKey]?.amounts.append(grams) }
    }
    for item in repeats where ranking[item] != nil { ranking[item]?.score *= 0.25 }
    return ranking.sorted { a, b in
        if a.value.score != b.value.score { return a.value.score > b.value.score }
        if a.value.latest != b.value.latest { return a.value.latest > b.value.latest }
        return a.key < b.key
    }.prefix(8).map { _, item in
        let counts = Dictionary(grouping: item.amounts, by: { $0 }).mapValues(\.count)
        var row = item.row
        var best = 0
        for grams in item.amounts {
            guard let weight = counts[grams], weight > best else { continue }
            best = weight
            row["grams"] = .number(grams)
        }
        return row
    }
}

private enum JournalGoalTone: Equatable {
    case neutral, ok, towardNear(Double), towardWarn(Double), warn, danger
}

#if DEBUG
func checkJournalFidelity() throws {
    func check(_ value: @autoclosure () -> Bool, _ name: String) throws {
        guard value() else { throw NutriError("Hoy · " + name) }
    }

    guard let date = Day.date("2026-11-16") else { throw NutriError("Invalid journal fixture date") }
    func entry(_ id: String, age: Int, food: String? = nil, recipe: String? = nil, grams: Double, label: String = "breakfast") -> Record {
        ["id": .string(id), "day": .string(Day.key(Day.add(date, -age))), "food_id": food.map(JSONValue.string) ?? .null,
         "recipe_id": recipe.map(JSONValue.string) ?? .null, "grams": .number(grams), "meal_label_id": .string(label)]
    }
    let water = entry("water", age: 1, food: "water", grams: 1000)
    let original = [
        entry("a-old", age: 1, food: "a", grams: 150),
        entry("b-old", age: 1, food: "b", grams: 180),
        entry("c-old", age: 1, food: "c", grams: 100),
        entry("r-old", age: 2, recipe: "r", grams: 210),
        entry("stale-today", age: 0, food: "z", grams: 20),
        entry("dinner-only", age: 1, food: "lunch", grams: 30, label: "dinner"),
        entry("out-of-window", age: 31, food: "old", grams: 50),
        entry("day-edge", age: 30, food: "edge", grams: 70),
        water
    ]
    let current = [entry("a-present", age: 0, food: "a", grams: 220)]
    let frequent = journalFrequent(original, date: date, label: "breakfast", waterID: "water", currentRows: current, dayReady: true)
    let ids = frequent.map { $0.text("food_id").isEmpty ? $0.text("recipe_id") : $0.text("food_id") }
    // Web oracle rankFrequent: B/C tie splits on key, A's contemporary repeat is downweighted,
    // a tie in usual grams uses the first appearance (history 150 g before queued 220 g).
    try check(ids == ["b", "c", "r", "a", "edge"], "frequent entry order and closed history window")
    try check(frequent.first { $0.text("food_id") == "a" }?.number("grams") == 150, "frequent grams tie")
    let staleShadow = entry("a-present", age: 0, food: "different", grams: 80)
    let shadowed = journalFrequent([staleShadow], date: date, label: "", waterID: "water", currentRows: current, dayReady: false)
    try check(shadowed.count == 1 && shadowed.first?.text("food_id") == "a", "queued row shadows fetched row")
    let usual = journalFrequent(original + [entry("a-second", age: 2, food: "a", grams: 220)], date: date,
                                label: "breakfast", waterID: "water", currentRows: current, dayReady: true)
    try check(usual.first { $0.text("food_id") == "a" }?.number("grams") == 220, "frequent grams mode")
    let copied = journalFoods([water, original[0], original[3]], waterID: "water").map(entryPayload)
    try check(copied.count == 2 && copied[1]["food_id"] == .null && copied[1].text("recipe_id") == "r"
              && copied[0].text("meal_label_id") == "breakfast", "copy and templates omit the water food, preserve recipes and labels")
    try check(journalFoods([water], waterID: "").count == 1, "only the configured water food is excluded")
    try check(journalQuantity(12.345, dimension: .mass, us: false) == "12.3 g"
              && journalQuantity(150, dimension: .mass, us: true) == "5.3 oz"
              && journalQuantity(9, dimension: .mass, us: true) == "0.32 oz"
              && journalQuantity(250, dimension: .volume, us: true) == "8.5 fl oz"
              && journalQuantity(12, dimension: .volume, us: true) == "0.41 fl oz", "web unit rounding")

    let target: Record = ["kcal": .number(2000), "bounds": .object([
        "kcal": .object(["min": .number(1800), "max": .number(2200)])
    ])]
    func energy(_ value: Double) throws -> JournalNutrient {
        guard let state = JournalNutrient("kcal", totals: ["kcal": .number(value)], target: target, hasFood: true, bands: [:]) else {
            throw NutriError("Missing energy fixture state")
        }
        return state
    }
    let below = try energy(1500)
    let within = try energy(1900)
    let towardNear = try energy(2020)
    let towardWarn = try energy(2110)
    let upper = try energy(2200)
    let over = try energy(2201)
    try check(below.scaleEnd == 2200 && below.goalBounds.min == 1800 && below.deviation?.delta == -300, "range and deviation at explicit bound")
    try check(below.goalTone() == .danger && below.goalTone(forceDanger: false) == .neutral, "ring and rail below bounds")
    try check(within.goalTone() == .ok && upper.goalTone() == .warn && over.goalTone(forceDanger: false) == .danger, "goal color below upper bound and past it")
    if case .towardNear(let ratio) = towardNear.goalTone() {
        try check(abs(ratio - 0.2272727273) < 0.0000001, "sRGB goal color ok–near interpolation")
    } else { throw NutriError("Missing near interpolation") }
    if case .towardWarn(let ratio) = towardWarn.goalTone() {
        try check(abs(ratio - 0.3055555556) < 0.0000001, "sRGB goal color near–warn interpolation")
    } else { throw NutriError("Missing warn interpolation") }
    let coupledTarget: Record = [
        "carbs_g": .number(245), "rules": .object(["transition": .object(["kind": .string("coupled_band")])]),
        "bounds": .object(["carbs_g": .object(["min": .number(200), "max": .number(280)])])
    ]
    let coupled = JournalNutrient("carbs_g", totals: ["carbs_g": .number(310)], target: coupledTarget, hasFood: true, bands: [:])
    try check(coupled?.coupled == true && coupled?.scaleEnd == 280 && coupled?.deviation == nil
              && coupled?.status == nil && coupled?.goalTone() == .danger, "coupled macro scale uses the envelope")
    let sodium = JournalNutrient("sodio_mg", totals: ["micros": .object(["sodio_mg": .number(250)])],
                                 target: target, hasFood: true, bands: [:])
    try check(sodium?.coverage == .partial && sodium?.lowSodium == true && sodium?.pending == true
              && sodium?.deviation?.base == Domain.sodiumFloor && sodium?.scaleEnd == nil, "partial sodium under floor remains visible")
}
#endif

private struct JournalSheet<Content: View>: View {
    @Environment(\.nutriPalette) private var palette
    let title: String
    @ViewBuilder var content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title).font(.nutriDisplay(18))
            content
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        ViewThatFits(in: .vertical) {
            panel.fixedSize(horizontal: false, vertical: true)
            ScrollView { panel }
        }
        .background(palette.surface3, in: RoundedRectangle(cornerRadius: 16, style: .circular))
    }
}

/// Matches the two-column grid's equal-height backgrounds while preserving each
/// tile's natural height when measuring the row.
private struct JournalTileRow: Layout {
    private let gap: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? (subviews.map { $0.sizeThatFits(.unspecified).width }.max() ?? 0) * 2 + gap
        let tileWidth = max(0, (width - gap) / 2)
        let height = subviews.map { $0.sizeThatFits(.init(width: tileWidth, height: nil)).height }.max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let tileWidth = max(0, (bounds.width - gap) / 2)
        for (index, tile) in subviews.enumerated() {
            let origin = CGPoint(x: bounds.minX + CGFloat(index) * (tileWidth + gap), y: bounds.minY)
            tile.place(at: origin, anchor: .topLeading, proposal: .init(width: tileWidth, height: bounds.height))
        }
    }
}
