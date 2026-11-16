#if DEBUG
import AppKit
import SwiftUI
import NutriCore

/// Renders our own view tree in a test host. This does not capture or automate other applications.
@MainActor
func runSnapshotChecks() {
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    Task { @MainActor in
        do {
            let environment = ProcessInfo.processInfo.environment
            let directory = URL(fileURLWithPath: environment["NUTRI_SNAPSHOT_DIR"] ?? "/tmp/nutri-native-snapshots", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let fixture = try environment["NUTRI_SNAPSHOT_FIXTURE"].map { try DemoData(fixture: URL(fileURLWithPath: $0)) } ?? DemoData()
            let widths = environment["NUTRI_SNAPSHOT_WIDTHS"]?.split(separator: ",").compactMap { Double($0) } ?? [1280, 768, 390]
            let extra: [(Module, String)] = [
                (.foods, "food-editor"), (.foods, "food-import"),
                (.recipes, "recipe-editor"), (.body, "body-import"),
                (.today, "today-add"), (.today, "today-edit"), (.today, "today-summary"),
                (.today, "today-goals"), (.today, "today-mini"),
                (.today, "settings-profile"), (.today, "settings-region"), (.today, "settings-config"),
                (.targets, "targets-editor"), (.targets, "targets-rules"), (.targets, "targets-wizard"),
                (.dashboard, "dashboard-chart"), (.dashboard, "dashboard-report"), (.dashboard, "dashboard-ask")
            ]
            for dark in [true, false] {
                let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)!
                app.appearance = appearance
                for width in widths {
                    let degraded = environment["NUTRI_SNAPSHOT_DEGRADED"] == "1"
                        ? Module.allCases.flatMap { module in ["loading", "error"].map { (module, "\(module)-\($0)") } } : []
                    let scenarios = Module.allCases.map { ($0, "") } + (environment["NUTRI_SNAPSHOT_STATES"] == "1" ? extra : []) + degraded
                    for (module, scenario) in scenarios {
                        let store = Store(snapshot: fixture)
                        store.snapshotScenario = scenario
                        let size = NSSize(width: width, height: 900)
                        let view = RootView(initialModule: module)
                            .environmentObject(store)
                            .environment(\.colorScheme, dark ? .dark : .light)
                            .environment(\.locale, Locale(identifier: store.lang == "en" ? "en_US" : "es_MX"))
                            .frame(width: size.width, height: size.height)
                        let host = NSHostingView(rootView: view)
                        host.appearance = appearance
                        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
                        window.isReleasedWhenClosed = false
                        window.appearance = appearance
                        window.contentView = host
                        // Allow the real view's asynchronous fixture loads and layout to finish.
                        try await Task.sleep(for: .milliseconds(800))
                        host.layoutSubtreeIfNeeded()
                        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw NutriError("Cannot allocate view bitmap") }
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw NutriError("Cannot encode view bitmap") }
                        let name = "\(scenario.isEmpty ? String(describing: module) : scenario)-\(dark ? "dark" : "light")-\(Int(width)).png"
                        try png.write(to: directory.appendingPathComponent(name))
                        window.close()
                        print("Rendered \(name)")
                    }
                }
            }
            exit(0)
        } catch {
            FileHandle.standardError.write(Data("Snapshot checks failed: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
    app.run()
}
#endif
