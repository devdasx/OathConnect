import XCTest
@testable import OathConnect

private actor ExecutionGate {
    private var entered = false
    private var waiting: CheckedContinuation<Void, Never>?, observer: CheckedContinuation<Void, Never>?
    func pause() async {
        entered = true; observer?.resume(); observer = nil
        await withCheckedContinuation {waiting = $0}
    }
    func waitUntilEntered() async {if !entered {await withCheckedContinuation {observer = $0}}}
    func release() {waiting?.resume(); waiting = nil}
}
private actor PendingAdapter: WalletAdapter {
    let gate: ExecutionGate
    private(set) var broadcasts = 0
    private(set) var retainedContext: ExecutionContext?
    init(gate: ExecutionGate) {self.gate = gate}
    func review(_ request: SigningRequest, context: ExecutionContext) async throws -> TransactionReview {
        try await context.checkActive()
        return .init(requestDigest: request.digest, summary: "Pending execution fixture", warnings: [])
    }
    func execute(_ request: SigningRequest, context: ExecutionContext) async throws -> JSONValue {
        retainedContext = context
        // Models a signing engine or network operation suspended across an await.
        await gate.pause()
        try await context.checkActive()
        broadcasts += 1; return .bool(true)
    }
}
final class ExecutionContextTests: XCTestCase, @unchecked Sendable {
    func testClosureCancellationAndDeadlineDuringExecutionPreventBroadcast() async throws {
        for action in ["close", "cancel", "expire", "complete"] {
            let gate = ExecutionGate(), adapter = PendingAdapter(gate: gate)
            let cap = try Capability(chain: "eip155:11155111", account: "test-account", methods: ["test_sign"])
            let authorizer = try WalletAuthorizer(capabilities: [cap], adapters: [cap.chain + "/test_sign": adapter]) {_, review, context in
                try await context.checkActive(); return .init(approved: true, requestDigest: review.requestDigest)
            }
            let data = try json(["type": "request", "id": encode64(Data(repeating: 9, count: 16)), "chain": cap.chain, "account": cap.account, "method": "test_sign", "params": [:], "expires": timestamp() + 120])
            let deadline = timestamp() + (action == "expire" ? 2 : 60)
            let task = Task {try await authorizer.handle(data, sessionExpires: deadline)}
            await gate.waitUntilEntered()
            if action == "close" {await authorizer.close()}
            if action == "cancel" {task.cancel()}
            if action == "expire" {try await Task.sleep(for: .milliseconds(2100))}
            await gate.release()
            if action == "complete" {let result = try await task.value; XCTAssertEqual(result, .bool(true))}
            else {do {_ = try await task.value; XCTFail("Inactive execution broadcast")} catch {}}
            let broadcasts = await adapter.broadcasts
            XCTAssertEqual(broadcasts, action == "complete" ? 1 : 0, action)
            let retained = await adapter.retainedContext
            do {try await retained!.checkActive(); XCTFail("Context outlived its owning request")} catch {}
        }
    }
}
