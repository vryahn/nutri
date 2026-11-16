import AppKit
import Foundation
import NutriCore

// This path is only available in the separate check executable. The entry points
// require the repository's designated fixture credentials and explicit opt-in.
enum LiveWriteChecks {
    static func run() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["NUTRI_WRITE_FIXTURE_ACCOUNT"] == "1",
              let base = env["VITE_SUPABASE_URL"].flatMap(URL.init(string:)), base.scheme == "https",
              let key = env["VITE_SUPABASE_ANON_KEY"], key.hasPrefix("sb_publishable_"),
              let username = env["VITE_DEV_EMAIL"], !username.isEmpty,
              let password = env["VITE_DEV_PASSWORD"], !password.isEmpty,
              let ai = URL(string: "https://nutri.vryahn.com/api/ai") else {
            throw CheckError.failure("Live-write check needs explicit opt-in and designated test-account credentials.")
        }
        let client = Supabase(configuration: NutriConfiguration(database: base, publishableKey: key, ai: ai))
        let session = try await client.signIn(email: username, password: password)
        let owner = session.user.id
        do {
            guard session.user.is_anonymous != true, session.user.email?.lowercased() == username.lowercased() else {
                throw CheckError.failure("Designated test-account identity could not be established.")
            }
            let fixture = Fixture(owner: owner)
            try await fixture.preflight(client)
            let check: Error?
            do {
                try await fixture.writeAndVerify(client)
                check = nil
            } catch {
                check = error
            }
            let failures = await fixture.clean(client)
            if !failures.isEmpty {
                try fixture.writeCleanupReport(failures)
                throw CheckError.failure("Fixture cleanup not verified. See the private cleanup report printed above.")
            }
            print("Live write cleanup: all synthetic rows and the private object verified absent.")
            if let check { throw check }
            let revoked = try await client.signOut(owner: owner)
            try require(revoked, "Remote fixture session logout failed.")
        } catch {
            _ = try? await client.signOut(owner: owner)
            throw error
        }
    }

    private struct Fixture {
        let owner: String
        let tag = "nutri-native-check-" + UUID().uuidString.lowercased()
        let foodID = UUID().uuidString.lowercased()
        let entryID = UUID().uuidString.lowercased()
        let targetID = UUID().uuidString.lowercased()
        let bodyID = UUID().uuidString.lowercased()
        let day = String(format: "2199-%02d-%02d", Int.random(in: 1...12), Int.random(in: 1...28))
        var photo: String { owner + "/" + tag + ".jpg" }
        var photoURL: String { "object/authenticated/body-photos/" + photo }
        var ownerFilter: [String: String] { ["owner": "eq." + owner] }

        private var cleanupRows: [(table: String, filter: [String: String])] {
            [
                ("entries", ["id": "eq." + entryID, "food_id": "eq." + foodID]),
                ("body_metrics", ["id": "eq." + bodyID, "day": "eq." + day, "note": "eq." + tag]),
                ("targets", ["id": "eq." + targetID, "day": "eq." + day, "label": "eq." + tag]),
                ("recipes", ["name": "eq." + tag]),
                ("foods", ["id": "eq." + foodID, "name": "eq." + tag])
            ]
        }

        func preflight(_ client: Supabase) async throws {
            for item in cleanupRows {
                let filter = item.filter["id"].map { ["id": $0] } ?? item.filter
                let matches = try await read(client, item.table, filter)
                try require(matches.isEmpty, "Pre-flight fixture identity collision.")
            }
            for table in ["targets", "body_metrics", "entries"] {
                let matches = try await read(client, table, ["day": "eq." + day])
                try require(matches.isEmpty, "Pre-flight fixture date collision.")
            }
            let absent = try await photoAbsent(client)
            try require(absent, "Pre-flight synthetic object path already exists.")
        }

        func writeAndVerify(_ client: Supabase) async throws {
            let food: Record = [
                "id": .string(foodID), "owner": .string(owner), "name": .string(tag), "source": .string("manual"),
                "kcal": .number(54), "protein_g": .number(5.7), "carbs_g": .number(6), "fat_g": .number(0.65),
                "micros": .object(["sodio_mg": .number(10), "potasio_mg": .number(0)]),
                "portions": .array([.object(["name": .string("Fixture"), "grams": .number(150)])])
            ]
            try await insert(client, "foods", food, id: foodID)
            let entry: Record = ["id": .string(entryID), "owner": .string(owner), "day": .string(day),
                                 "food_id": .string(foodID), "recipe_id": .null, "grams": .number(150)]
            try await insert(client, "entries", entry, id: entryID)
            let original = try await read(client, "entry_nutrients", ["id": "eq." + entryID]).first
            try require(original?.number("protein_g") == 8.55 && original?.object("micros").number("sodio_mg") == 15,
                        "Live 150 g entry projection mismatch.")
            let edited = try await client.rows("PATCH", "entries", query: ownerFilter.merging(["id": "eq." + entryID]) { _, new in new },
                body: .object(["grams": .number(225)]), prefer: "return=representation", owner: owner)
            let projection = try await read(client, "entry_nutrients", ["id": "eq." + entryID]).first
            try require(edited.count == 1 && projection?.number("protein_g") == 12.83 &&
                        Domain.coverage(projection ?? [:], "potasio_mg") == .complete &&
                        Domain.coverage(projection ?? [:], "calcio_mg") == .unknown, "Live PATCH/canonical SQL coverage mismatch.")
            print("Live writes: food + 150 g entry + 225 g edit and SQL nutrient read-back passed.")

            let recipe: Record = ["p_recipe_id": .null, "p_name": .string(tag), "p_cooked_weight_g": .number(200),
                                  "p_portions": .array([]), "p_source": .string("manual"),
                                  "p_items": .array([.object(["food_id": .string(foodID), "grams": .number(150)])])]
            let result = try await client.rpc("save_recipe_atomic", recipe, owner: owner)
            guard let recipeID = result.string, UUID(uuidString: recipeID) != nil else {
                throw CheckError.failure("Recipe atomic RPC did not return UUID.")
            }
            let per100 = try await client.rows("GET", "recipe_per_100g", query: ["recipe_id": "eq." + recipeID], owner: owner)
            try require(per100.first?.number("kcal") == 40.5, "Live recipe projection mismatch.")
            print("Live writes: atomic recipe RPC and cooked-weight read-back passed.")

            let target: Record = ["id": .string(targetID), "owner": .string(owner), "day": .string(day),
                                  "valid_from": .string(day), "label": .string(tag), "kcal": .number(2100),
                                  "bounds": .object(["sodio_mg": .object(["min": .number(Domain.sodiumFloor)])])]
            try await insert(client, "targets", target, id: targetID)
            let targets = try await read(client, "targets", ["day": "eq." + day])
            try require(Domain.resolveTarget(targets, day)?.text("id") == targetID, "Live daily target read-back mismatch.")

            let jpeg = try tinyJPEG()
            _ = try await client.storage("POST", "object/body-photos/" + photo, body: jpeg, contentType: "image/jpeg", owner: owner)
            let downloaded = try await client.storage("GET", photoURL, owner: owner)
            try require(downloaded == jpeg, "Live private storage content mismatch.")
            let body: Record = ["id": .string(bodyID), "owner": .string(owner), "day": .string(day), "note": .string(tag),
                                "metrics": .object(["peso_kg": .number(73)]), "photo_paths": .array([.string(photo)])]
            try await insert(client, "body_metrics", body, id: bodyID)
            let saved = try await read(client, "body_metrics", ["id": "eq." + bodyID]).first
            try require(saved?.object("metrics").number("peso_kg") == 73 && saved?.array("photo_paths") == [.string(photo)],
                        "Live body/private photo read-back mismatch.")
            print("Live writes: unique dated target, body metric and private JPG passed.")
        }

        func clean(_ client: Supabase) async -> [String] {
            var failures: [String] = []
            for item in cleanupRows {
                do {
                    let candidates = try await read(client, item.table, item.filter)
                    for row in candidates {
                        let id = row.text("id")
                        guard UUID(uuidString: id) != nil else { throw CheckError.failure("Fixture deletion lacked exact UUID.") }
                        let filter = ownerFilter.merging(item.filter) { _, new in new }.merging(["id": "eq." + id]) { _, new in new }
                        _ = try await client.rows("DELETE", item.table, query: filter, prefer: "return=representation", owner: owner)
                    }
                    let identity = item.filter["id"].map { ["id": $0] } ?? item.filter
                    let remaining = try await read(client, item.table, identity)
                    try require(remaining.isEmpty, "Fixture row still exists.")
                } catch { failures.append(item.table) }
            }
            var storageStep = "pre-delete read"
            do {
                let existed = try await !photoAbsent(client)
                if existed {
                    storageStep = "delete"
                    let payload = try JSONEncoder().encode(["prefixes": [photo]])
                    _ = try await client.storage("DELETE", "object/body-photos", body: payload, contentType: "application/json", owner: owner)
                    storageStep = "post-delete read"
                    var absent = false
                    for attempt in 0..<4 {
                        if attempt > 0 { try await Task.sleep(for: .milliseconds(attempt * 300)) }
                        absent = try await photoAbsent(client)
                        if absent { break }
                    }
                    try require(absent, "Private fixture still exists.")
                }
            } catch {
                let http = (error as? NutriError)?.status.map(String.init) ?? "no HTTP code"
                print("Storage fixture verification failed at \(storageStep) (\(http)).")
                failures.append("body-photos")
            }
            return failures
        }

        func writeCleanupReport(_ failures: [String]) throws {
            let path = FileManager.default.temporaryDirectory.appendingPathComponent(tag + ".txt")
            let records = cleanupRows.map { item in
                "\(item.table): \(item.filter.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))"
            }.joined(separator: "\n")
            let body = "Unverified cleanup: \(failures.joined(separator: ", "))\nOwner: \(owner)\n\(records)\nObject: \(photo)\n"
            guard FileManager.default.createFile(atPath: path.path, contents: Data(body.utf8), attributes: [.posixPermissions: 0o600]) else {
                throw CheckError.failure("Could not write private cleanup report.")
            }
            print("Private cleanup report: \(path.path)")
        }

        private func insert(_ client: Supabase, _ table: String, _ body: Record, id: String) async throws {
            let result = try await client.rows("POST", table, body: .object(body), prefer: "return=representation", owner: owner)
            try require(result.count == 1 && result.first?.text("id") == id, "Fixture insert did not confirm expected UUID.")
        }

        private func read(_ client: Supabase, _ table: String, _ query: [String: String]) async throws -> [Record] {
            try await client.rows("GET", table, query: ownerFilter.merging(query) { _, new in new }, owner: owner)
        }

        private func photoAbsent(_ client: Supabase) async throws -> Bool {
            do {
                _ = try await client.storage("GET", photoURL,
                                             query: ["native_verify": UUID().uuidString.lowercased()], owner: owner)
                return false
            } catch let error as NutriError where error.status == 404
                || (error.status == 400 && ["not_found", "nosuchkey"].contains(error.code?.lowercased() ?? "")) {
                return true
            }
        }

        private func tinyJPEG() throws -> Data {
            guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2,
                    bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
                throw CheckError.failure("Synthetic JPEG allocation failed.")
            }
            let white = NSColor(deviceRed: 1, green: 1, blue: 1, alpha: 1)
            for x in 0..<2 { for y in 0..<2 { bitmap.setColor(white, atX: x, y: y) } }
            guard let bytes = bitmap.representation(using: .jpeg, properties: [:]) else { throw CheckError.failure("Synthetic JPEG encoding failed.") }
            return bytes
        }
    }
}
