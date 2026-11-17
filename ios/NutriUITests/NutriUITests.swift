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
        XCTAssertTrue(password.isHittable)
        XCTAssertTrue(submit.isHittable)
        XCTAssertTrue(app.buttons["login.demo"].isHittable)
        capture("01 Login")

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
