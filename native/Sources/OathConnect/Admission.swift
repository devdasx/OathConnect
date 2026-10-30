import Foundation
import CryptoKit

/// Per-session proof key. This is not a blockchain signing key or an integrator issuer key.
public struct ClientIdentity: Sendable {
    private let key: Curve25519.Signing.PrivateKey
    public var publicKey: String {encode64(key.publicKey.rawRepresentation)}
    public init() {key = Curve25519.Signing.PrivateKey()}
    init(testKey: Data) throws {key = try Curve25519.Signing.PrivateKey(rawRepresentation: testKey)}
    public func proof(grant: String, method: String, path: String, body: Data = Data()) throws -> String {
        try proof(grant: grant, method: method, path: path, body: body, at: timestamp(), nonce: encode64(Data((0..<16).map {_ in UInt8.random(in: 0...255)})))
    }
    func proof(grant: String, method: String, path: String, body: Data, at: Int, nonce: String) throws -> String {
        try check(grant.utf8.count <= 4096 && path.utf8.count <= 256 && body.count <= 36_000)
        let value = try json(["OathConnect/proof/v1", hash(Data(grant.utf8)), method, path, hash(body), at, nonce])
        return encode64(try json(["v": 1, "at": at, "nonce": nonce, "signature": encode64(key.signature(for: value))]))
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {completionHandler(nil)}
}

/// Bounded native HTTPS transport. Applications obtain grants from their own approved backend.
public actor RelayClient: WalletRelay {
    public nonisolated let relay: String, session: String
    private let identity: ClientIdentity
    private let transport: URLSession
    private var closed = false, busy = false
    public init(relay: String, session: String, identity: ClientIdentity) throws {
        try validateOrigin(relay); _ = try decode64(session, maximum: 32, exact: 32)
        self.relay = relay; self.session = session; self.identity = identity
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 20
        transport = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    public func attest(value: Data, grant: String) throws -> Data {
        try check(!closed, .invalidState)
        let body = try JSONValue.parse(value).canonical()
        return try json(["origin": "", "grant": grant, "proof": identity.proof(grant: grant, method: "ATTEST", path: "/v1/sessions/" + session, body: body)])
    }
    public func close() {closed = true; transport.invalidateAndCancel()}
    public func call(method: String, suffix: String, grant: String, body: Data = Data()) async throws -> Data {
        try check(!closed && !busy, .invalidState)
        try check(["GET", "PUT", "POST", "DELETE"].contains(method) && suffix.range(of: "^(|/peer|/messages(\\?(after|through)=(0|[1-9][0-9]{0,3}))?)$", options: .regularExpression) != nil)
        let path = "/v1/sessions/\(session)\(suffix)"
        guard let url = URL(string: relay + path) else {throw OathConnectError.malformed}
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.httpMethod = method; request.setValue("Oath " + grant, forHTTPHeaderField: "Authorization")
        request.setValue(try identity.proof(grant: grant, method: method, path: path, body: body), forHTTPHeaderField: "X-Oath-Proof")
        if !body.isEmpty {request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type")}
        busy = true; defer {busy = false}
        do {
            let (bytes, response) = try await transport.bytes(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {throw OathConnectError.relayRejected}
            var data = Data()
            for try await byte in bytes {try check(data.count < 290_000, .tooLarge); data.append(byte)}
            try check(!closed, .invalidState); return data
        } catch {closed = true; transport.invalidateAndCancel(); throw error}
    }
}
