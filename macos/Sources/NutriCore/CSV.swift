import Foundation

public enum CSV {
    public typealias Row = [String: String]

    // Mirrors src/lib/importer.js:parseCSV, including short rows and header casing.
    public static func parse(_ input: String) throws -> [Row] {
        let text = input.hasPrefix("\u{FEFF}") ? String(input.dropFirst()) : input
        let chars = Array(text)
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var i = 0
        func finishRow() {
            row.append(field)
            field = ""
            if row.count > 1 || row[0] != "" { rows.append(row) }
            row = []
        }
        while i < chars.count {
            let char = chars[i]
            if quoted {
                if char == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" {
                        field.append(char)
                        i += 1
                    } else { quoted = false }
                } else { field.append(char) }
            } else if char == "\"" { quoted = true }
            else if char == "," { row.append(field); field = "" }
            else if char == "\n" || char == "\r" || char == "\r\n" { finishRow() }
            else { field.append(char) }
            i += 1
        }
        if !field.isEmpty || !row.isEmpty { finishRow() }
        guard let first = rows.first else { return [] }
        let headers = first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        return rows.dropFirst().map { cells in
            var result: Row = [:]
            for (index, header) in headers.enumerated() {
                result[header] = (index < cells.count ? cells[index] : "").trimmingCharacters(in: .whitespacesAndNewlines)
            }
            return result
        }
    }

    public static func encode(_ rows: [[String]]) -> String {
        rows.map { row in
            row.map { cell in
                let escaped = cell.replacingOccurrences(of: "\"", with: "\"\"")
                return "\"" + escaped + "\""
            }.joined(separator: ",")
        }.joined(separator: "\r\n") + "\r\n"
    }

    public static func normalize(_ name: String) -> String {
        name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
