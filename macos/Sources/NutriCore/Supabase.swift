import Foundation
import Security

public struct NutriConfiguration: Sendable {
    public let database: URL
    public let publishableKey: String
    public let ai: URL

    public init(database: URL, publishableKey: String, ai: URL) {
        self.database = database
        self.publishableKey = publishableKey
        self.ai = ai
    }
}

public struct AuthSession: Codable, Sendable {
    public struct User: Codable, Sendable {
        public let id: String
        public let email: String?
        public let is_anonymous: Bool?
    }
    public let access_token: String
    public let refresh_token: String
    public let expires_at: Double?
    public let expires_in: Double?
    public let user: User
}

public struct StoredSession: Codable, Sendable {
    public let auth: AuthSession
    public let expiration: Date

    public init(_ auth: AuthSession, receivedAt: Date = Date()) {
        self.auth = auth
        self.expiration = auth.expires_at.map { Date(timeIntervalSince1970: $0) }
            ?? receivedAt.addingTimeInterval(auth.expires_in ?? 0)
    }
}

public struct SessionKeychain: Sendable {
    let service: String

    public init(service: String) { self.service = service }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session"]
    }

    public func read() throws -> StoredSession? {
        var parameters = query
        parameters[kSecReturnData as String] = true
        parameters[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(parameters as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw error(status) }
        return try JSONDecoder().decode(StoredSession.self, from: data)
    }

    func store(_ session: StoredSession) throws {
        let data = try JSONEncoder().encode(session)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw error(status) }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw error(added) }
    }

    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw error(status) }
    }

    private func error(_ status: OSStatus) -> NutriError {
        NutriError("Acceso al llavero de macOS: \(SecCopyErrorMessageString(status, nil) as String? ?? String(status))")
    }
}

