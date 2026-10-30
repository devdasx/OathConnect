import Foundation

public protocol WalletRelay: Sendable {
    var relay: String {get}
    var session: String {get}
    func call(method: String, suffix: String, grant: String, body: Data) async throws -> Data
    func attest(value: Data, grant: String) async throws -> Data
    func close() async
}
public struct RequestedCapability: Sendable {
    public let chain: String, account: String?
    public let methods: Set<String>
    static func parse(_ value: JSONValue) throws -> RequestedCapability {
        guard let fields = value.fields, let chain = fields["chain"]?.text, case .array(let methods) = fields["methods"] else {throw OathConnectError.malformed}
        let account = fields["account"]?.text
        try check(Set(fields.keys) == (account == nil ? ["chain", "methods"] : ["chain", "methods", "account"]))
        let names = methods.compactMap(\.text); try check(names.count == methods.count && Set(names).count == names.count)
        _ = try Capability(chain: chain, account: account ?? "wallet-selected", methods: Set(names))
        return RequestedCapability(chain: chain, account: account, methods: Set(names))
    }
}
extension Capability {
    var value: JSONValue {.object(["chain": .string(chain), "account": .string(account), "methods": .array(methods.sorted().map { .string($0) })])}
}

/// Wallet-side lifecycle. Each signing adapter still must decode, display and authorize actual effects.
/// Actor isolation, bounded replay state and one in-flight operation prevent duplicate execution.
public actor WalletSession {
    private let channel: EncryptedChannel, transport: any WalletRelay
    private let hello: Data
    private let projects: [ApprovedProject], getGrant: @Sendable () async throws -> String
    private var cursor = 0, closed = false, busy = false, joined = false
    private var capabilities: [Capability]?, seen: Set<String> = []
    private var activeAuthorizer: WalletAuthorizer?
    public private(set) var peer: PeerIdentity?
    public init(pairing: WalletPairing, transport: any WalletRelay, trustedProjects: [ApprovedProject], getGrant: @escaping @Sendable () async throws -> String) throws {
        try check(pairing.session == transport.session && pairing.relay == transport.relay && trustedProjects.count <= 1024)
        channel = pairing.channel; hello = pairing.hello; self.transport = transport; projects = trustedProjects; self.getGrant = getGrant
    }
    /// Publish the public pairing hello once before approving the session. No automatic retries.
    public func join() async throws {
        try begin(); defer {busy = false}
        do {try check(!joined, .invalidState); _ = try await call("PUT", "/peer", hello); joined = true} catch {await terminate(); throw error}
    }
    private func begin() throws {try Task.checkCancellation(); try check(!closed && !busy, .invalidState); busy = true}
    private func call(_ method: String, _ suffix: String = "", _ body: Data = Data()) async throws -> Data {
        try Task.checkCancellation()
        try check(!closed, .invalidState); let grant = try await getGrant(); try check(!closed, .invalidState)
        try Task.checkCancellation()
        let response = try await transport.call(method: method, suffix: suffix, grant: grant, body: body)
        try Task.checkCancellation(); try check(!closed, .invalidState); return response
    }
    private func send(_ value: JSONValue) async throws {
        try Task.checkCancellation()
        try check(!closed, .invalidState)
        let frame = try await channel.seal(json: value.canonical())
        _ = try await call("POST", "/messages", frame)
    }
    private func receive(deadline: Int) async throws -> Data {
        while !closed && timestamp() < deadline {
            try Task.checkCancellation()
            let response = try object(await call("GET", "/messages?after=\(cursor)"), keys: ["messages"], maximum: 290_000)
            guard let messages = response["messages"] as? [[String: Any]], messages.count <= 1 else {throw OathConnectError.malformed}
            if let frame = messages.first {
                let clear = try await channel.open(frame: json(frame))
                cursor = try number(frame, "sequence"); _ = try await call("DELETE", "/messages?through=\(cursor)")
                try Task.checkCancellation(); try check(!closed && timestamp() < deadline, .expired)
                return clear
            }
            try await Task.sleep(for: .seconds(2))
        }
        throw OathConnectError.expired
    }
    public func approveSession(decide: @Sendable ([RequestedCapability], PeerIdentity) async throws -> [Capability]) async throws -> [Capability] {
        try begin(); defer {busy = false}
        do {
            try check(joined && capabilities == nil, .invalidState)
            let value = try JSONValue.parse(await receive(deadline: timestamp() + 120))
            guard let f = value.fields, Set(f.keys) == ["type", "capabilities", "identity"], f["type"]?.text == "proposal", case .array(let items) = f["capabilities"], let attestation = f["identity"] else {throw OathConnectError.malformed}
            try check(!items.isEmpty && items.count <= 64)
            let proposal = JSONValue.object(["type": .string("proposal"), "capabilities": .array(items)])
            let identity = try PeerIdentityVerifier.verify(value: proposal.canonical(), attestation: attestation.canonical(), projects: projects, relay: transport.relay, session: transport.session, expectedRole: "dapp")
            let requested = try items.map {try RequestedCapability.parse($0)}
            try check(Set(requested.map {$0.chain + "/" + ($0.account ?? "*")}).count == requested.count)
            let approved = try await decide(requested, identity)
            try check(!closed && !approved.isEmpty && approved.count <= 64, .invalidState)
            try check(Set(approved.map {$0.chain + "/" + $0.account}).count == approved.count)
            try check(approved.allSatisfy {a in requested.contains {$0.chain == a.chain && ($0.account == nil || $0.account == a.account) && a.methods.isSubset(of: $0.methods)}})
            let reply: [String: JSONValue] = ["type": .string("approved"), "capabilities": .array(approved.map(\.value))]
            let grant = try await getGrant()
            let proof = try JSONValue.parse(await transport.attest(value: JSONValue.object(reply).canonical(), grant: grant))
            var response = reply; response["identity"] = proof
            try await send(.object(response)); capabilities = approved; peer = identity
            return approved
        } catch {await terminate(); throw error}
    }
    public func serveOnce(authorizer: WalletAuthorizer) async throws {
        try begin(); defer {busy = false}
        do {
            guard let capabilities else {throw OathConnectError.invalidState}
            let data = try await receive(deadline: timestamp() + 120)
            try Task.checkCancellation(); try check(!closed, .invalidState)
            let request = try SigningRequest(data: data, capabilities: capabilities)
            try check(!seen.contains(request.id) && seen.count < 1024, .replayOrGap); seen.insert(request.id)
            activeAuthorizer = authorizer
            var result: JSONValue = .null, responseError: JSONValue = .null
            do {result = try await authorizer.handle(data, sessionExpires: channel.expires)} catch {responseError = .string("rejected")}
            activeAuthorizer = nil
            try await send(.object(["type": .string("response"), "id": .string(request.id), "result": result, "error": responseError]))
        } catch {await terminate(); throw error}
    }
    private func terminate() async {closed = true; await activeAuthorizer?.close(); await channel.close(); await transport.close()}
    public func close() async {
        let notify = !closed && !busy
        closed = true; await activeAuthorizer?.close(); await channel.close()
        if notify, let grant = try? await getGrant() {_ = try? await transport.call(method: "DELETE", suffix: "", grant: grant, body: Data())}
        await transport.close()
    }
}
