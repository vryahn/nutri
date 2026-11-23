import Foundation
import NutriCore

enum CheckError: Error { case failure(String) }

func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw CheckError.failure(message) }
}

@main
struct NutriChecks {
    static func main() async {
        let liveWrite = CommandLine.arguments.contains("--live-write-checks")
        let live = liveWrite || CommandLine.arguments.contains("--live")
        do {
            if liveWrite {
                try await LiveWriteChecks.run()
            } else if live {
                try await liveReadOnly()
            } else {
                let checked = try checkWebDomain()
                try checkSQLBoundaries()
                try checkCSV()
                try checkOutbox()
                try checkPrompts()
                try await checkSessionExpiry()
                try await checkTransport(useKeychain: CommandLine.arguments.contains("--keychain"))
                print("NutriChecks: \(checked) web comparisons, SQL edges, CSV, FIFO persistence/isolation, auth and REST passed.")
            }
        } catch let CheckError.failure(message) {
            FileHandle.standardError.write(Data(("NutriChecks: " + message + "\n").utf8))
            exit(1)
        } catch {
            // Never emit server error bodies, credentials, tokens or private row contents during live checks.
            let message = live ? "Live check failed (\(type(of: error)))." : error.localizedDescription
            FileHandle.standardError.write(Data(("NutriChecks: " + message + "\n").utf8))
            exit(1)
        }
    }

    private struct WebOracle: Decodable { let cases: [Case] }
    private struct Case: Decodable {
        let name: String
        let fn: String
        let args: [JSONValue]
        let expected: JSONValue
    }

    private static func checkWebDomain() throws -> Int {
        let url = Bundle.module.url(forResource: "web-domain", withExtension: "json")!
        let oracle = try JSONDecoder().decode(WebOracle.self, from: Data(contentsOf: url))
        for test in oracle.cases {
            let args = test.args
            let row = args[0].object ?? [:]
            let computed: JSONValue
            let expected: JSONValue
            switch test.fn {
            case "isWaterSentinel":
                computed = .bool(Domain.water(row))
                expected = test.expected
            case "isWaterEntry":
                computed = .bool(Domain.waterEntry(row, waterID: args[1].string ?? ""))
                expected = test.expected
            case "kcalFromMacros":
                computed = .number(Domain.kcalFromMacros(row))
                expected = test.expected
            case "componentsInconsistent":
                computed = Domain.componentsInconsistent(row).map(JSONValue.string) ?? .null
                expected = test.expected
            case "kcalSuspicious":
                computed = .bool(Domain.kcalSuspicious(row))
                expected = test.expected
            case "macrosImplausible":
                computed = .bool(Domain.macrosImplausible(row))
                expected = test.expected
            case "entryNutrients":
                computed = .object(Domain.scaled(args[1].object ?? [:], grams: row.number("grams") ?? 0))
                let keys = Set(Domain.macroKeys + ["micros", "micros_complete"])
                expected = .object((test.expected.object ?? [:]).filter { keys.contains($0.key) })
            case "microCoverage":
                computed = .string(Domain.coverage(row, args[1].string ?? "").rawValue)
                expected = test.expected
            case "microCoverageForEntries":
                computed = .string(Domain.coverage(Domain.totals(args[0].array?.compactMap(\.object) ?? []), args[1].string ?? "").rawValue)
                expected = test.expected
            case "computeRecipePer100g":
                let items = (args[0].array?.compactMap(\.object) ?? []).map {
                    (food: $0.object("food"), grams: $0.number("grams") ?? 0)
                }
                computed = Domain.recipePer100g(items, cookedWeight: args[1].number).map(JSONValue.object) ?? .null
                expected = test.expected
            case "resolveTarget":
                computed = Domain.resolveTarget(args[0].array?.compactMap(\.object) ?? [], args[1].string ?? "").map(JSONValue.object) ?? .null
                expected = test.expected
            case "normalizeTo100":
                if let grams = Domain.grams(args[1].number ?? 0, unit: args[2].string ?? "", density: row.number("density_g_ml")) {
                    if grams == 100 { computed = .object(row) }
                    else {
                        let normalized = Domain.scaled(row, grams: 10000 / grams).filter { $0.key != "micros_complete" }
                        computed = .object(row.merging(normalized) { _, new in new })
                    }
                } else { computed = .null }
                expected = test.expected
            case "classifyNutrient":
                let key = args[0].string ?? ""
                let options = args[3].object ?? [:]
                var target: Record = ["bounds": .object([key: .object(options.object("bounds"))])]
                if let point = args[2].number { target[key] = .number(point) }
                target["goal"] = options["goal"]
                computed = Domain.classify(key, value: args[1].number ?? 0, target: target, hasFood: options["hasFood"]?.bool ?? true).map { .string($0.rawValue) } ?? .null
                expected = test.expected
            case "classifySodium":
                computed = Domain.classify("sodio_mg", value: args[0].number ?? 0, target: nil, hasFood: args[1].bool ?? false).map {
                    .string($0.rawValue)
                } ?? .null
                expected = test.expected
            case "coupledBandMacros":
                computed = args[1].number.flatMap { Domain.coupledBand(row, energy: $0) }.map(JSONValue.object) ?? .null
                expected = test.expected
            case "evalRules":
                computed = rulesDecision(phaseProposal(args[0].object ?? [:]))
                expected = rulesDecision(webDecision: test.expected)
            default: throw CheckError.failure("Unrecognized web oracle: " + test.fn)
            }
            try require(equivalent(computed, expected), "Web oracle mismatch: " + test.name)
        }
        return oracle.cases.count
    }

