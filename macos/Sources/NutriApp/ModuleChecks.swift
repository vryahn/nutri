#if DEBUG
import Foundation
import NutriCore

func runModuleChecks() throws {
    func check(_ result: @autoclosure () -> Bool, _ name: String) throws {
        guard result() else { throw FeatureError("Module check failed · " + name) }
    }

    let densityFood: Record = ["id": .string("example"), "name": .string("Leche"), "density_g_ml": .number(1.03)]
    let dryFood: Record = ["id": .string("dry"), "name": .string("Arroz")]
    try check(parseRecipeLine("100 ml leche", catalog: [densityFood])?.grams == 103, "recipe paste uses density")
    try check(parseRecipeLine("100 ml arroz", catalog: [dryFood]) == nil, "recipe paste rejects volume without density")
    try check(parseRecipeLine("arroz -120 g", catalog: [dryFood]) == nil, "recipe paste rejects negative mass")
    try check(parseRecipeLine("arroz 120 mg", catalog: [dryFood]) == nil, "recipe paste rejects unknown mass units")
    try check(parseRecipeLine("120 g arroz", catalog: [dryFood, dryFood]) == nil, "recipe paste rejects ambiguous catalog match")
    for line in ["100 mg arroz", "100 oz arroz", "1/2 kg arroz", "arroz 1 / 2 kg", "100 tazas arroz", "100 cups arroz", "100 cucharadas arroz", "100 piezas arroz"] {
        try check(parseRecipeLine(line, catalog: [dryFood]) == nil, "recipe paste rejects unsafe quantity: " + line)
    }
    try check(parseRecipeLine("100 arroz", catalog: [dryFood])?.grams == 100 &&
              parseRecipeLine("arroz 100", catalog: [dryFood])?.grams == 100, "recipe paste preserves bare gram quantities")
    try check(recipeCookedEstimate((0.2, "ml"), estimate: 0.2) == nil &&
              recipeCookedEstimate((100, "ml"), estimate: nil) == nil &&
              recipeCookedEstimate((100, "ml"), estimate: 450) == nil &&
              recipeCookedEstimate((100, "ml"), estimate: 103) == 103 &&
              recipeCookedEstimate((250, "g"), estimate: 350) == 250, "typed cooked volume requires density and mass wins")
    try checkCatalogFidelity()

    var values = TargetValues()
    values.point["potasio_mg"] = "0"
    values.min["sodio_mg"] = "800"
    values.max["sodio_mg"] = "2000"
    let encoded = try values.encoded()
    try check(encoded.object("micros").number("potasio_mg") == 0, "target explicit zero survives")
    try check(encoded.object("bounds").object("sodio_mg").number("min") == 1500, "target sodium floor")

    let today = Day.date("2026-11-15") ?? Date(timeIntervalSince1970: 0)
    func key(_ offset: Int) -> String { Day.key(addingDays(offset, to: today)) }
    let validRule: Record = ["id": .number(7), "kind": .string("ritmo_alto"), "weeks": .number(2), "value": .number(0.3),
                             "delta_carbs_g": .number(-25), "scope": .array([.string("1")])]
    func phase(rules: Record, goal: String = "volumen", start: Int = -35) -> [Record] {
        (0...6).map { dow in
            ["dow": .number(Double(dow)), "valid_from": .string(key(start)), "goal": .string(goal), "kcal": .number(2000),
             "protein_g": .number(170), "carbs_g": .number(200), "fat_g": .number(55), "rules": .object(rules)]
        }
    }
    func weights(_ recent: Double, _ past: Double) -> [Record] {
        (0...21).map { i in
            ["day": .string(key(-i)), "metrics": .object(["peso_kg": .number(i < 7 ? recent : past)])]
        }
    }
    let totals: [Record] = (0...21).map { ["day": .string(key(-$0)), "kcal": .number(2000)] }
    let p = phase(rules: ["items": .array([.object(validRule)])])
    let proposal = phaseProposal(targets: p, phase: p, body: weights(90, 85), totals: totals, today: today)
    try check(proposal?.rows.first(where: { $0.number("dow") == 1 })?.number("kcal") == 1900, "rule scoped numeric-string Monday")
    try check(proposal?.rows.first(where: { $0.number("dow") == 2 })?.number("kcal") == 2000, "rule preserves unscoped weekday")

    var unconfigured = validRule
    unconfigured["kind"] = .string("ritmo_lento")
    unconfigured["value"] = nil
    let incomplete = phase(rules: ["items": .array([.object(unconfigured)])])
    try check(phaseProposal(targets: incomplete, phase: incomplete, body: weights(90, 85), totals: totals, today: today) == nil, "invalid slow rate skips")
    let cooldown = p + [["dow": .number(1), "valid_from": .string(key(1)), "applied_rule": .string("7 · fixture")]]
    try check(phaseProposal(targets: cooldown, phase: p, body: weights(90, 85), totals: totals, today: today) == nil, "rule cooldown")
    let noRules = phase(rules: [:])
    try check(phaseProposal(targets: noRules, phase: noRules, body: weights(90, 85), totals: totals, today: today) == nil, "no configured rules")
    unconfigured["value"] = .number(0.3)
    let transitionRules: Record = ["transition": .object(["kind": .string("coupled_band")]), "items": .array([.object(unconfigured)])]
    let transition = phase(rules: transitionRules, goal: "deficit", start: -20)
    let fast = phaseProposal(targets: transition, phase: transition, body: weights(80, 84), totals: totals, today: today)
    try check(fast?.rows.isEmpty == true, "transition fast loss triggers review-only proposal")
    try check(phaseProposal(targets: transition, phase: transition, body: weights(80, 80), totals: totals, today: today) == nil, "transition slow loss stays suppressed")

    let post = dashboardPosterior(successes: 2, count: 3)
    try check(abs(post.mean - 0.6) < 1e-12 && abs(post.low - 0.19412044968324355) < 1e-10 &&
              abs(post.high - 0.9324140135114569) < 1e-10, "Bayes matches web Beta oracle")
    let plan = DashboardAskPlan(["date_from": .string("2025-01-01"), "date_to": .string("2030-01-01"),
                                 "nutrients": .array([.string("kcal"), .string("unrecognized"), .string("kcal")])], today: today)
    try check(plan.from == key(-91) && plan.to == key(0) && plan.nutrients == ["kcal", "kcal"] && plan.clamped, "ask planner range, schema and cap")
    let future = DashboardAskPlan(["date_from": .string("2030-01-01"), "date_to": .string("2030-02-01")], today: today)
    try check(future.from == "2029-10-02" && future.to == "2030-01-01" && future.clamped, "ask planner follows web clamp-and-swap")
    try checkDashboardCoverage(today: today)
    try checkBodyDraftRecovery()
    try checkJournalFidelity()
    print("Nutri module checks passed")
}
#endif
