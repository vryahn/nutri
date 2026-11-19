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
        XCTAssertFalse(app.buttons["module.today"].exists)
    }

    @MainActor
    func testLocalDemoNavigationAndWaterSettings() {
        let app = launch(demo: true)
        let today = app.buttons["module.today"]
        XCTAssertTrue(today.waitForExistence(timeout: 10))
        XCTAssertTrue(today.isSelected)
        XCTAssertTrue(app.staticTexts["Demo con datos de ejemplo — los cambios se borran solos."].exists)
        capture("02 Hoy")

        for (number, module, heading) in [
            ("03", "foods", "Alimentos"),
            ("04", "recipes", "Recetas"),
            ("05", "targets", "Objetivos"),
            ("06", "dashboard", "Dashboard"),
            ("07", "body", "Medidas del día"),
        ] {
            let tab = app.buttons["module.\(module)"]
            XCTAssertTrue(tab.isHittable)
            tab.tap()
            XCTAssertTrue(app.scrollViews.firstMatch.staticTexts[heading].firstMatch.waitForExistence(timeout: 10), heading)
            XCTAssertTrue(tab.isSelected)
            XCTAssertFalse(today.isSelected)
            capture("\(number) \(heading)")
        }

        today.tap()
        XCTAssertTrue(today.isSelected)
        let settings = app.buttons["today.waterSettings"]
        for _ in 0..<3 where !settings.isHittable { app.swipeUp() }
        XCTAssertTrue(settings.isHittable)
        settings.tap()
        let size = app.textFields["today.waterSize"]
        XCTAssertTrue(size.waitForExistence(timeout: 5))
        XCTAssertEqual(size.value as? String, "350")
        capture("08 Ajustes de agua")
        app.buttons["today.waterSave"].tap()
        XCTAssertTrue(size.waitForNonExistence(timeout: 5))
        XCTAssertTrue(today.isSelected)
    }

    @MainActor
    func testLocalDemoLightTheme() {
        let app = launch(demo: true, theme: "light")
        let today = app.buttons["module.today"]
        XCTAssertTrue(today.waitForExistence(timeout: 10))
        XCTAssertTrue(today.isSelected)
        capture("09 Hoy claro")
    }

    @MainActor
    func testLocalDemoIntakeAllowsVerticalScroll() {
        let (app, intake) = launchDemoWithBreakfastIntake()
        let journal = app.scrollViews.firstMatch
        for direction in [CGFloat(1), -1] {
            // A full downward swipe can carry the intake past the bottom of the viewport.
            for _ in 0..<2 where !intake.isHittable {
                let distance = min(intake.frame.midY - journal.frame.midY, journal.frame.height * 0.5)
                let gutter = journal.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.75))
                gutter.press(forDuration: 0, thenDragTo: gutter.withOffset(CGVector(dx: 0, dy: -distance)),
                             withVelocity: .slow, thenHoldForDuration: 0)
            }
            XCTAssertTrue(intake.isHittable, app.debugDescription)
            let initialY = intake.frame.minY
            if direction > 0 { intake.swipeDown(velocity: .slow) }
            else { intake.swipeUp(velocity: .slow) }
            XCTAssertFalse(app.buttons["Guardar"].exists)
            XCTAssertFalse(app.buttons["Deshacer"].exists)
            XCTAssertTrue(intake.exists, app.debugDescription)
            XCTAssertGreaterThan(direction * (intake.frame.minY - initialY), 16, app.debugDescription)
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
        let foods = app.buttons["module.foods"]
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
    func testLocalDemoSummaryCanBeReopenedFromMiniAndClosed() {
        let app = launch(demo: true)
        let customize = app.buttons["Personalizar resumen"]
        XCTAssertTrue(customize.waitForExistence(timeout: 10))
        let mini = app.buttons["today.fixedSummary"]
        let journal = app.scrollViews.firstMatch
        for _ in 0..<3 where !mini.isHittable { journal.swipeUp() }
        XCTAssertTrue(mini.isHittable, app.debugDescription)
        mini.tap()
        XCTAssertTrue(mini.waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(customize.isHittable, app.debugDescription)
        customize.tap()
        let close = app.buttons["sheet.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5), app.debugDescription)
        close.tap()
        XCTAssertTrue(close.waitForNonExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(customize.isHittable)
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
        let water = app.staticTexts["today.waterTotal"]
        let journal = app.scrollViews.firstMatch
        for _ in 0..<3 where !water.isHittable { journal.swipeDown() }
        XCTAssertTrue(water.isHittable, app.debugDescription)
        XCTAssertTrue(water.label.hasPrefix("0 ml"), water.label)
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
        XCTAssertEqual(app.buttons["module.today"].label, "Today")
        let customWater = app.textFields["Amount (fl oz)"]
        let journal = app.scrollViews.firstMatch
        XCTAssertTrue(customWater.waitForExistence(timeout: 5), app.debugDescription)
        for _ in 0..<3 where !customWater.isHittable {
            let start = journal.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.55))
            let delta = min(135, max(-135, journal.frame.midY - customWater.frame.midY))
            let end = start.withOffset(CGVector(dx: 0, dy: delta))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        XCTAssertTrue(customWater.isHittable, app.debugDescription)
    }

    @MainActor
    func testFoodCSVImportsOnlyValidRowsAndSupportsSwipeUndo() {
        let app = launch(demo: true)
        app.buttons["module.foods"].tap()
        let search = app.textFields["foods.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10))
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
        app.buttons["module.foods"].tap()
        let create = app.buttons["Nuevo alimento"]
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
        app.buttons["module.recipes"].tap()
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
        app.buttons["module.body"].tap()
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
        // Reopen the module with the extra measurements collapsed.
        app.buttons["module.today"].tap()
        app.buttons["module.body"].tap()
        let fat = app.textFields["body.metric.grasa_pct"]
        XCTAssertTrue(fat.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertEqual(fat.value as? String, "20.5")
        XCTAssertTrue(app.buttons["Más medidas ▾"].exists)
        XCTAssertTrue(favorite.isSelected)
    }

    @MainActor
    func testBodyCSVComplementThenReplaceExistingDay() {
        let app = launch(demo: true)
        app.buttons["module.body"].tap()
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
        let scroll = region ?? app.scrollViews.firstMatch
        for _ in 0..<10 where !element.isHittable {
            let above = element.exists && element.frame.midY < scroll.frame.midY
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: above ? 0.30 : 0.72))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: above ? 0.72 : 0.30))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.15)
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    @MainActor
    func testDemoScheduledPhaseSwipeRequiresConfirmation() {
        let app = launch(demo: true)
        app.buttons["module.targets"].tap()
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
        app.buttons["module.targets"].tap()
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
        app.buttons["module.dashboard"].tap()
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
        app.buttons["module.dashboard"].tap()
        app.buttons["Mis gráficas"].tap()
        let newChart = app.buttons["+ Nueva"]
        XCTAssertTrue(newChart.waitForExistence(timeout: 5), app.debugDescription)
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
        app.buttons["module.dashboard"].tap()
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
        app.buttons["module.targets"].tap()
        let rules = app.buttons["Editar reglas"]
        XCTAssertTrue(rules.waitForExistence(timeout: 5), app.debugDescription)
        rules.tap()
        let pause = app.buttons["Pausar reglas hasta"]
        reveal(pause, in: app)
        pause.tap()
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
        let settings = app.buttons["today.waterSettings"]
        reveal(settings, in: app)
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
        app.buttons["module.targets"].tap()
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
    private func launchDemoWithBreakfastIntake() -> (XCUIApplication, XCUIElement) {
        let app = launch(demo: true)
        XCTAssertTrue(app.staticTexts["Demo con datos de ejemplo — los cambios se borran solos."].waitForExistence(timeout: 10))
        let intake = app.buttons["today.intake.00000000-0000-4000-8000-000000000100"]
        reveal(intake, in: app)
        return (app, intake)
    }

    @MainActor
    private func reveal(_ intake: XCUIElement, in app: XCUIApplication) {
        let journal = app.scrollViews.firstMatch
        for _ in 0..<4 where !intake.isHittable { journal.swipeUp() }
        XCTAssertTrue(intake.isHittable, app.debugDescription)
    }

    @MainActor
    private func launch(demo: Bool = false, theme: String = "dark") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_MX",
                               "-nutri.loginLanguage", "es", "-nutri.theme", theme]
        if demo { app.launchArguments.append("--ios-ui-demo") }
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