    // Native phaseProposal receives the vigente phase explicitly; derive it like web evalRules does.
    private static func phaseProposal(_ input: Record) -> PhaseProposal? {
        let targets = input.array("targets").compactMap(\.object)
        let today = input.text("todayISO")
        guard let date = Day.date(today),
              let vigente = targets.filter({ $0.number("dow") != nil && $0.text("valid_from") <= today }).map({ $0.text("valid_from") }).max()
        else { return nil }
        let phase = targets.filter { $0.number("dow") != nil && $0.text("valid_from") == vigente }
        return NutriCore.phaseProposal(targets: targets, phase: phase, body: input.array("bodyMetrics").compactMap(\.object),
                                       totals: input.array("dailyTotals").compactMap(\.object), today: date)
    }

    // Decision fields only (never the free-text reason): fired?, rule id, per-dow kcal/carbs/goal/valid_from.
    private static func decision(rule: String, rows: [Record]) -> JSONValue {
        .object(["rule": .string(rule), "rows": .array(rows.sorted { ($0.number("dow") ?? 0) < ($1.number("dow") ?? 0) }.map {
            .object(["dow": $0["dow"] ?? .null, "kcal": $0["kcal"] ?? .null, "carbs_g": $0["carbs_g"] ?? .null,
                     "goal": $0["goal"] ?? .null, "valid_from": $0["valid_from"] ?? .null])
        })])
    }

    private static func rulesDecision(_ proposal: PhaseProposal?) -> JSONValue {
        guard let proposal else { return .null }
        // applied_rule is "<id> · <reason>"; a review-only proposal (no rows) is always the deficit guardrail.
        let id = proposal.rows.first?.text("applied_rule").components(separatedBy: " · ").first ?? "proteccion-ritmo"
        return decision(rule: id, rows: proposal.rows)
    }

    private static func rulesDecision(webDecision: JSONValue) -> JSONValue {
        guard let result = webDecision.object else { return .null }
        let id = result.array("rows").first?.object?.text("applied_rule").components(separatedBy: " · ").first ?? result.text("rule")
        return decision(rule: id, rows: result.array("rows").compactMap(\.object))
    }

    private static func equivalent(_ left: JSONValue, _ right: JSONValue) -> Bool {
        if case let .number(a) = left, case let .number(b) = right { return abs(a - b) < 0.000001 }
        if let a = left.object, let b = right.object, a.keys == b.keys {
            return a.allSatisfy { key, value in b[key].map { equivalent(value, $0) } ?? false }
        }
        return left == right
    }

