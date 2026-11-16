import Foundation

public typealias Record = [String: JSONValue]

public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object(Record), null

    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(Double.self) { self = .number(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode([JSONValue].self) { self = .array(item) }
        else { self = .object(try value.decode(Record.self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case let .string(item): try value.encode(item)
        case let .number(item): try value.encode(item)
        case let .bool(item): try value.encode(item)
        case let .array(item): try value.encode(item)
        case let .object(item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }

    public var string: String? { if case let .string(value) = self { return value }; return nil }
    public var number: Double? {
        switch self {
        case let .number(value): return value.isFinite ? value : nil
        case let .string(value): return Double(value).flatMap { $0.isFinite ? $0 : nil }
        default: return nil
        }
    }
    public var bool: Bool? { if case let .bool(value) = self { return value }; return nil }
    public var array: [JSONValue]? { if case let .array(value) = self { return value }; return nil }
    public var object: Record? { if case let .object(value) = self { return value }; return nil }
}

public extension Record {
    func text(_ key: String) -> String { self[key]?.string ?? "" }
    func number(_ key: String) -> Double? { self[key]?.number }
    func object(_ key: String) -> Record { self[key]?.object ?? [:] }
    func array(_ key: String) -> [JSONValue] { self[key]?.array ?? [] }
}

public struct NutriError: LocalizedError, Sendable {
    public let message: String
    public let status: Int?
    public let code: String?

    public init(_ message: String, status: Int? = nil, code: String? = nil) {
        self.message = message
        self.status = status
        self.code = code
    }

    public var errorDescription: String? { message }
    public var permanentWriteFailure: Bool {
        if let status, status >= 500 || status == 408 || status == 429 { return false }
        if let code {
            if ["42501", "PGRST301", "PGRST302"].contains(code) { return false }
            return code.range(of: "^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$", options: .regularExpression) != nil
        }
        return false
    }
}
