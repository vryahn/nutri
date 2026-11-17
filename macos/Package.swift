// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Nutri",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "NutriCore", targets: ["NutriCore"])],
    targets: [
        .target(name: "NutriCore", resources: [.process("Resources")]),
        .executableTarget(name: "Nutri", dependencies: ["NutriCore"], path: "Sources/NutriApp", resources: [
            .copy("Resources/Fonts"), .copy("Resources/Icons")
        ]),
        .executableTarget(name: "NutriChecks", dependencies: ["NutriCore"], path: "Tests/NutriChecks", resources: [.process("Fixtures")])
    ]
)