    private static func checkSQLBoundaries() throws {
        let fiveGrams = Domain.scaled(["protein_g": .number(5.7)], grams: 5)
        try require(fiveGrams.number("protein_g") == 0.29, "SQL round(5 × 5.7/100, 2)")
        let threeGrams = Domain.scaled(["protein_g": .number(5.5)], grams: 3)
        try require(threeGrams.number("protein_g") == 0.17, "SQL numeric half rounding")
        let food: Record = ["micros": .object(["sodio_mg": .number(0.001)])]
        let recipe = Domain.recipePer100g([(food, 50), (food, 50)], cookedWeight: 100)
        try require(recipe?.object("micros").number("sodio_mg") == 0.002, "SQL recipe rounds micros per ingredient")
        let repeated: Record = ["id": .string("fixture"), "kcal": .number(100),
                                "micros": .object(["sodio_mg": .number(0.04)])]
        let grouped = Domain.groupedRecipeIngredients([(repeated, 1), (repeated, 1)])
        let preview = Domain.recipePer100g([(repeated, 1), (repeated, 1)], cookedWeight: 2)
        let saved = Domain.recipePer100g(grouped, cookedWeight: 2)
        try require(grouped.count == 1 && grouped.first?.grams == 2 && preview == saved &&
                    preview?.object("micros").number("sodio_mg") == 0.05, "duplicate recipe food groups before SQL micro rounding")
        let cooked = Domain.recipePer100g([(repeated, 100), (repeated, 100)], cookedWeight: 160)
        try require(cooked?.number("kcal") == 125 && cooked.map { Domain.scaled($0, grams: 80).number("kcal") == 100 } == true,
                    "cooked recipe matches 125 kcal per 100 g and 100 kcal per 80 g")
        let sodium: Record = ["micros": .object(["sodio_mg": .number(0.007)])]
        let cookedTie = Domain.recipePer100g([(sodium, 100)], cookedWeight: 56)
        try require(cookedTie?.object("micros").number("sodio_mg") == 0.012,
                    "SQL rounds the reciprocal of the cooked weight before scaling micros")
        let iron: Record = ["micros": .object(["hierro_mg": .number(0.0145)])]
        let unreported: Record = ["micros": .object([:])]
        let rawTie = Domain.recipePer100g([(iron, 100), (unreported, 20)], cookedWeight: nil)
        try require(rawTie?.object("micros").number("hierro_mg") == 0.012 &&
                    rawTie.map { Domain.coverage($0, "hierro_mg") } == .partial,
                    "SQL rounds the reciprocal of the summed weight and retains partial coverage")
        let recurring: Record = ["dow": .number(0), "valid_from": .string("2026-11-09")]
        let override: Record = ["day": .string("2026-11-16"), "valid_from": .string("2026-11-16")]
        let future: Record = ["dow": .number(0), "valid_from": .string("2026-11-23")]
        let candidates = [recurring, override, future]
        try require(Domain.resolveTarget(candidates, "2026-11-16") == override &&
                    Domain.activePhase(candidates, day: "2026-11-16") == [recurring], "Daily override leaves active review phase intact")
        let grams = Domain.grams(28.35 / Domain.gramsPerOunce, unit: "oz")
        try require(Domain.grams(1, unit: "oz") == 28.3495 && Domain.grams(1, unit: "fl oz", density: 1) == 29.5735, "US amount conversion matches web i18n constants")
        try require(grams.map { abs($0 - 28.35) < 0.000001 } == true, "US mass round-trip")
        let ounces = Domain.grams(250 / Domain.mlPerFluidOunce, unit: "fl oz", density: 1)
        try require(ounces.map { abs($0 - 250) < 0.000001 } == true, "US volume round-trip")
        let today = Date()
        try require(Day.date(Day.key(today)) != nil && Day.date("2026-02-31") == nil, "Local calendar validates dates")
        try require(Domain.micros.count == 108, "Canonical 108 micronutrient keys")
    }

    private static func checkCSV() throws {
        let input = "\u{FEFF}name,note,value\r\n\"A, B\",\"first\nsecond \"\"quote\"\"\",0\r\n"
        let rows = try CSV.parse(input)
        try require(rows.count == 1 && rows[0]["name"] == "A, B" &&
                    rows[0]["note"] == "first\nsecond \"quote\"" && rows[0]["value"] == "0", "CSV BOM/quotes/newline/zero")
        let roundTrip = try CSV.parse(CSV.encode([["name", "note"], ["A, B", "x\ny"]]))
        try require(roundTrip.first?["note"] == "x\ny", "CSV export round trip")
        let short = try CSV.parse("name,note\na")
        try require(short == [["name": "a", "note": ""]], "CSV short rows match web empty-cell behavior")
        let headers = try CSV.parse("name,Name,name\n oats , Rice , rye ")
        try require(headers == [["name": "rye", "Name": "Rice"]], "CSV header case, duplicate and trimming match web")
        let openQuote = try CSV.parse("name\n\"broken")
        try require(openQuote == [["name": "broken"]], "CSV unfinished quoted cell matches web preview")

    }

