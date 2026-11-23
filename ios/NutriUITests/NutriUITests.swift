import XCTest

final class NutriUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testSignedOutLaunchAndLocalValidation() {
        let app = launch()
        let email = app.textFields["login.email"]
        let password = app.secureTextFields["login.password"]
        let submit = app.buttons["login.submit"]
        XCTAssertTrue(email.waitForExistence(timeout: 10))
        capture("01 Login")
        XCTAssertTrue(password.isHittable, app.debugDescription)
        XCTAssertTrue(submit.isHittable)
        XCTAssertTrue(app.buttons["login.demo"].isHittable)

        submit.tap()
        XCTAssertTrue(app.staticTexts["Email o contraseña incorrectos."].waitForExistence(timeout: 5))
        XCTAssertFalse(dock(in: app).buttons["module.today"].exists)
    }

    @MainActor
    func testLocalDemoNavigationAndWaterSettings() {
        let app = launch(demo: true)
        let today = dock(in: app).buttons["module.today"]
        XCTAssertTrue(today.waitForExistence(timeout: 10))
        XCTAssertTrue(today.isSelected)
        XCTAssertTrue(app.staticTexts["Demo con datos de ejemplo — los cambios se borran solos."].exists)
        capture("02 Hoy")

        for (number, title, heading) in [
            ("03", "Alimentos", "Alimentos"),
            ("04", "Recetas", "Recetas"),
            ("05", "Objetivos", "Objetivos"),
            ("06", "Progreso", "Dashboard"),
            ("07", "Progreso", "Medidas del día"),
        ] {
            let tab = dock(in: app).buttons[title]
            XCTAssertTrue(tab.isHittable)
            if title == "Progreso" {
                openProgress(heading == "Dashboard" ? "Dashboard" : "Medidas", in: app)
            } else {
                tab.tap()
            }
            if title == "Alimentos" {
                XCTAssertTrue(app.textFields["foods.search"].waitForExistence(timeout: 10))
            } else {
                XCTAssertTrue(app.scrollViews.firstMatch.staticTexts[heading].firstMatch.waitForExistence(timeout: 10), heading)
            }
            XCTAssertTrue(tab.isSelected)
            XCTAssertFalse(today.isSelected)
            capture("\(number) \(heading)")
        }

        today.tap()
        XCTAssertTrue(today.isSelected)
        openWater(in: app)
        app.buttons["today.waterSettings"].tap()
        let size = app.textFields["today.waterSize"]
        XCTAssertTrue(size.waitForExistence(timeout: 5))
        XCTAssertEqual(size.value as? String, "350")
        capture("08 Ajustes de agua")
        app.buttons["today.waterSave"].tap()
        XCTAssertTrue(size.waitForNonExistence(timeout: 5))
        app.buttons["sheet.close"].tap()
        XCTAssertTrue(today.isSelected)
    }

    @MainActor
    func testNativeDockKeepsAllDestinationsAndRealAction() throws {
        guard #available(iOS 27, *) else { throw XCTSkip("Native selection probe requires iOS 27.") }
        let app = launch(demo: true, longJournal: true)
        let today = app.tabBars.buttons["Hoy"].firstMatch
        XCTAssertTrue(today.waitForExistence(timeout: 10), app.debugDescription)
        capture("Nativo cinco pestañas más acción")
        let selected = app.tabBars.buttons["Progreso"].firstMatch
        let add = app.buttons["today.add"]
        for title in ["Hoy", "Alimentos", "Recetas", "Objetivos", "Progreso"] {
            XCTAssertTrue(app.tabBars.buttons[title].firstMatch.isHittable, title + app.debugDescription)
        }
        XCTAssertTrue(add.isHittable, app.debugDescription)
        XCTAssertEqual(today.frame.midY, add.frame.midY, accuracy: 2)
        XCTAssertEqual(selected.frame.midY, add.frame.midY, accuracy: 2)
        XCTAssertLessThanOrEqual(selected.frame.maxX, add.frame.minX)
        XCTAssertFalse(app.tabBars.buttons["Más"].exists)
        XCTAssertEqual(app.tabBars.count, 1)
        XCTAssertEqual(app.tabBars.buttons.count, 5)
        selected.tap()
        XCTAssertTrue(app.segmentedControls.buttons["Dashboard"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(selected.isSelected, app.debugDescription)
        capture("Nativo selección Progreso")
        today.tap()
        let addContext = app.buttons["today.add"]
        addContext.tap()
        XCTAssertTrue(app.textFields["entryEditor.search"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["sheet.close"].tap()
        XCTAssertTrue(today.isSelected, app.debugDescription)
        app.scrollViews.firstMatch.swipeUp(velocity: .slow)
        for title in ["Hoy", "Alimentos", "Recetas", "Objetivos", "Progreso"] {
            XCTAssertTrue(app.tabBars.buttons[title].firstMatch.isHittable, title + app.debugDescription)
        }
        XCTAssertTrue(add.isHittable, app.debugDescription)
        capture("Barra nativa al desplazar Hoy")
    }

    @MainActor
    func testContextDockStaysReachableWhileScrollingAndClearsLastIntake() {
        let app = launch(demo: true, longJournal: true)
        let dock = dock(in: app)
        let add = dock.buttons["today.add"]
        let today = dock.buttons["module.today"]
        let journal = app.scrollViews.firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 10), app.debugDescription)
        let identifiers = ["module.today", "module.foods", "module.recipes", "module.targets",
                           "module.dashboard", "today.add"]
        for id in identifiers {
            let button = dock.buttons[id]
            XCTAssertTrue(button.isHittable, app.debugDescription)
            XCTAssertGreaterThanOrEqual(button.frame.width, 44)
            XCTAssertGreaterThanOrEqual(button.frame.height, 44)
            XCTAssertEqual(button.frame.midY, add.frame.midY, accuracy: 2)
        }
        capture("Barra contextual al abrir Hoy")

        let last = journal.buttons["today.intake.00000000-0000-4000-8000-000000000605"]
        journal.swipeUp(velocity: .slow)
        for _ in 0..<3 where last.frame.maxY > add.frame.minY || !last.isHittable {
            journal.swipeUp(velocity: .slow)
        }
        XCTAssertTrue(last.isHittable, app.debugDescription)
        XCTAssertLessThanOrEqual(last.frame.maxY, add.frame.minY)
        for id in identifiers {
            XCTAssertTrue(dock.buttons[id].isHittable, app.debugDescription)
        }
        capture("Barra contextual al final de Hoy")

        for _ in 0..<4 where !app.buttons["Día anterior"].isHittable {
            journal.swipeDown(velocity: .slow)
        }

        let previous = app.buttons["Día anterior"]
        XCTAssertTrue(previous.isHittable, app.debugDescription)
        previous.tap()
        let date = app.buttons["today.date"]
        XCTAssertNotEqual(date.value as? String, "Hoy")
        let selectedDay = date.value as? String
        add.tap()
        XCTAssertTrue(app.textFields["entryEditor.search"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(today.isHittable)
        app.buttons["sheet.close"].tap()
        XCTAssertEqual(date.value as? String, selectedDay)
    }

    @MainActor
    func testContextDockRoutesToExistingEditors() {
        let app = launch(demo: true)
        let add = dock(in: app).buttons["context.add"]

        selectTab("foods", in: app)
        XCTAssertEqual(add.label, "Nuevo alimento")
        add.tap()
        XCTAssertTrue(app.staticTexts["Nuevo alimento"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(add.isEnabled)

        selectTab("recipes", in: app)
        XCTAssertEqual(add.label, "Nueva receta")
        add.tap()
        XCTAssertTrue(app.staticTexts["Nueva receta"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(add.isEnabled)

        selectTab("targets", in: app)
        XCTAssertEqual(add.label, "Programar fase")
        XCTAssertTrue(app.buttons["+ Programar"].waitForExistence(timeout: 5), app.debugDescription)
        add.tap()
        let phaseName = app.textFields["Nombre de fase"]
        XCTAssertTrue(phaseName.waitForExistence(timeout: 5), app.debugDescription)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        XCTAssertTrue(phaseName.waitForNonExistence(timeout: 5), app.debugDescription)

        openProgress("Dashboard", in: app)
        XCTAssertEqual(add.label, "Nueva gráfica")
        add.tap()
        XCTAssertTrue(app.buttons["Guardar gráfica"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["sheet.close"].tap()

        openProgress("Medidas", in: app)
        let weight = app.textFields["body.metric.peso_kg"]
        XCTAssertTrue(weight.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(add.label, "Registrar medida")
        app.scrollViews.firstMatch.swipeUp(velocity: .slow)
        add.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(weight.isHittable, app.debugDescription)
        XCTAssertTrue(add.waitForNonExistence(timeout: 5), app.debugDescription)
        app.buttons["keyboard.done"].tap()
        XCTAssertTrue(add.waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testLocalDemoLightTheme() {
        let app = launch(demo: true, theme: "light")
        let today = dock(in: app).buttons["module.today"]
        XCTAssertTrue(today.waitForExistence(timeout: 10))
        XCTAssertTrue(today.isSelected)
        capture("09 Hoy claro")
    }

    @MainActor
    func testLocalDemoIntakeAllowsVerticalScroll() {
        let (app, intake) = launchDemoWithBreakfastIntake(longJournal: true)
        for offset in [CGFloat(-115), 115] {
            XCTAssertTrue(intake.isHittable, app.debugDescription)
            let initialY = intake.frame.minY
            let start = intake.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            start.press(forDuration: 0, thenDragTo: start.withOffset(CGVector(dx: 0, dy: offset)),
                        withVelocity: .slow, thenHoldForDuration: 0)
            XCTAssertFalse(app.buttons["Guardar"].exists)
            XCTAssertFalse(app.buttons["Deshacer"].exists)
            XCTAssertTrue(intake.exists, app.debugDescription)
            XCTAssertGreaterThan((offset < 0 ? -1 : 1) * (intake.frame.minY - initialY), 16, app.debugDescription)
            if offset < 0 { capture("Pestañas al desplazar bitácora") }
        }
    }

    @MainActor
    func testLocalDemoIntakeShortSwipesPreserveEditTap() {
        let (app, intake) = launchDemoWithBreakfastIntake()
        let undo = app.buttons["Deshacer"]
        let save = app.buttons["Guardar"]
        let initialX = intake.frame.minX
        let center = intake.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for (name, distance, duration, velocity) in [
            ("10 Arrastre corto rápido", CGFloat(24), 0.03, XCUIGestureVelocity.default),
            ("11 Arrastre corto lento", 48, 0.08, .slow)
        ] {
            let end = center.withOffset(CGVector(dx: -distance, dy: 0))
            center.press(forDuration: duration, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0)
            capture(name)
            XCTAssertFalse(save.exists, "\(name) abrió el editor")
            XCTAssertFalse(undo.exists, "\(name) borró el registro")
            XCTAssertTrue(intake.isHittable, app.debugDescription)
            XCTAssertEqual(intake.frame.minX, initialX, accuracy: 1)
        }
        intake.tap()
        XCTAssertTrue(save.waitForExistence(timeout: 5), app.debugDescription)
        capture("12 Editor desde el registro")
    }

    @MainActor
    func testLocalDemoIntakeSwipeDeleteAndUndo() {
        let (app, intake) = launchDemoWithBreakfastIntake()
        let undo = app.buttons["Deshacer"]
        intake.swipeLeft()
        let undoAppeared = undo.waitForExistence(timeout: 3)
        let intakeDisappeared = !intake.exists
        if !undoAppeared || !intakeDisappeared { capture("13 Swipe completo") }
        XCTAssertTrue(undoAppeared, app.debugDescription)
        XCTAssertTrue(intakeDisappeared, app.debugDescription)
        undo.tap()

        // Undo restores the intake with a new ID.
        let restored = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "today.intake.", "Avena con yogur"
        )).firstMatch
        XCTAssertTrue(restored.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(restored.label.contains("215 g"), restored.label)
        reveal(restored, in: app)
        capture("13 Registro recuperado")
    }

    @MainActor
    func testCatalogSwipesRespectOwnershipAndKeepEditTap() {
        let app = launch(demo: true)
        let foods = dock(in: app).buttons["module.foods"]
        XCTAssertTrue(foods.waitForExistence(timeout: 10))
        foods.tap()
        let oats = app.buttons["foods.card.00000000-0000-4000-8000-000000000011"]
        reveal(oats, in: app)
        oats.swipeLeft()
        XCTAssertTrue(oats.isHittable, app.debugDescription)
        XCTAssertFalse(app.buttons["Deshacer"].exists)
        XCTAssertFalse(app.staticTexts["Editar alimento"].exists)

        let yogurt = app.buttons["foods.card.00000000-0000-4000-8000-000000000012"]
        reveal(yogurt, in: app)
        let start = yogurt.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.5))
        start.press(forDuration: 0.08, thenDragTo: start.withOffset(CGVector(dx: -48, dy: 1)),
                    withVelocity: .slow, thenHoldForDuration: 0)
        XCTAssertFalse(app.buttons["Deshacer"].exists)
        XCTAssertFalse(app.staticTexts["Editar alimento"].exists)
        XCTAssertTrue(yogurt.isHittable)
        yogurt.tap()
        XCTAssertTrue(app.staticTexts["Editar alimento"].waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testLocalDemoPopulatedTodayShowsJournalAndOpensDetails() {
        let app = launch(demo: true)
        let intake = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "today.intake.", "Avena con yogur"
        )).firstMatch
        let summary = app.buttons["today.summary"]
        let water = app.buttons["today.waterTotal"]
        let quickGlass = app.buttons["today.waterAddGlass"]
        let add = app.buttons["today.add"]
        XCTAssertTrue(intake.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(intake.isHittable, app.debugDescription)
        XCTAssertTrue(summary.isHittable)
        XCTAssertTrue(summary.label.contains("Energía"), summary.label)
        for component in ["Sodio", "Potasio", "1500–2300 mg", "Parcial", "Cobertura incompleta"] {
            XCTAssertTrue(summary.label.localizedCaseInsensitiveContains(component), summary.label)
        }
        XCTAssertTrue(intake.label.contains("kcal"), intake.label)
        XCTAssertFalse(app.buttons["Opciones de registro"].exists)
        XCTAssertTrue(water.isHittable)
        XCTAssertTrue(quickGlass.isHittable)
        XCTAssertTrue(add.isHittable)
        capture("Hoy con primer registro visible")

        summary.tap()
        let customize = app.buttons["Personalizar resumen"]
        XCTAssertTrue(customize.waitForExistence(timeout: 5), app.debugDescription)
        customize.tap()
        XCTAssertTrue(app.staticTexts["Personalizar resumen"].waitForExistence(timeout: 5), app.debugDescription)
        let settingsClose = app.buttons["sheet.close"].firstMatch
        XCTAssertTrue(settingsClose.waitForExistence(timeout: 5), app.debugDescription)
        settingsClose.tap()
        XCTAssertTrue(customize.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["sheet.close"].tap()
        XCTAssertTrue(summary.isHittable)

        let previous = water.value as? String
        XCTAssertNotNil(previous)
        quickGlass.tap()
        let changedTotal = NSPredicate(format: "value != %@", previous ?? "")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changedTotal, object: water)], timeout: 5),
                       .completed, app.debugDescription)
        openWater(in: app)
        let remove = app.buttons["today.waterRemoveLast"]
        XCTAssertTrue(remove.isHittable, app.debugDescription)
        remove.tap()
        let undo = app.buttons["Deshacer"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3), app.debugDescription)
        undo.tap()
        app.buttons["sheet.close"].tap()
        XCTAssertNotEqual(water.value as? String, previous)
        let raspberries = app.buttons["today.intake.00000000-0000-4000-8000-000000000101"]
        reveal(raspberries, in: app)
        XCTAssertTrue(raspberries.label.contains("0 mg"), raspberries.label)
    }

    @MainActor
    func testLocalDemoEntrySheetKeepsRegisterAndSaveAboveKeyboard() {
        let app = launch(demo: true)
        let add = app.buttons["today.add"]
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        add.tap()
        let search = app.textFields["entryEditor.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        search.tap()
        search.typeText("Yogur natural")
        let choice = app.buttons["Yogur natural"]
        XCTAssertTrue(choice.waitForExistence(timeout: 5), app.debugDescription)
        choice.tap()
        let amount = app.textFields["entryEditor.amount"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["Cancelar"].tap()
        XCTAssertTrue(amount.waitForNonExistence(timeout: 5), app.debugDescription)
        search.typeText("Yogur natural")
        XCTAssertTrue(choice.waitForExistence(timeout: 5), app.debugDescription)
        choice.tap()
        XCTAssertTrue(amount.waitForExistence(timeout: 5), app.debugDescription)
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), app.debugDescription)
        amount.tap()
        let decimal = keyboard.keys.matching(NSPredicate(format: "label IN %@", [".", ","])).firstMatch
        XCTAssertTrue(decimal.waitForExistence(timeout: 5), app.debugDescription)
        keyboard.keys["7"].tap()
        keyboard.keys["5"].tap()
        XCTAssertTrue(app.staticTexts["-1394 kcal"].waitForExistence(timeout: 5), app.debugDescription)
        let register = app.buttons["entryEditor.save"]
        assertEntryFooter("Registrar", keyboard: keyboard, in: app)
        capture("Registrar sobre el teclado")
        register.tap()
        XCTAssertTrue(amount.waitForNonExistence(timeout: 5), app.debugDescription)

        let logged = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "today.intake.", "Yogur natural"
        )).firstMatch
        XCTAssertTrue(logged.waitForExistence(timeout: 5), app.debugDescription)
        catalogReveal(logged, in: app)
        XCTAssertTrue(logged.label.contains("Potasio"), logged.label)
        XCTAssertTrue(logged.label.contains("Sin dato"), logged.label)
        logged.tap()
        XCTAssertTrue(app.buttons["Borrar"].isHittable, app.debugDescription)
        XCTAssertTrue(amount.waitForExistence(timeout: 5), app.debugDescription)
        amount.tap()
        XCTAssertTrue(decimal.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["keyboard.done"].tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), app.debugDescription)
        amount.tap()
        XCTAssertTrue(decimal.waitForExistence(timeout: 5), app.debugDescription)
        assertEntryFooter("Guardar", keyboard: keyboard, in: app)
        capture("Guardar sobre el teclado")
        register.tap()
        XCTAssertTrue(amount.waitForNonExistence(timeout: 5), app.debugDescription)

        add.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        let grabber = app.buttons["Tirador de la hoja"]
        XCTAssertTrue(grabber.waitForExistence(timeout: 5), app.debugDescription)
        grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        XCTAssertTrue(search.waitForNonExistence(timeout: 5), app.debugDescription)

        add.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["sheet.close"].tap()
        XCTAssertTrue(search.waitForNonExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    private func assertEntryFooter(_ label: String, keyboard: XCUIElement, in app: XCUIApplication) {
        let save = app.buttons["entryEditor.save"]
        let done = app.buttons["keyboard.done"]
        XCTAssertTrue(save.isHittable, app.debugDescription)
        XCTAssertTrue(done.isHittable, app.debugDescription)
        XCTAssertEqual(save.label, label)
        XCTAssertGreaterThanOrEqual(save.frame.height, 44)
        XCTAssertFalse(save.frame.intersects(done.frame), app.debugDescription)
        XCTAssertEqual(save.frame.midY, done.frame.midY, accuracy: 1)
        XCTAssertLessThanOrEqual(save.frame.maxY, keyboard.frame.minY + 1, app.debugDescription)
    }

    @MainActor
    func testLocalDemoLargeTextKeepsDateSummaryAndActionsReachable() {
        let app = launch(demo: true, textSize: "UICTContentSizeCategoryAccessibilityXXXL")
        let journal = app.scrollViews.firstMatch
        let date = journal.buttons["today.date"]
        XCTAssertTrue(date.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(date.isHittable)
        XCTAssertTrue(app.buttons["today.add"].isHittable)
        let summary = journal.buttons["today.summary"]
        XCTAssertTrue(summary.isHittable)
        XCTAssertGreaterThan(summary.frame.height, 230, app.debugDescription)
        XCTAssertTrue(app.frame.contains(CGPoint(x: summary.frame.maxX, y: summary.frame.minY)))
        capture("Hoy con texto de accesibilidad")

        selectTab("foods", in: app)
        let search = app.textFields["foods.search"]
        let filters = app.buttons["foods.filters"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(filters.isHittable)
        XCTAssertGreaterThanOrEqual(filters.frame.height, 44)
    }

    @MainActor
    func testLocalDemoCatalogFiltersCanBeCombinedAndCleared() {
        let app = launch(demo: true)
        selectTab("foods", in: app)
        let filters = app.buttons["foods.filters"]
        XCTAssertTrue(filters.waitForExistence(timeout: 5), app.debugDescription)
        let oats = app.buttons["foods.card.00000000-0000-4000-8000-000000000011"]
        let yogurt = app.buttons["foods.card.00000000-0000-4000-8000-000000000012"]
        XCTAssertTrue(oats.waitForExistence(timeout: 5), app.debugDescription)
        filters.tap()
        app.buttons["Manual"].tap()
        XCTAssertFalse(oats.exists, app.debugDescription)
        XCTAssertTrue(yogurt.exists, app.debugDescription)
        filters.tap()
        app.buttons["Solo alimentos con avisos"].tap()
        XCTAssertFalse(yogurt.exists, app.debugDescription)
        XCTAssertEqual(filters.value as? String, "Filtros activos")
        filters.tap()
        app.buttons["Solo alimentos con avisos"].tap()
        XCTAssertTrue(yogurt.exists, app.debugDescription)
        XCTAssertFalse(oats.exists, app.debugDescription)
        filters.tap()
        app.buttons["Todos"].tap()
        XCTAssertTrue(oats.waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testLocalDemoEntryCanCreateFoodAndReturnToJournal() {
        let app = launch(demo: true)
        app.buttons["today.add"].tap()
        let search = app.textFields["entryEditor.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5), app.debugDescription)
        search.tap()
        search.typeText("Yogur")
        app.buttons["entryEditor.newFood"].tap()
        let name = app.textFields["Nombre"]
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(name.value as? String, "Yogur")
        XCTAssertTrue(dock(in: app).buttons["module.foods"].isSelected, app.debugDescription)

        let ai = app.textViews["catalog.ai.text"]
        catalogReveal(ai, in: app)
        ai.tap()
        ai.typeText("Yogur")
        app.buttons["catalog.ai.submit"].tap()
        let saveAndLog = app.buttons["Guardar y registrar"]
        catalogReveal(saveAndLog, in: app)
        XCTAssertTrue(saveAndLog.isEnabled, app.debugDescription)
        saveAndLog.tap()
        XCTAssertTrue(app.textFields["entryEditor.amount"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["entryEditor.save"].isEnabled)
        XCTAssertEqual(app.textFields["entryEditor.search"].value as? String, "Yogur griego natural")
    }

    @MainActor
    func testLocalDemoCalendarsShowWholeWeek() {
        let app = launch(demo: true)
        let date = app.buttons["today.date"]
        XCTAssertTrue(date.waitForExistence(timeout: 5))
        date.tap()
        let todayCalendar = wholeCalendar(in: app)
        selectDay(inNextMonthOf: todayCalendar)
        XCTAssertTrue(todayCalendar.waitForNonExistence(timeout: 5))
        XCTAssertNotEqual(date.value as? String, "Hoy")

        openProgress("Medidas", in: app)
        let weight = app.textFields["body.metric.peso_kg"]
        XCTAssertTrue(weight.waitForExistence(timeout: 5))
        XCTAssertEqual(weight.value as? String, "72")
        let bodyDate = app.buttons["Elegir fecha"]
        bodyDate.tap()
        let bodyCalendar = wholeCalendar(in: app)
        capture("Calendario de Medidas")
        let aboveCalendar = bodyCalendar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0))
            .withOffset(CGVector(dx: 0, dy: -16))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
        aboveCalendar.press(forDuration: 0.05, thenDragTo: bottom)
        XCTAssertTrue(bodyCalendar.waitForNonExistence(timeout: 5))
        XCTAssertEqual(weight.value as? String, "72")

        bodyDate.tap()
        _ = wholeCalendar(in: app)
        selectDay(inNextMonthOf: bodyCalendar)
        XCTAssertTrue(bodyCalendar.waitForNonExistence(timeout: 5))
        let changedDay = NSPredicate(format: "value != %@", "72")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changedDay, object: weight)], timeout: 5), .completed)

        app.buttons["account.menu"].tap()
        app.buttons["account.profile"].tap()
        let birthDate = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "AAAA-MM-DD")).firstMatch
        XCTAssertTrue(birthDate.waitForExistence(timeout: 5))
        let originalBirthDate = birthDate.value as? String
        app.buttons["Elegir fecha"].tap()
        let profileCalendar = wholeCalendar(in: app)
        selectDay(inNextMonthOf: profileCalendar)
        XCTAssertTrue(profileCalendar.waitForNonExistence(timeout: 5))
        XCTAssertNotEqual(birthDate.value as? String, originalBirthDate)
    }

    @MainActor
    func testLocalDemoCopiesFoodWithoutCopyingWater() {
        let app = launch(demo: true)
        let more = app.buttons["module.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 10))
        more.tap()
        app.buttons["Copiar"].tap()
        XCTAssertTrue(app.staticTexts["Día copiado."].waitForExistence(timeout: 5))

        app.buttons["Día siguiente"].tap()
        XCTAssertNotEqual(app.buttons["today.date"].value as? String, "Hoy")
        more.tap()
        let paste = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Pegar ")).firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["Ayer"].exists)
        paste.tap()
        XCTAssertTrue(app.staticTexts["2 registros copiados."].waitForExistence(timeout: 5), app.debugDescription)

        let breakfast = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "today.intake.", "Avena con yogur"
        )).firstMatch
        reveal(breakfast, in: app)
        let water = app.buttons["today.waterTotal"]
        let journal = app.scrollViews.firstMatch
        for _ in 0..<3 where !water.isHittable { journal.swipeDown() }
        XCTAssertTrue(water.isHittable, app.debugDescription)
        XCTAssertTrue((water.value as? String)?.hasPrefix("0 ml") == true, water.debugDescription)
        XCTAssertFalse(app.buttons["Quitar último registro de agua"].exists)
    }

    @MainActor
    func testLocalDemoAccountRegionUpdatesJournalAndDismissesOutside() {
        let app = launch(demo: true)
        let account = app.buttons["account.menu"]
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        let region = app.buttons["account.region"]
        XCTAssertTrue(region.waitForExistence(timeout: 5))
        region.tap()
        let imperial = app.buttons["Imperial · oz · fl oz"]
        XCTAssertTrue(imperial.waitForExistence(timeout: 5))
        imperial.tap()
        XCTAssertTrue(imperial.isSelected, app.debugDescription)
        let english = app.buttons["region.language.en"]
        XCTAssertTrue(english.exists, app.debugDescription)
        english.tap()
        XCTAssertTrue(app.staticTexts["Language and units"].waitForExistence(timeout: 5), app.debugDescription)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.17)).tap()
        XCTAssertTrue(app.buttons["sheet.close"].waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(dock(in: app).buttons["module.today"].label, "Today")
        openWater(in: app)
        let customWater = app.textFields["Amount (fl oz)"]
        XCTAssertTrue(customWater.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(customWater.isHittable, app.debugDescription)
    }

    @MainActor
    func testFoodCSVImportsOnlyValidRowsAndSupportsSwipeUndo() {
        let app = launch(demo: true)
        selectTab("foods", in: app)
        let search = app.textFields["foods.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        app.buttons["foods.filters"].tap()
        app.buttons["Importar"].tap()
        let editor = app.textViews["catalog.csv.text"].firstMatch
        let commit = app.buttons["catalog.csv.commit"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertFalse(commit.isEnabled)
        editor.tap()
        editor.typeText("name,kcal,protein_g,carbs_g,fat_g\nMuestra CSV,100,5,20,0\nMuestra invalida,100,,20,0")
        XCTAssertEqual(commit.label, "Importar 1", app.debugDescription)
        XCTAssertTrue(commit.isHittable, app.debugDescription)
        commit.tap()

        XCTAssertTrue(commit.waitForNonExistence(timeout: 5))
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Muestra CSV")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Muestra invalida"].exists)
        catalogReveal(card, in: app)
        card.swipeLeft()
        let undo = app.buttons["Deshacer"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3), app.debugDescription)
        XCTAssertFalse(card.exists)
        undo.tap()
        XCTAssertTrue(card.waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testFoodDataCardValidatesEANAndPrefillsDemoNutrition() {
        let app = launch(demo: true)
        selectTab("foods", in: app)
        let create = dock(in: app).buttons["context.add"]
        XCTAssertEqual(create.label, "Nuevo alimento")
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        let ai = app.textViews["catalog.ai.text"]
        let submit = app.buttons["catalog.ai.submit"]
        XCTAssertTrue(ai.waitForExistence(timeout: 5))
        XCTAssertFalse(submit.isEnabled)
        ai.tap()
        ai.typeText("12345678")
        submit.tap()
        XCTAssertTrue(app.staticTexts["Código de barras inválido: dígito verificador no coincide, revísalo"].waitForExistence(timeout: 5))
        ai.tap()
        ai.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8) + "Yogur")
        submit.tap()
        let name = app.textFields["Nombre"]
        catalogReveal(name, in: app)
        XCTAssertEqual(name.value as? String, "Yogur griego natural")
    }

    @MainActor
    func testRecipeCatalogSearchPasteSaveAndReopen() {
        let app = launch(demo: true)
        selectTab("recipes", in: app)
        let create = app.buttons["Nueva receta"]
        XCTAssertTrue(create.waitForExistence(timeout: 10))
        create.tap()
        let name = app.textFields["Nombre"]
        catalogReveal(name, in: app)
        name.tap()
        name.typeText("Receta de prueba")

        let search = app.textFields["recipes.ingredient.search"]
        catalogReveal(search, in: app)
        search.tap()
        search.typeText("Avena\n")
        XCTAssertEqual(search.value as? String, "Avena", app.debugDescription)
        let oatID = "00000000-0000-4000-8000-000000000011"
        let yogurtID = "00000000-0000-4000-8000-000000000012"
        let oat = app.buttons["recipes.ingredient.hit." + oatID]
        XCTAssertTrue(oat.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(oat.label, "Avena integral")
        catalogReveal(oat, in: app)
        oat.tap()
        let amount = app.textFields["recipes.ingredient.amount." + oatID]
        catalogReveal(amount, in: app)
        amount.tap()
        amount.typeText("100")
        app.buttons["keyboard.done"].tap()

        let paste = app.buttons["Pegar lista de ingredientes"]
        catalogReveal(paste, in: app)
        paste.tap()
        let editor = app.textViews["recipes.ingredient.paste"].firstMatch
        catalogReveal(editor, in: app)
        editor.tap()
        editor.typeText("100 g Yogur natural\n30 g Ingrediente inexistente")
        let add = app.buttons["Añadir del texto"]
        catalogReveal(add, in: app)
        add.tap()
        XCTAssertTrue(app.staticTexts["1 añadidos · 1 sin coincidencia (agrégalos arriba)"].waitForExistence(timeout: 5))
        let preview = app.staticTexts["Preview por 100 g"]
        catalogReveal(preview, in: app)
        XCTAssertTrue(preview.isHittable)
        let save = app.buttons["Guardar"]
        catalogReveal(save, in: app)
        save.tap()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Receta de prueba")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
        catalogReveal(card, in: app)
        card.tap()
        XCTAssertTrue(app.staticTexts["Editar receta"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["Nombre"].value as? String, "Receta de prueba")
        XCTAssertEqual(amount.value as? String, "100")
        let yogurt = app.textFields["recipes.ingredient.amount." + yogurtID]
        XCTAssertEqual(yogurt.value as? String, "100")
    }

    @MainActor
    func testBodyAutosavesWhenChangingDateAndPromotesFavorite() {
        let app = launch(demo: true)
        openProgress("Medidas", in: app)
        let weight = app.textFields["body.metric.peso_kg"]
        XCTAssertTrue(weight.waitForExistence(timeout: 10))
        XCTAssertEqual(weight.value as? String, "72")
        weight.tap()
        weight.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2) + "73")
        app.buttons["Día anterior"].tap()
        let noWeight = NSPredicate(format: "value != %@", "73")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: noWeight, object: weight)], timeout: 5), .completed)
        app.buttons["Día siguiente"].tap()
        let savedWeight = NSPredicate(format: "value == %@", "73")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: savedWeight, object: weight)], timeout: 5), .completed)

        let more = app.buttons["Más medidas ▾"]
        catalogReveal(more, in: app)
        more.tap()
        let favorite = app.buttons["body.favorite.grasa_pct"]
        catalogReveal(favorite, in: app)
        XCTAssertFalse(favorite.isSelected)
        favorite.tap()
        let promoted = NSPredicate(format: "selected == true")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: promoted, object: favorite)], timeout: 5), .completed)
        // Switch sections to reopen Medidas with its extra measurements collapsed.
        app.segmentedControls.buttons["Dashboard"].tap()
        app.segmentedControls.buttons["Medidas"].tap()
        let fat = app.textFields["body.metric.grasa_pct"]
        XCTAssertTrue(fat.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(fat.value as? String, "20.5")
        XCTAssertTrue(app.buttons["Más medidas ▾"].exists)
        XCTAssertTrue(favorite.isSelected)
    }

    @MainActor
    func testBodyCSVComplementThenReplaceExistingDay() {
        let app = launch(demo: true)
        openProgress("Medidas", in: app)
        let weight = app.textFields["body.metric.peso_kg"]
        XCTAssertTrue(weight.waitForExistence(timeout: 10))
        let today = DateFormatter()
        today.locale = Locale(identifier: "en_US_POSIX")
        today.dateFormat = "yyyy-MM-dd"
        let key = today.string(from: Date())
        let commit = app.buttons["catalog.csv.commit"]
        let journalTitle = app.staticTexts["Medidas del día"]
        for (value, replace) in [("74", false), ("75", true)] {
            let more = app.buttons["module.more"]
            XCTAssertTrue(more.waitForExistence(timeout: 5))
            more.tap()
            app.buttons["Importar"].tap()
            let editor = app.textViews["catalog.csv.text"].firstMatch
            XCTAssertTrue(editor.waitForExistence(timeout: 5))
            editor.tap()
            editor.typeText("day,peso_kg\n" + key + "," + value)
            let collision = app.staticTexts["1 días del CSV ya tienen medidas registradas."]
            XCTAssertTrue(collision.waitForExistence(timeout: 5), app.debugDescription)
            let option = app.buttons[replace ? "Reemplazar" : "Complementar"]
            let scroll = app.scrollViews.containing(.textView, identifier: "catalog.csv.text").firstMatch
            catalogReveal(option, in: app, scroll: scroll)
            if replace { option.tap() }
            XCTAssertTrue(option.isSelected)
            XCTAssertTrue(commit.isHittable)
            commit.tap()
            XCTAssertTrue(commit.waitForNonExistence(timeout: 5))
            XCTAssertTrue(journalTitle.waitForExistence(timeout: 5))
            XCTAssertEqual(weight.value as? String, value)
            let note = app.descendants(matching: .any)["body.note"].firstMatch
            if replace {
                XCTAssertNotEqual(note.value as? String, "Registro de demostración")
            } else {
                XCTAssertEqual(note.value as? String, "Registro de demostración")
            }
        }
    }

    @MainActor
    private func catalogReveal(_ element: XCUIElement, in app: XCUIApplication, scroll region: XCUIElement? = nil) {
        guard !element.isHittable else { return }
        let scroll: XCUIElement
        if let region {
            scroll = region
        } else if element.exists {
            let matching = app.scrollViews.containing(element.elementType,
                                                     identifier: element.identifier.isEmpty ? element.label : element.identifier)
            scroll = matching.firstMatch.exists ? matching.firstMatch : app.scrollViews.firstMatch
        } else {
            scroll = app.scrollViews.firstMatch
        }

        for _ in 0..<10 where !element.isHittable {
            let frame = scroll.frame.intersection(app.frame)
            let keyboard = app.keyboards.firstMatch
            let tabs = dock(in: app)
            let keyboardTop = keyboard.exists ? keyboard.frame.minY - 50 : frame.maxY
            let tabTop = tabs.exists ? tabs.buttons.firstMatch.frame.minY - 12 : app.frame.maxY - 40
            let bottom = min(frame.maxY - 12, keyboardTop, tabTop)
            let top = frame.minY + 24
            guard bottom - top >= 44 else { break }
            let above = element.exists && element.frame.midY < top
            let x = frame.minX + frame.width * 0.92 - app.frame.minX
            let delta = min(235, (bottom - top) * 0.7)
            let startY = (above ? top : bottom) - app.frame.minY
            let endY = startY + (above ? delta : -delta)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: x, dy: startY))
            let end = origin.withOffset(CGVector(dx: x, dy: endY))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.15)
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    @MainActor
    func testDemoScheduledPhaseSwipeRequiresConfirmation() {
        let app = launch(demo: true)
        selectTab("targets", in: app)
        app.buttons["+ Programar"].tap()
        let name = app.textFields["Nombre de fase"]
        XCTAssertTrue(name.waitForExistence(timeout: 5), app.debugDescription)
        name.tap()
        name.typeText("Fase de prueba")
        let copy = app.buttons["Copiar semana vigente"]
        reveal(copy, in: app)
        copy.tap()
        let save = app.buttons["Guardar"]
        reveal(save, in: app)
        save.tap()

        let phase = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "targets.phase.")).firstMatch
        XCTAssertTrue(phase.waitForExistence(timeout: 5), app.debugDescription)
        reveal(phase, in: app)
        let center = phase.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        center.press(forDuration: 0.06, thenDragTo: center.withOffset(CGVector(dx: -28, dy: 0)))
        XCTAssertFalse(app.buttons["Editar"].isHittable && app.staticTexts["FASE PROGRAMADA"].exists)
        XCTAssertFalse(app.buttons["Borrar fase"].exists)
        phase.tap()
        XCTAssertTrue(app.staticTexts["FASE PROGRAMADA"].waitForExistence(timeout: 5), app.debugDescription)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        XCTAssertTrue(app.staticTexts["FASE PROGRAMADA"].waitForNonExistence(timeout: 5))

        phase.swipeLeft()
        let confirm = app.buttons["Borrar fase"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(app.buttons["Deshacer"].exists)
        app.buttons["Cancelar"].tap()
        XCTAssertTrue(phase.isHittable, app.debugDescription)
        phase.swipeLeft()
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(phase.waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Sin fases programadas"].exists)
    }

    @MainActor
    func testDemoSpecificTargetCanOpenEditSwipeAndUndo() {
        let app = launch(demo: true)
        selectTab("targets", in: app)
        let add = app.buttons["+ Añadir"]
        reveal(add, in: app)
        add.tap()
        let reason = app.textFields["Motivo"]
        XCTAssertTrue(reason.waitForExistence(timeout: 5), app.debugDescription)
        reason.tap()
        reason.typeText("Fecha de prueba")
        let save = app.buttons["Guardar"]
        reveal(save, in: app)
        save.tap()

        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "targets.override.")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        reveal(row, in: app)
        row.tap()
        XCTAssertTrue(app.staticTexts["Fecha de prueba"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["Editar"].tap()
        XCTAssertTrue(reason.waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["Cancelar"].tap()
        XCTAssertTrue(app.staticTexts["Fecha de prueba"].waitForExistence(timeout: 5), app.debugDescription)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()

        row.swipeLeft()
        let undo = app.buttons["Deshacer"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3), app.debugDescription)
        XCTAssertFalse(row.exists)
        XCTAssertFalse(app.buttons["Borrar fase"].exists)
        undo.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(row.label.contains("Fecha de prueba"), row.label)
    }

    @MainActor
    func testDemoDashboardLongRangeLeavesPresetsAndUndoAccessible() {
        let app = launch(demo: true)
        openProgress("Dashboard", in: app)
        let custom = app.buttons["Custom"]
        XCTAssertTrue(custom.waitForExistence(timeout: 5), app.debugDescription)
        custom.tap()
        let manual = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Personalizado…")).firstMatch
        XCTAssertTrue(manual.waitForExistence(timeout: 5), app.debugDescription)
        manual.tap()
        let name = "Rango personalizado de prueba " + String(UUID().uuidString.prefix(8))
        let field = app.textFields["Nombre (opcional)"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        field.tap()
        field.typeText(name)
        app.buttons["Guardar rango"].tap()
        let saved = app.buttons[name]
        XCTAssertTrue(saved.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.buttons["dashboard.preset.Hoy"].isHittable, app.debugDescription)
        XCTAssertLessThanOrEqual(saved.frame.width, 170, app.debugDescription)

        saved.tap()
        let delete = app.buttons["Eliminar rango"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 5), app.debugDescription)
        delete.tap()
        let undo = app.buttons["Deshacer"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3), app.debugDescription)
        undo.tap()
        XCTAssertTrue(saved.waitForExistence(timeout: 3), app.debugDescription)
        saved.tap()
        delete.tap()
        XCTAssertTrue(custom.waitForExistence(timeout: 3), app.debugDescription)
    }

    @MainActor
    func testDemoDashboardChartReopensWithItsSelectedVariable() {
        let app = launch(demo: true)
        openProgress("Dashboard", in: app)
        app.buttons["Mis gráficas"].tap()
        let newChart = dock(in: app).buttons["context.add"]
        XCTAssertTrue(newChart.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(newChart.label, "Nueva gráfica")
        newChart.tap()
        let save = app.buttons["Guardar gráfica"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(save.isEnabled)
        let protein = app.buttons["dashboard.chart.variable.protein_g"]
        let chartForm = app.scrollViews.containing(.button, identifier: "dashboard.chart.variable.protein_g").firstMatch
        revealDashboardControl(protein, in: chartForm, app: app)
        protein.tap()
        XCTAssertTrue(save.isEnabled)
        save.tap()

        let options = app.buttons["Opciones de la gráfica"]
        XCTAssertTrue(options.waitForExistence(timeout: 5), app.debugDescription)
        reveal(options, in: app)
        options.tap()
        app.buttons["Editar"].tap()
        XCTAssertTrue(app.staticTexts["Editar gráfica"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(protein.isSelected, app.debugDescription)
    }

    @MainActor
    func testDemoDashboardRadarTapShowsNutrientPercentage() {
        let app = launch(demo: true)
        openProgress("Dashboard", in: app)
        app.buttons["Análisis estándar"].tap()
        let today = app.buttons["dashboard.preset.Hoy"]
        XCTAssertTrue(today.waitForExistence(timeout: 5), app.debugDescription)
        today.tap()
        let radar = app.descendants(matching: .any).matching(identifier: "dashboard.radar").firstMatch
        XCTAssertTrue(radar.waitForExistence(timeout: 5), app.debugDescription)
        let scroll = app.scrollViews.containing(.any, identifier: "dashboard.radar").firstMatch
        revealDashboardControl(radar, in: scroll, app: app)
        let point = radar.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.48))
        point.tap()
        let value = app.staticTexts["dashboard.radar.value"]
        XCTAssertTrue(value.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(value.label, "Fibra · 50%")
        point.tap()
        XCTAssertTrue(value.waitForNonExistence(timeout: 3), app.debugDescription)
    }

    @MainActor
    private func revealDashboardControl(_ element: XCUIElement, in scroll: XCUIElement, app: XCUIApplication) {
        XCTAssertTrue(scroll.exists && element.exists, app.debugDescription)
        for _ in 0..<12 {
            let viewport = scroll.frame
            let target = CGPoint(x: element.frame.midX, y: element.frame.midY)
            if viewport.insetBy(dx: 0, dy: 24).contains(target) { break }
            let limit = viewport.height * 0.44
            let movement = min(limit, max(-limit, viewport.midY - target.y))
            let from = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5))
            let to = from.withOffset(CGVector(dx: 0, dy: movement))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
        XCTAssertTrue(scroll.frame.insetBy(dx: 0, dy: 24).contains(CGPoint(x: element.frame.midX, y: element.frame.midY)), app.debugDescription)
    }

    @MainActor
    func testDemoPhaseRulePauseDateCanBePickedAndCleared() {
        let app = launch(demo: true)
        selectTab("targets", in: app)
        let rules = app.buttons["Editar reglas"]
        XCTAssertTrue(rules.waitForExistence(timeout: 5), app.debugDescription)
        rules.tap()
        let pause = app.buttons["Pausar reglas hasta"]
        reveal(pause, in: app)
        pause.tap()
        let calendar = wholeCalendar(in: app)
        selectDay(inNextMonthOf: calendar)
        let done = app.buttons["Listo"]
        XCTAssertTrue(done.waitForExistence(timeout: 5), app.debugDescription)
        done.tap()

        let clearDate = app.buttons["Quitar"]
        XCTAssertTrue(clearDate.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertNotNil((pause.value as? String)?.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression))
        clearDate.tap()
        XCTAssertTrue(clearDate.waitForNonExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    private func wholeCalendar(in app: XCUIApplication) -> XCUIElement {
        let calendar = app.datePickers.firstMatch
        XCTAssertTrue(calendar.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertGreaterThanOrEqual(calendar.frame.width, 280)
        return calendar
    }

    @MainActor
    private func selectDay(inNextMonthOf calendar: XCUIElement) {
        let next = calendar.buttons["DatePicker.NextMonth"]
        let heading = calendar.buttons["DatePicker.Show"]
        XCTAssertTrue(next.isHittable, calendar.debugDescription)
        let previous = heading.value as? String ?? ""
        next.tap()
        let changed = NSPredicate(format: "value != %@ AND value != nil", previous)
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: changed, object: heading)], timeout: 5),
                       .completed, calendar.debugDescription)
        let month = (heading.value as? String ?? "")
            .replacingOccurrences(of: #"\s+(?:de\s+)?\d{4}$"#, with: "", options: .regularExpression)
        XCTAssertFalse(month.isEmpty, calendar.debugDescription)
        // The month transition can expose days from both grids in the same snapshot.
        let dayLabel = #"(?i)^(Hoy, )?[^,]+, (8|9|1[0-4]) de "# + NSRegularExpression.escapedPattern(for: month) + "$"
        let days = calendar.buttons.matching(NSPredicate(format: "label MATCHES %@", dayLabel))
        let sevenDays = NSPredicate(format: "count == 7")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: sevenDays, object: days)], timeout: 5),
                       .completed, calendar.debugDescription)
        let week = days.allElementsBoundByAccessibilityElement.filter(\.isHittable)
        let columns = Set(week.map { Int($0.frame.midX.rounded()) })
        XCTAssertEqual(columns.count, 7, calendar.debugDescription)
        week.first?.tap()
    }

    @MainActor
    func testLongPressMovesIntakeToAnotherMeal() {
        let (app, breakfast) = launchDemoWithBreakfastIntake()
        let dinner = app.buttons["Contraer Cena"]
        reveal(dinner, in: app)
        XCTAssertTrue(breakfast.isHittable, app.debugDescription)
        let dinnerBeforeMove = dinner.value as? String
        let from = breakfast.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let to = dinner.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.5))
        from.press(forDuration: 1.0, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.7)
        let updatedDinner = NSPredicate(format: "value != %@", dinnerBeforeMove ?? "")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: updatedDinner, object: dinner)], timeout: 5),
                       .completed, app.debugDescription)
        XCTAssertFalse(app.buttons["Guardar"].exists)
        XCTAssertFalse(app.buttons["Deshacer"].exists)
        dinner.tap()
        XCTAssertTrue(breakfast.waitForNonExistence(timeout: 5), app.debugDescription)
        app.buttons["Expandir Cena"].tap()
        XCTAssertTrue(breakfast.waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    func testSoftwareDecimalKeyboardDonePreservesWaterAmount() {
        let app = launch(demo: true)
        openWater(in: app)
        let settings = app.buttons["today.waterSettings"]
        settings.tap()

        let amount = app.textFields["today.waterSize"]
        XCTAssertTrue(amount.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(amount.value as? String, "350")
        amount.tap()
        let keyboard = app.keyboards.firstMatch
        let decimal = keyboard.keys.matching(NSPredicate(format: "label IN %@", [".", ","])).firstMatch
        XCTAssertTrue(decimal.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertFalse(keyboard.keys["q"].exists)
        decimal.tap()
        keyboard.keys["5"].tap()

        let done = app.buttons["keyboard.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5), app.debugDescription)
        done.tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), app.debugDescription)
        app.buttons["today.waterSave"].tap()
        XCTAssertTrue(amount.waitForNonExistence(timeout: 5), app.debugDescription)

        reveal(settings, in: app)
        settings.tap()
        XCTAssertTrue(amount.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual((amount.value as? String)?.replacingOccurrences(of: ",", with: "."), "350.5")
    }

    @MainActor
    func testRuleCountAndCarbAdjustmentUseDifferentSoftwareKeyboards() {
        let app = launch(demo: true)
        selectTab("targets", in: app)
        let rules = app.buttons["Editar reglas"]
        XCTAssertTrue(rules.waitForExistence(timeout: 5), app.debugDescription)
        rules.tap()
        app.buttons["+ Estancamiento"].tap()

        let days = app.textFields["Días"]
        reveal(days, in: app)
        days.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.keys["1"].waitForExistence(timeout: 5), app.debugDescription)
        let decimal = keyboard.keys.matching(NSPredicate(format: "label IN %@", [".", ","])).firstMatch
        XCTAssertFalse(decimal.exists)
        XCTAssertFalse(keyboard.keys["q"].exists)
        app.buttons["keyboard.done"].tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), app.debugDescription)

        let delta = app.textFields["Δ carbs (g)"]
        reveal(delta, in: app)
        delta.tap()
        let minus = keyboard.keys.matching(NSPredicate(format: "label IN %@", ["-", "−"])).firstMatch
        XCTAssertTrue(minus.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(decimal.exists, app.debugDescription)
        app.buttons["keyboard.done"].tap()
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    private func launchDemoWithBreakfastIntake(longJournal: Bool = false) -> (XCUIApplication, XCUIElement) {
        let app = launch(demo: true, longJournal: longJournal)
        XCTAssertTrue(app.staticTexts["Demo con datos de ejemplo — los cambios se borran solos."].waitForExistence(timeout: 10))
        let intake = app.buttons["today.intake.00000000-0000-4000-8000-000000000100"]
        reveal(intake, in: app)
        return (app, intake)
    }

    @MainActor
    private func reveal(_ intake: XCUIElement, in app: XCUIApplication) {
        catalogReveal(intake, in: app)
    }

    @MainActor
    private func openWater(in app: XCUIApplication) {
        let water = app.buttons["today.waterTotal"]
        XCTAssertTrue(water.waitForExistence(timeout: 5), app.debugDescription)
        water.tap()
        XCTAssertTrue(app.buttons["today.waterSettings"].waitForExistence(timeout: 5), app.debugDescription)
    }

    @MainActor
    private func dock(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "context.dock").firstMatch
    }

    @MainActor
    private func selectTab(_ module: String, in app: XCUIApplication) {
        let dock = dock(in: app)
        XCTAssertTrue(dock.waitForExistence(timeout: 5), app.debugDescription)
        let tab = dock.buttons["module." + module]
        XCTAssertTrue(tab.waitForExistence(timeout: 5), app.debugDescription)
        tab.tap()
    }

    @MainActor
    private func openProgress(_ section: String, in app: XCUIApplication) {
        selectTab("dashboard", in: app)
        let segment = app.segmentedControls.buttons[section]
        XCTAssertTrue(segment.waitForExistence(timeout: 5), app.debugDescription)
        if !segment.isSelected { segment.tap() }
    }

    @MainActor
    private func launch(demo: Bool = false, theme: String = "dark", textSize: String? = nil,
                        longJournal: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_MX",
                               "-nutri.loginLanguage", "es", "-nutri.theme", theme]
        app.launchArguments.append(demo ? "--ios-ui-demo" : "--ios-ui-login")
        if longJournal { app.launchArguments.append("--ios-ui-long-journal") }
        if let textSize {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", textSize]
        }
        app.launch()
        return app
    }

    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
