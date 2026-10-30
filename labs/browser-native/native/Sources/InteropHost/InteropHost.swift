import Foundation
import OathConnect

// An operator-only, fixed echo fixture. It never loads a blockchain signing key.
enum FixtureError: Error {case invalid, timeout}
struct Configuration: Decodable {
    let uri: String, relay: String, session: String
    let projects: [ApprovedProject]
    let directory: String
}
struct Authorization: Decodable {let session: String, clientKey: String, grant: String}
let expectedParams = JSONValue.object(["message": .string("OathConnect browser/native € 🔐"), "sequence": .integer(1)])

func readBounded(_ path: String) throws -> Data {
    let file = try FileHandle(forReadingFrom: URL(fileURLWithPath: path)); defer {try? file.close()}
    let data = try file.read(upToCount: 65_537) ?? Data()
    guard data.count <= 65_536 else {throw FixtureError.invalid}; return data
}
func writePrivate(_ value: JSONValue, _ path: String) throws {
    // The controller creates a fresh 0700 directory; these files never leave it.
    // Foundation traps when .atomic and .withoutOverwriting are combined.
    // Publish a complete private temporary file with an exclusive destination move.
    let destination = URL(fileURLWithPath: path)
    let temporary = destination.appendingPathExtension(UUID().uuidString + ".tmp")
    try value.canonical().write(to: temporary, options: .withoutOverwriting)
    defer {try? FileManager.default.removeItem(at: temporary)}
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
    try FileManager.default.moveItem(at: temporary, to: destination)
}
actor EchoAdapter: WalletAdapter {
    private(set) var approvals = 0, executions = 0
    func validate(_ request: SigningRequest) throws {
        guard request.chain == "oath:test", request.account == "interop-fixture", request.method == "oath_echo", request.params == expectedParams else {throw FixtureError.invalid}
    }
    func review(_ request: SigningRequest, context: ExecutionContext) async throws -> TransactionReview {
        try await context.checkActive()
        try validate(request)
        return TransactionReview(requestDigest: request.digest, summary: "Fixed interoperability echo; no signing or funds", warnings: [])
    }
    func approve(_ request: SigningRequest, _ review: TransactionReview) throws -> SigningApproval {
        try validate(request)
        guard approvals == 0, review.requestDigest == request.digest else {throw FixtureError.invalid}
        approvals += 1
        return SigningApproval(approved: true, requestDigest: request.digest)
    }
    func execute(_ request: SigningRequest, context: ExecutionContext) async throws -> JSONValue {
        try await context.checkActive()
        try validate(request)
        guard approvals == 1, executions == 0 else {throw FixtureError.invalid}; executions += 1
        return .object(["echo": request.params, "native": .bool(true)])
    }
}
@main struct InteropHost {
    static func run() async throws {
        guard CommandLine.arguments.count == 2 else {throw FixtureError.invalid}
        let config = try JSONDecoder().decode(Configuration.self, from: readBounded(CommandLine.arguments[1]))
        guard config.relay == "https://oathconnect-preview.thuglifex.workers.dev", config.directory.hasPrefix("/tmp/oathconnect-browser-native-") else {throw FixtureError.invalid}
        let pairing = try WalletPairing.join(uri: config.uri, trustedRelay: config.relay)
        guard pairing.session == config.session else {throw FixtureError.invalid}
        let identity = ClientIdentity()
        try writePrivate(.object(["session": .string(config.session), "clientKey": .string(identity.publicKey)]), config.directory + "/wallet-key.json")
        let grantPath = config.directory + "/wallet-grant.json", deadline = Date().addingTimeInterval(30)
        while !FileManager.default.fileExists(atPath: grantPath) {
            guard Date() < deadline else {throw FixtureError.timeout}; try await Task.sleep(for: .milliseconds(100))
        }
        let authorization = try JSONDecoder().decode(Authorization.self, from: readBounded(grantPath))
        guard authorization.session == config.session, authorization.clientKey == identity.publicKey, authorization.grant.utf8.count <= 4096 else {throw FixtureError.invalid}
        let relay = try RelayClient(relay: config.relay, session: pairing.session, identity: identity)
        let session = try WalletSession(pairing: pairing, transport: relay, trustedProjects: config.projects, getGrant: {authorization.grant})
        do {
            try await session.join()
            let capabilities = try await session.approveSession {requested, peer in
                guard peer.project == "oathconnect-validation", peer.role == "dapp", peer.origin == config.relay,
                      requested.count == 1, requested[0].chain == "oath:test", requested[0].account == nil, requested[0].methods == ["oath_echo"] else {throw FixtureError.invalid}
                return [try Capability(chain: "oath:test", account: "interop-fixture", methods: ["oath_echo"])]
            }
            let adapter = EchoAdapter()
            let authorizer = try WalletAuthorizer(capabilities: capabilities, adapters: ["oath:test/oath_echo": adapter], approve: {request, review, _ in try await adapter.approve(request, review)})
            try await session.serveOnce(authorizer: authorizer)
            let approvals = await adapter.approvals, executions = await adapter.executions
            guard approvals == 1, executions == 1 else {throw FixtureError.invalid}
            try writePrivate(.object(["status": .string("passed"), "session": .string(config.session), "approvals": .integer(Int64(approvals)), "executions": .integer(Int64(executions)), "platform": .string(ProcessInfo.processInfo.operatingSystemVersionString)]), config.directory + "/native-result.json")
            print("Native fixture: one approval and one echo execution; waiting for browser receipt.")
            // Do not delete the queued reply before the browser has consumed it.
            let finish = Date().addingTimeInterval(90)
            while !FileManager.default.fileExists(atPath: config.directory + "/finish") && Date() < finish {try await Task.sleep(for: .milliseconds(250))}
            await authorizer.close(); await session.close()
        } catch {await session.close(); throw error}
    }
    static func main() async {
        do {try await run()}
        catch {print("Native fixture failed; no credential or request data logged."); exit(1)}
    }
}