    private static func checkPrompts() throws {
        let food = Domain.prompts["food"] ?? "", recipe = Domain.prompts["recipe"] ?? ""
        try require(!food.isEmpty && !recipe.isEmpty, "AI prompts present in contracts")
        try require(food.contains("{{name_lang}}"), "Food prompt keeps name-language placeholder")
        try require(recipe.contains("{{catalog}}") && recipe.contains("{{name_lang}}"), "Recipe prompt keeps catalog/name-language placeholders")
        try require(!food.contains("${") && !recipe.contains("${"), "AI prompts have no unresolved JS interpolation")
    }

    private static func checkSessionExpiry() async throws {
        let log = SendableCounter()
        let refreshStatus = SendableCounter()
        refreshStatus.value = 400
        MockHTTP.handler = { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/token") {
                log.increment()
                if refreshStatus.value == 400 {
                    return (400, #"{"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}"#)
                }
                return (refreshStatus.value, #"{"message":"unavailable"}"#)
            }
            return (200, "[]")
        }
        defer { MockHTTP.handler = nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        let uid = "00000000-0000-4000-8000-000000000042"
        let auth = try JSONDecoder().decode(AuthSession.self, from: Data(
            #"{"access_token":"old","refresh_token":"old-refresh","expires_in":0,"user":{"id":"\#(uid)"}}"#.utf8))
        func client() -> Supabase {
            Supabase(configuration: NutriConfiguration(database: URL(string: "https://nutri.test")!,
                publishableKey: "public-test-key", ai: URL(string: "https://nutri.test/api/ai")!),
                session: StoredSession(auth, receivedAt: Date(timeIntervalSince1970: 0)), http: URLSession(configuration: configuration))
        }
        let expired = client()
        for attempt in 1...2 {
            do {
                _ = try await expired.rows("GET", "entries", owner: uid)
                throw CheckError.failure("Revoked refresh token accepted.")
            } catch let error as NutriError {
                try require(error.code == Supabase.sessionExpiredCode, "Rejected refresh token reports session_expired (attempt \(attempt))")
            }
        }
        try require(log.value == 1, "Expired session is not refreshed again after the rejection")
        refreshStatus.value = 503
        let transient = client()
        do {
            _ = try await transient.rows("GET", "entries", owner: uid)
            throw CheckError.failure("Unavailable refresh accepted.")
        } catch let error as NutriError {
            try require(error.code != Supabase.sessionExpiredCode && error.status == 503, "503 on refresh does not expire the session")
        }
        do {
            _ = try await transient.rows("GET", "entries", owner: uid)
            throw CheckError.failure("Unavailable refresh accepted.")
        } catch let error as NutriError {
            try require(error.code != Supabase.sessionExpiredCode, "Session survives transient refresh failures")
        }
    }

    private static func checkOutbox() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let owner = UUID().uuidString
        let other = UUID().uuidString
        let entry = UUID().uuidString
        let day = "2026-11-16"
        let original: Record = ["id": .string(entry), "grams": .number(150), "day": .string(day)]
        let updated: Record = original.merging(["grams": .number(225)]) { _, new in new }
        var queue = try EntryOutbox(directory: root, owner: owner)
        try queue.insert(original, row: original)
        guard let sent = try queue.begin() else { throw CheckError.failure("Queue lost insert.") }
        try queue.update(entry, patch: ["grams": .number(225)], row: updated)
        var restarted = try EntryOutbox(directory: root, owner: owner)
        let untouched = try EntryOutbox(directory: root, owner: other)
        try require(untouched.operations.isEmpty && restarted.operations.count == 2, "UID-specific persistence")
        try require(restarted.operations[0].payload.number("grams") == 150 && restarted.operations[0].attempted, "Attempted insert immutable")
        try require(restarted.operations[1].payload.number("grams") == 225, "Later edit survives restart")
        try restarted.finish(sent)
        try require(restarted.overlay([], day: day).first?.number("grams") == 225, "Offline acknowledged-insert and pending edit remains visible")
        try restarted.delete(entry, row: updated)
        try require(restarted.overlay([updated], day: day).isEmpty, "Local delete removes cached row")
        let second = UUID().uuidString
        let unsent: Record = ["id": .string(second), "day": .string(day)]
        try restarted.insert(unsent, row: unsent)
        try restarted.delete(second, row: unsent)
        try require(!restarted.operations.contains { $0.entryID == second }, "Never-sent insert can be canceled")
        let batchDirectory = root.appendingPathComponent("clear-day")
        var mixed = try EntryOutbox(directory: batchDirectory, owner: owner)
        try mixed.insert(original, row: original)
        _ = try mixed.begin()
        try mixed.insert(unsent, row: unsent)
        let synced = UUID().uuidString, water = UUID().uuidString
        try mixed.clearDay(day, ids: [entry, second, synced])
        mixed = try EntryOutbox(directory: batchDirectory, owner: owner)
        try require(mixed.operations.count == 3, "Pending writes survive a restart during deletion")
        guard let attempted = try mixed.begin(), attempted.kind == .insert else { throw CheckError.failure("Lost attempted insert") }
        try mixed.finish(attempted)
        guard let batch = try mixed.begin(), batch.kind == .clearDay else { throw CheckError.failure("Missing batch") }
        let server: [Record] = [original, ["id": .string(synced)], ["id": .string(water)]]
        try require(mixed.operations.count == 2 && mixed.overlay(server, day: day).map { $0.text("id") } == [water],
                    "The batch preserves the unsent insert until acknowledgement and excludes water")
        var rejected = mixed
        try rejected.finish(batch, applied: false)
        try require(Set(rejected.overlay(server, day: day).map { $0.text("id") }) == Set([water, entry, second, synced]),
                    "Terminal rejection restores every original row")
        try mixed.finish(batch)
        try require(mixed.operations.isEmpty, "Acknowledged batch consumes targeted inserts without replay")

        // Coalescing: update A, insert B, update A again -> 2 ops, A's patch merged; once attempted, a further update appends.
        let root2 = root.appendingPathComponent("coalesce")
        var q2 = try EntryOutbox(directory: root2, owner: owner)
        let idA = UUID().uuidString, idB = UUID().uuidString
        let rowA: Record = ["id": .string(idA), "grams": .number(10)]
        let rowB: Record = ["id": .string(idB), "grams": .number(20)]
        try q2.update(idA, patch: ["grams": .number(11)], row: rowA)
        try q2.insert(rowB, row: rowB)
        try q2.update(idA, patch: ["grams": .number(12), "meal_label_id": .string("L")], row: rowA)
        try require(q2.operations.count == 2 && q2.operations[0].entryID == idA
                    && q2.operations[0].payload.number("grams") == 12 && q2.operations[0].payload["meal_label_id"] == .string("L"),
                    "Non-adjacent updates for the same entry coalesce")
        guard let sentA = try q2.begin() else { throw CheckError.failure("Queue lost update.") }
        try q2.update(idA, patch: ["grams": .number(13)], row: rowA)
        try require(q2.operations.count == 3 && q2.operations[0].payload.number("grams") == 12 && q2.operations[2].payload.number("grams") == 13,
                    "Update after attempted op appends")
        _ = sentA
        let cacheA = try AccountCache(root: root, owner: owner)
        let cacheB = try AccountCache(root: root, owner: other)
        let key = AccountCache.key("entry_nutrients", ["day": "eq." + day])
        try cacheA.write(key, [updated])
        try require(cacheA.read(key) == [updated] && cacheB.read(key) == nil, "UID-specific read cache")
        try require(NutriError("permanent", status: 400, code: "23503").permanentWriteFailure
                    && !NutriError("temporary", status: 403, code: "42501").permanentWriteFailure, "Known error categorization")
        try require(NutriError("bad", status: 413, code: nil).permanentWriteFailure
                    && NutriError("bad", status: 400, code: nil).permanentWriteFailure
                    && NutriError("dup", status: 409, code: "23505").permanentWriteFailure
                    && !NutriError("rls", status: 403, code: "42501").permanentWriteFailure, "4xx sin código y códigos conocidos")
        for status in [401, 403, 408, 429, 503] {
            try require(!NutriError("transient", status: status, code: nil).permanentWriteFailure, "HTTP \(status) sin código es transitorio")
        }
    }

    private static func checkTransport(useKeychain: Bool) async throws {
        let log = RequestLog()
        MockHTTP.handler = { request in try log.response(request) }
        defer { MockHTTP.handler = nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockHTTP.self]
        let keychain = useKeychain ? SessionKeychain(service: "com.vryahn.nutri.native.test." + UUID().uuidString) : nil
        let client = Supabase(configuration: NutriConfiguration(database: URL(string: "https://nutri.test")!,
             publishableKey: "public-test-key", ai: URL(string: "https://nutri.test/api/ai")!),
             keychain: keychain, http: URLSession(configuration: configuration))
        let auth = try await client.signIn(email: "fixture@nutri.invalid", password: "fixture-password")
        let owner = auth.user.id
        if let keychain {
            let stored = try keychain.read()
            try require(stored?.auth.user.id == owner && stored?.auth.access_token == "expired", "Keychain persisted synthetic sign-in")
        }
        async let a = client.rows("GET", "entry_nutrients", owner: owner)
        async let b = client.rows("GET", "daily_totals", owner: owner)
        let rows = try await (a, b)
        try require(rows.0.count == 1 && rows.1.count == 1, "REST read after refresh")
        try require(log.refreshes == 1, "Concurrent expired requests share one refresh")
        let writes = try await client.rows("PATCH", "entries", query: ["id": "eq.fixture"], body: .object(["grams": .number(1)]),
                                         prefer: "return=representation", owner: owner)
        try require(writes.isEmpty && log.sawWriteProfile, "Server zero rows preserved with schema headers")
        do {
            _ = try await client.rows("GET", "entries", owner: UUID().uuidString)
            throw CheckError.failure("Cross-UID request accepted.")
        } catch is CancellationError {}
        do {
            _ = try await client.rows("GET", "bad", owner: owner)
            throw CheckError.failure("Server rejection hidden.")
        } catch let error as NutriError {
            try require(error.code == "23503" && error.status == 409 && error.permanentWriteFailure, "REST error details")
        }
        let revoked = try await client.signOut(owner: owner)
        try require(revoked && log.sawLogout, "Signout revokes local server session scope")
        if let keychain {
            let stored = try keychain.read()
            try require(stored == nil, "Keychain cleared synthetic credentials")
        }
        do {
            _ = try await client.rows("GET", "entries", owner: owner)
            throw CheckError.failure("Signed out request accepted.")
        } catch is CancellationError {}
        let anonymous = try await client.signInAnonymously()
        try require(anonymous.user.is_anonymous == true, "Anonymous demo authenticates without credentials")
        _ = try await client.rpc("seed_demo", ["lang": .string("en"), "demo_day": .string("2026-11-16")], owner: anonymous.user.id)
        _ = try await client.signOut(owner: anonymous.user.id)
    }

    private static func liveReadOnly() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let endpoint = env["VITE_SUPABASE_URL"].flatMap(URL.init(string:)),
              let key = env["VITE_SUPABASE_ANON_KEY"], key.hasPrefix("sb_publishable_"),
              let email = env["VITE_DEV_EMAIL"], let password = env["VITE_DEV_PASSWORD"],
              !email.isEmpty, !password.isEmpty, endpoint.scheme == "https" else {
            throw CheckError.failure("Designated test-account environment missing.")
        }
        let client = Supabase(configuration: NutriConfiguration(database: endpoint,
            publishableKey: key, ai: URL(string: "https://nutri.vryahn.com/api/ai")!))
        let session = try await client.signIn(email: email, password: password)
        let owner = session.user.id
        do {
            let names = ["entry_nutrients", "foods", "recipe_per_100g", "targets", "daily_totals", "body_metrics", "prefs"]
            for name in names {
                let rows = try await client.rows("GET", name, query: ["select": "*", "limit": "1"], owner: owner)
                print("Native REST \(name): HTTP success (\(rows.count) visible sample rows).")
            }
            let refreshed = try await client.renew(owner: owner)
            try require(refreshed.auth.user.id == owner, "Refresh identity mismatch.")
            print("Native Auth refresh: success.")
            for table in ["entries", "foods", "targets", "body_metrics"] {
                let rows = try await client.rows("GET", table,
                    query: ["owner": "neq." + owner, "select": "owner", "limit": "1"], owner: owner)
                try require(rows.isEmpty, "RLS: other owner rows visible.")
            }
            var request = URLRequest(url: endpoint.appendingPathComponent("rest/v1/entries").appending(queryItems: [
                .init(name: "select", value: "id"), .init(name: "limit", value: "1")
            ]))
            request.setValue(key, forHTTPHeaderField: "apikey")
            request.setValue("nutri", forHTTPHeaderField: "Accept-Profile")
            let (body, rawResponse) = try await URLSession(configuration: .ephemeral).data(for: request)
            guard let status = (rawResponse as? HTTPURLResponse)?.statusCode else { throw CheckError.failure("Invalid anonymous response.") }
            if (200..<300).contains(status) {
                let rows = try JSONDecoder().decode([Record].self, from: body)
                try require(rows.isEmpty, "RLS: anonymous rows visible.")
            } else {
                try require(status == 401 || status == 403, "RLS: unexpected anonymous status.")
            }
            print("Native REST RLS: zero foreign rows, anonymous private access denied.")
            let revoked = try await client.signOut(owner: owner)
            try require(revoked, "Remote scope=local logout failed.")
            print("Native Auth logout: local session cleared and revoked.")
        } catch {
            _ = try? await client.signOut(owner: owner)
            throw error
        }
    }
}

private final class SendableCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var number = 0
    var value: Int {
        get { lock.withLock { number } }
        set { lock.withLock { number = newValue } }
    }
    func increment() { lock.withLock { number += 1 } }
}

private final class MockHTTP: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (Int, String))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            guard let handler = Self.handler, let url = request.url else { throw URLError(.badURL) }
            let (status, body) = try handler(request)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }

    override func stopLoading() {}
}