public actor Supabase {
    public let configuration: NutriConfiguration
    private let http: URLSession
    private let keychain: SessionKeychain?
    private var session: StoredSession?
    private var refreshTask: Task<AuthSession, Error>?
    private var generation = 0
    private var needsPersistence = false
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(configuration: NutriConfiguration, session: StoredSession? = nil, keychain: SessionKeychain? = nil, http: URLSession? = nil) {
        self.configuration = configuration
        self.session = session
        self.keychain = keychain
        let options = URLSessionConfiguration.ephemeral
        options.urlCache = nil
        options.requestCachePolicy = .reloadIgnoringLocalCacheData
        options.httpShouldSetCookies = false
        self.http = http ?? URLSession(configuration: options)
    }

    public func signIn(email: String, password: String) async throws -> AuthSession {
        let current = generation
        let request = try databaseRequest("POST", "auth/v1/token", ["grant_type": "password"],
            body: .object(["email": .string(email), "password": .string(password)]))
        let auth = try decoder.decode(AuthSession.self, from: await send(request))
        guard current == generation, session == nil else { throw CancellationError() }
        let stored = StoredSession(auth)
        try keychain?.store(stored)
        generation += 1
        session = stored
        return auth
    }

    public func signInAnonymously() async throws -> AuthSession {
        guard session == nil else { throw CancellationError() }
        let current = generation
        let request = try databaseRequest("POST", "auth/v1/signup", body: .object([:]))
        let auth = try decoder.decode(AuthSession.self, from: await send(request))
        guard current == generation, session == nil else { throw CancellationError() }
        guard auth.user.is_anonymous == true else { throw NutriError("No se pudo abrir la demo — intenta más tarde.") }
        let stored = StoredSession(auth)
        try keychain?.store(stored)
        generation += 1
        session = stored
        return auth
    }

    @discardableResult
    public func signOut(owner: String) async throws -> Bool {
        guard let active = session, active.auth.user.id == owner else { throw CancellationError() }
        let current = generation
        let refreshed = active.expiration.timeIntervalSinceNow > 30 ? active : (try? await renew(owner: owner)) ?? active
        guard current == generation else { throw CancellationError() }
        try keychain?.clear()
        generation += 1
        refreshTask?.cancel()
        refreshTask = nil
        session = nil
        needsPersistence = false

        do {
            _ = try await send(databaseRequest("POST", "auth/v1/logout", ["scope": "local"], token: refreshed.auth.access_token))
            return true
        } catch {
            return false
        }
    }

    public func changePassword(_ password: String, owner: String) async throws {
        _ = try await authorized(owner: owner) { token in
            try self.databaseRequest("PUT", "auth/v1/user", body: .object(["password": .string(password)]), token: token)
        }
    }

    @discardableResult
    public func renew(owner: String) async throws -> StoredSession {
        guard let prior = session, prior.auth.user.id == owner else { throw CancellationError() }
        let current = generation
        let task: Task<AuthSession, Error>
        if let refreshTask {
            task = refreshTask
        } else {
            let request = try databaseRequest("POST", "auth/v1/token", ["grant_type": "refresh_token"],
                body: .object(["refresh_token": .string(prior.auth.refresh_token)]))
            task = Task {
                try JSONDecoder().decode(AuthSession.self, from: await self.send(request))
            }
            refreshTask = task
        }
        do {
            let refreshed = try await task.value
            guard current == generation, refreshed.user.id == owner else { throw CancellationError() }
            if let saved = session, saved.auth.refresh_token != prior.auth.refresh_token {
                try persistIfNeeded(saved)
                return saved
            }
            let stored = StoredSession(refreshed)
            session = stored
            refreshTask = nil
            needsPersistence = true
            try persistIfNeeded(stored)
            return stored
        } catch {
            if current == generation && session?.auth.refresh_token == prior.auth.refresh_token { refreshTask = nil }
            throw error
        }
    }

    public func rows(_ method: String, _ table: String, query: [String: String] = [:], body: JSONValue? = nil,
                     prefer: String? = nil, owner: String) async throws -> [Record] {
        let data = try await authorized(owner: owner) { token in
            var request = try self.databaseRequest(method, "rest/v1/" + table, query, body: body, token: token)
            request.setValue("nutri", forHTTPHeaderField: "Accept-Profile")
            if method != "GET" { request.setValue("nutri", forHTTPHeaderField: "Content-Profile") }
            if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
            return request
        }
        return try decoder.decode([Record].self, from: data)
    }

    public func rpc(_ name: String, _ body: Record, owner: String) async throws -> JSONValue {
        let data = try await authorized(owner: owner) { token in
            var request = try self.databaseRequest("POST", "rest/v1/rpc/" + name, body: .object(body), token: token)
            request.setValue("nutri", forHTTPHeaderField: "Content-Profile")
            request.setValue("nutri", forHTTPHeaderField: "Accept-Profile")
            return request
        }
        return data.isEmpty ? .null : try decoder.decode(JSONValue.self, from: data)
    }

    public func ai(_ body: Record, owner: String) async throws -> JSONValue {
        let data = try await authorized(owner: owner) { token in
            var request = URLRequest(url: self.configuration.ai, timeoutInterval: 90)
            request.httpMethod = "POST"
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try self.encoder.encode(body)
            return request
        }
        return try decoder.decode(JSONValue.self, from: data)
    }

    public func storage(_ method: String, _ path: String, body: Data? = nil, contentType: String? = nil,
                        query: [String: String] = [:], owner: String) async throws -> Data {
        try await authorized(owner: owner) { token in
            var request = try self.databaseRequest(method, "storage/v1/" + path, query, token: token)
            request.httpBody = body
            if method == "GET" { request.setValue("no-cache", forHTTPHeaderField: "Cache-Control") }
            if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
            return request
        }
    }

    private func authorized(owner: String, _ build: (String) throws -> URLRequest) async throws -> Data {
        let current = generation
        guard let active = session, active.auth.user.id == owner else { throw CancellationError() }
        let ready = active.expiration.timeIntervalSinceNow > 30 ? active : try await renew(owner: owner)
        guard current == generation else { throw CancellationError() }
        try persistIfNeeded(ready)

        let data: Data
        do {
            data = try await send(build(ready.auth.access_token))
        } catch let error as NutriError where error.status == 401 {
            guard current == generation else { throw CancellationError() }
            let refreshed: StoredSession
            if let session, session.auth.refresh_token != ready.auth.refresh_token {
                refreshed = session
            } else {
                refreshed = try await renew(owner: owner)
            }
            guard current == generation else { throw CancellationError() }
            data = try await send(build(refreshed.auth.access_token))
        }
        guard current == generation else { throw CancellationError() }
        return data
    }

    private func persistIfNeeded(_ value: StoredSession) throws {
        guard needsPersistence else { return }
        try keychain?.store(value)
        needsPersistence = false
    }

    private func databaseRequest(_ method: String, _ path: String, _ query: [String: String] = [:], body: JSONValue? = nil,
                                 token: String? = nil) throws -> URLRequest {
        let url = configuration.database.appendingPathComponent(path)
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw NutriError("URL inválida para Nutri.")
        }
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = components.url else { throw NutriError("Consulta inválida.") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, rawResponse) = try await http.data(for: request)
        guard let response = rawResponse as? HTTPURLResponse else { throw NutriError("Respuesta inválida del servidor.") }
        guard (200..<300).contains(response.statusCode) else {
            let detail = (try? decoder.decode(Record.self, from: data)) ?? [:]
            let message = [detail.text("message"), detail.text("msg"), detail.text("error_description"), detail.text("error")]
                .first(where: { !$0.isEmpty }) ?? "HTTP \(response.statusCode)"
            let code = detail["code"]?.string ?? detail["error_code"]?.string
            throw NutriError(message, status: response.statusCode, code: code)
        }
        return data
    }
}
