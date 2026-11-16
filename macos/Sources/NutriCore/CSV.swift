import Foundation

public enum CSV {
    public typealias Row = [String: String]

    public static func parse(_ input: String) throws -> [Row] {
        let text = input.hasPrefix("\u{FEFF}") ? String(input.dropFirst()) : input
        let chars = Array(text)
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var closed = false
        var i = 0

        func finishField() {
            row.append(field)
            field = ""
            closed = false
        }
        func finishRow() {
            finishField()
            if !row.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
                rows.append(row)
            }
            row = []
        }
        while i < chars.count {
            let char = chars[i]
            let newline = char == "\n" || char == "\r" || char == "\r\n"
            if quoted {
                if char == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" {
                        field.append(char)
                        i += 1
                    } else {
                        quoted = false
                        closed = true
                    }
                } else {
                    field.append(char)
                }
            } else if char == "," {
                finishField()
            } else if newline {
                finishRow()
            } else if char == "\"" && field.isEmpty && !closed {
                quoted = true
            } else {
                guard !closed && char != "\"" else { throw NutriError("Comillas inválidas en CSV.") }
                field.append(char)
            }
            i += 1
        }
        guard !quoted else { throw NutriError("Faltan comillas de cierre en CSV.") }
        finishRow()
        guard let first = rows.first else { return [] }
        let headers = first.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        guard !headers.contains(""), Set(headers).count == headers.count else {
            throw NutriError("Encabezados vacíos o duplicados en CSV.")
        }
        return try rows.dropFirst().enumerated().map { index, cells in
            guard cells.count == headers.count else {
                throw NutriError("Número de columnas inválido en fila \(index + 2).")
            }
            return Dictionary(uniqueKeysWithValues: zip(headers, cells))
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
