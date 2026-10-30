import XCTest
@testable import OathConnect

private actor FixtureAdapter: WalletAdapter {
    var executions = 0
    func review(_ request: SigningRequest) async throws -> TransactionReview {TransactionReview(requestDigest: request.digest, summary: "Local test only", warnings: [])}
    func execute(_ request: SigningRequest) async throws -> JSONValue {executions += 1; return .bool(true)}
}
final class AuthorizationTests: XCTestCase {
    func request() throws -> Data {
        try json(["type":"request", "id":encode64(Data(repeating: 8, count: 16)), "chain":"eip155:11155111", "account":"test-account", "method":"personal_sign", "params":["test message"], "expires":timestamp() + 120])
    }
    func testApprovalAndReplay() async throws {
        let cap = try Capability(chain: "eip155:11155111", account: "test-account", methods: ["personal_sign"])
        let adapter = FixtureAdapter()
        let authorizer = try WalletAuthorizer(capabilities: [cap], adapters: ["eip155:11155111/personal_sign":adapter]) {_, review in SigningApproval(approved: true, requestDigest: review.requestDigest)}
        let data = try request(), result = try await authorizer.handle(data)
        XCTAssertEqual(result, .bool(true))
        do {_ = try await authorizer.handle(data); XCTFail("Duplicate executed")} catch {XCTAssertEqual(error as? OathConnectError, .replayOrGap)}
        let executions = await adapter.executions; XCTAssertEqual(executions, 1)
    }
    func testRejectedApprovalNeverExecutes() async throws {
        let cap = try Capability(chain: "eip155:11155111", account: "test-account", methods: ["personal_sign"])
        let adapter = FixtureAdapter()
        let authorizer = try WalletAuthorizer(capabilities: [cap], adapters: ["eip155:11155111/personal_sign":adapter]) {_, _ in SigningApproval(approved: false, requestDigest: "")}
        do {_ = try await authorizer.handle(request()); XCTFail("Rejection ignored")} catch {XCTAssertEqual(error as? OathConnectError, .invalidState)}
        let executions = await adapter.executions; XCTAssertEqual(executions, 0)
    }
    func testCanonicalJSONAndHostileNumbers() throws {
        XCTAssertEqual(String(decoding: try JSONValue.parse(Data("{\"z\":1,\"a\":\"line\\n/\"}".utf8)).canonical(), as: UTF8.self), "{\"a\":\"line\\n/\",\"z\":1}")
        XCTAssertThrowsError(try JSONValue.parse(Data("-9223372036854775808".utf8)))
        XCTAssertThrowsError(try JSONValue.parse(Data("9007199254740992".utf8)))
        XCTAssertThrowsError(try JSONValue.parse(Data((String(repeating: "[", count: 25) + "0" + String(repeating: "]", count: 25)).utf8)))
        XCTAssertThrowsError(try JSONValue.parse(Data("1.5".utf8)))
    }
    func testCancellationDuringApprovalNeverExecutes() async throws {
        let cap = try Capability(chain: "eip155:11155111", account: "test-account", methods: ["personal_sign"])
        let adapter = FixtureAdapter()
        let authorizer = try WalletAuthorizer(capabilities: [cap], adapters: ["eip155:11155111/personal_sign":adapter]) {_, review in
            withUnsafeCurrentTask { $0?.cancel() }
            return SigningApproval(approved: true, requestDigest: review.requestDigest)
        }
        let data = try request()
        let task = Task {try await authorizer.handle(data)}
        do {_ = try await task.value; XCTFail("Cancelled approval executed")} catch {XCTAssertTrue(error is CancellationError)}
        let executions = await adapter.executions; XCTAssertEqual(executions, 0)
    }
}
