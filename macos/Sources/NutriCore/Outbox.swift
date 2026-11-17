import Foundation

public struct EntryOperation: Codable, Equatable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case insert, update, delete }
    public let id: UUID
    public let owner: String
    public let entryID: String
    public let kind: Kind
    public var payload: Record
    public var row: Record?
    public var attempted: Bool

    public init(owner: String, entryID: String, kind: Kind, payload: Record, row: Record?) {
        id = UUID()
        self.owner = owner
        self.entryID = entryID
        self.kind = kind
        self.payload = payload
        self.row = row
        attempted = false
    }
}

public struct EntryOutbox {
    private let file: URL?
    private let owner: String
    public private(set) var operations: [EntryOperation]

    public init(directory: URL?, owner: String) throws {
        guard UUID(uuidString: owner) != nil else { throw NutriError("Identidad de cuenta inválida.") }
        self.owner = owner
        file = directory?.appendingPathComponent(owner, isDirectory: true).appendingPathComponent("entries-outbox.json")
        operations = []
        if let file, FileManager.default.fileExists(atPath: file.path) {
            let restored = try JSONDecoder().decode([EntryOperation].self, from: Data(contentsOf: file))
            guard restored.allSatisfy({ $0.owner == owner }) else { throw NutriError("La cola pertenece a otra cuenta.") }
            operations = restored
        }
    }

    public mutating func insert(_ payload: Record, row: Record) throws {
        let id = payload.text("id")
        guard UUID(uuidString: id) != nil, !operations.contains(where: { $0.entryID == id }) else {
            throw NutriError("Identificador de registro inválido o repetido.")
        }
        try persist(operations + [EntryOperation(owner: owner, entryID: id, kind: .insert, payload: payload, row: row)])
    }

    public mutating func update(_ id: String, patch: Record, row: Record) throws {
        var next = operations
        // Like web: merge into the LAST op for this entry (any queue position) while it is unattempted.
        if let last = next.lastIndex(where: { $0.entryID == id }), next[last].kind != .delete, !next[last].attempted {
            next[last].payload.merge(patch) { _, new in new }
            next[last].row = row
        } else {
            next.append(EntryOperation(owner: owner, entryID: id, kind: .update, payload: patch, row: row))
        }
        try persist(next)
    }

    public mutating func delete(_ id: String, row: Record? = nil) throws {
        var next = operations
        let insert = next.first { $0.entryID == id && $0.kind == .insert }
        next.removeAll { $0.entryID == id && !$0.attempted }
        if insert?.attempted != false {
            next.append(EntryOperation(owner: owner, entryID: id, kind: .delete, payload: [:], row: row))
        }
        try persist(next)
    }

    @discardableResult
    public mutating func begin() throws -> EntryOperation? {
        guard !operations.isEmpty else { return nil }
        var next = operations
        next[0].attempted = true
        try persist(next)
        return next[0]
    }

    public mutating func finish(_ operation: EntryOperation, discardDependents: Bool = false) throws {
        try persist(operations.filter { item in
            item.id != operation.id && !(discardDependents && item.entryID == operation.entryID)
        })
    }

    public func overlay(_ server: [Record], day: String) -> [Record] {
        var result = server
        for operation in operations {
            let index = result.firstIndex { $0.text("id") == operation.entryID }
            if operation.kind == .delete {
                if let index { result.remove(at: index) }
            } else if var row = operation.row {
                row["_pending"] = .bool(true)
                if row.text("day") == day {
                    if let index { result[index] = row }
                    else { result.append(row) }
                } else if let index {
                    result.remove(at: index)
                }
            }
        }
        return result
    }

    private mutating func persist(_ rows: [EntryOperation]) throws {
        if let file {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(rows).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
        operations = rows
    }
}

public struct AccountCache {
    private let directory: URL

    public init(root: URL, owner: String) throws {
        guard UUID(uuidString: owner) != nil else { throw NutriError("Identidad de cuenta inválida.") }
        directory = root.appendingPathComponent(owner, isDirectory: true).appendingPathComponent("cache", isDirectory: true)
    }

    private struct Item: Codable { let key: String; let rows: [Record] }

    public static func key(_ table: String, _ query: [String: String]) -> String {
        ([table] + query.sorted { $0.key < $1.key }.map { "\($0.key.count):\($0.key)\($0.value.count):\($0.value)" }).joined(separator: "|")
    }

    private func file(_ key: String) -> URL {
        // Stable local filename; the complete key is checked before returning a hit.
        let name = key.utf8.reduce(UInt64(14_695_981_039_346_656_037)) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
        return directory.appendingPathComponent(String(name, radix: 16) + ".json")
    }

    public func read(_ key: String) -> [Record]? {
        guard let data = try? Data(contentsOf: file(key)), let item = try? JSONDecoder().decode(Item.self, from: data),
              item.key == key else { return nil }
        return item.rows
    }

    public func write(_ key: String, _ rows: [Record]) throws {
        let manager = FileManager.default
        try manager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let destination = file(key)
        try JSONEncoder().encode(Item(key: key, rows: rows)).write(to: destination, options: .atomic)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        // Keep the most recently used queries on disk. Never prune the outbox.
        let fields: Set<URLResourceKey> = [.contentModificationDateKey]
        if let children = try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(fields)), children.count > 180 {
            let sorted = children.sorted { a, b in
                let left = (try? a.resourceValues(forKeys: fields).contentModificationDate) ?? .distantPast
                let right = (try? b.resourceValues(forKeys: fields).contentModificationDate) ?? .distantPast
                return left > right
            }
            for old in sorted.dropFirst(150) { try? manager.removeItem(at: old) }
        }
    }

    public func clear() throws {
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
}