private final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var profile = false
    private var logout = false
    private let uid = "00000000-0000-4000-8000-000000000042"
    var refreshes: Int { lock.withLock { count } }
    var sawWriteProfile: Bool { lock.withLock { profile } }
    var sawLogout: Bool { lock.withLock { logout } }

    func response(_ request: URLRequest) throws -> (Int, String) {
        let path = request.url?.path ?? ""
        let mode = request.url?.query ?? ""
        let token = request.value(forHTTPHeaderField: "Authorization")
        try require(request.value(forHTTPHeaderField: "apikey") == "public-test-key", "Public key header")
        if path.hasSuffix("/signup") {
            var bytes = request.httpBody ?? Data()
            if bytes.isEmpty, let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    bytes.append(contentsOf: buffer.prefix(count))
                }
            }
            let body = try JSONDecoder().decode(Record.self, from: bytes)
            try require(body.isEmpty, "Anonymous signup sends no personal credentials")
            return (200, """
            {"access_token":"fresh","refresh_token":"refresh-fresh","expires_in":3600,"user":{"id":"\(uid)","is_anonymous":true}}
            """)
        }
        if path.hasSuffix("/token") {
            let refresh = mode.contains("refresh_token")
            if refresh { lock.withLock { count += 1 } }
            let tag = refresh ? "fresh" : "expired"
            let length = refresh ? 3600 : 0
            return (200, """
            {"access_token":"\(tag)","refresh_token":"refresh-\(tag)","expires_in":\(length),"user":{"id":"\(uid)","email":"fixture@nutri.invalid"}}
            """)
        }
        try require(token == "Bearer fresh", "Current bearer token reused")
        if path.hasSuffix("/logout") {
            lock.withLock { logout = mode == "scope=local" }
            return (200, "{}")
        }
        try require(request.value(forHTTPHeaderField: "Accept-Profile") == "nutri", "REST schema profile")
        if request.httpMethod == "PATCH" {
            lock.withLock {
                profile = request.value(forHTTPHeaderField: "Content-Profile") == "nutri"
                    && request.value(forHTTPHeaderField: "Prefer") == "return=representation"
            }
            return (200, "[]")
        }
        if path.hasSuffix("/bad") { return (409, #"{"message":"Constraint violation","code":"23503"}"#) }
        return (200, "[{\"kcal\":100}]")
    }
}
