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
        let initialY = intake.frame.minY
        let start = intake.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: 56))
        start.press(forDuration: 0.08, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertFalse(app.buttons["Guardar"].exists)
        XCTAssertFalse(app.buttons["Deshacer"].exists)
        XCTAssertTrue(intake.exists, app.debugDescription)
        XCTAssertGreaterThan(intake.frame.minY, initialY + 16, app.debugDescription)
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
