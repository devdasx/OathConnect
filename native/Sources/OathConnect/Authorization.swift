import Foundation
import CryptoKit

public enum JSONValue: Codable, Sendable, Equatable {
    case null, bool(Bool), integer(Int64), string(String), array([JSONValue]), object([String: JSONValue])
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {self = .null}
        else if let b = try? c.decode(Bool.self) {self = .bool(b)}
        else if let n = try? c.decode(Int64.self), n >= -9_007_199_254_740_991 && n <= 9_007_199_254_740_991 {self = .integer(n)}
        else if let s = try? c.decode(String.self) {self = .string(s)}
        else if let a = try? c.decode([JSONValue].self) {self = .array(a)}
        else if let o = try? c.decode([String: JSONValue].self) {self = .object(o)}
        else {throw OathConnectError.malformed}
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {case .null: try c.encodeNil(); case .bool(let b):try c.encode(b); case .integer(let n):try c.encode(n); case .string(let s):try c.encode(s); case .array(let a):try c.encode(a); case .object(let o):try c.encode(o)}
    }
    public static func parse(_ data: Data) throws -> JSONValue {
        try check(data.count <= 24_576, .tooLarge)
        var depth = 0, quoted = false, escaped = false
        for byte in data {
            if quoted {
                if escaped {escaped = false} else if byte == 92 {escaped = true} else if byte == 34 {quoted = false}
            } else if byte == 34 {quoted = true}
            else if byte == 123 || byte == 91 {depth += 1; try check(depth <= 24, .tooLarge)}
            else if byte == 125 || byte == 93 {depth -= 1; try check(depth >= 0)}
        }
        try check(depth == 0 && !quoted)
        let value = try JSONDecoder().decode(JSONValue.self, from: data)
        _ = try value.canonical(); return value
    }
    public func canonical() throws -> Data {Data(try serialized(depth: 0).utf8)}
    private func serialized(depth: Int) throws -> String {
        try check(depth <= 24, .tooLarge)
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .integer(let n): try check(n >= -9_007_199_254_740_991 && n <= 9_007_199_254_740_991); return String(n)
        case .string(let s): return Self.quote(s)
        case .array(let a): try check(a.count <= 1024); return "[" + (try a.map {try $0.serialized(depth: depth + 1)}).joined(separator: ",") + "]"
        case .object(let o):
            try check(o.count <= 128)
            try check(o.keys.allSatisfy {!$0.isEmpty && $0.utf8.count <= 128 && $0.utf8.allSatisfy {$0 >= 32 && $0 <= 126}})
            let keys = o.keys.sorted {$0.utf16.lexicographicallyPrecedes($1.utf16)}
            return "{" + (try keys.map {Self.quote($0) + ":" + (try o[$0]!.serialized(depth: depth + 1))}).joined(separator: ",") + "}"
        }
    }
    private static func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar.value {
            case 34: out += "\\\""; case 92: out += "\\\\"; case 8: out += "\\b"; case 12: out += "\\f"; case 10: out += "\\n"; case 13: out += "\\r"; case 9: out += "\\t"
            case 0..<32: out += String(format: "\\u%04x", scalar.value)
            default: out.unicodeScalars.append(scalar)
            }
        }
        return out + "\""
    }
    var fields: [String: JSONValue]? {if case .object(let v) = self {return v}; return nil}
    var text: String? {if case .string(let v) = self {return v}; return nil}
    var int: Int64? {if case .integer(let v) = self {return v}; return nil}
}

public struct Capability: Sendable, Equatable {
    public let chain: String, account: String
    public let methods: Set<String>
    public init(chain: String, account: String, methods: Set<String>) throws {
        try check(chain.range(of: "^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$", options: .regularExpression) != nil)
        try check(account.range(of: "^[A-Za-z0-9:._-]{1,256}$", options: .regularExpression) != nil)
        try check(!methods.isEmpty && methods.count <= 32 && methods.allSatisfy {$0.range(of: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$", options: .regularExpression) != nil})
        self.chain = chain; self.account = account; self.methods = methods
    }
}
public struct SigningRequest: Sendable {
    public let id: String, chain: String, account: String, method: String
    public let params: JSONValue
    public let expires: Int
    public let canonicalData: Data
    public var digest: String {hash(canonicalData)}
    public init(data: Data, capabilities: [Capability], now: Int = Int(Date().timeIntervalSince1970)) throws {
        let value = try JSONValue.parse(data)
        guard let fields = value.fields, Set(fields.keys) == ["type","id","chain","account","method","params","expires"], fields["type"]?.text == "request",
              let id = fields["id"]?.text, let chain = fields["chain"]?.text, let account = fields["account"]?.text, let method = fields["method"]?.text,
              let expires = fields["expires"]?.int, let params = fields["params"] else {throw OathConnectError.malformed}
        _ = try decode64(id, maximum: 16, exact: 16)
        try check(expires > now && expires <= now + 120, .expired)
        try check(capabilities.contains {$0.chain == chain && $0.account == account && $0.methods.contains(method)}, .invalidState)
        canonicalData = try value.canonical(); try check(canonicalData.count <= 22_000, .tooLarge)
        self.id = id; self.chain = chain; self.account = account; self.method = method; self.params = params; self.expires = Int(expires)
    }
}
public struct TransactionReview: Sendable {
    public let requestDigest: String, summary: String
    public let warnings: [String]
    public init(requestDigest: String, summary: String, warnings: [String]) {self.requestDigest = requestDigest; self.summary = summary; self.warnings = warnings}
}
public struct SigningApproval: Sendable {
    public let approved: Bool, requestDigest: String
    public init(approved: Bool, requestDigest: String) {self.approved = approved; self.requestDigest = requestDigest}
}
/// Recheck after awaits and immediately before signing/broadcasting. This context
/// becomes invalid when the authorizer closes or the owning handle call ends.
public struct ExecutionContext: Sendable {
    public let deadline: Int
    private let validate: @Sendable () async throws -> Void
    init(deadline: Int, validate: @escaping @Sendable () async throws -> Void) {self.deadline = deadline; self.validate = validate}
    public func checkActive() async throws {
        try Task.checkCancellation(); try await validate(); try Task.checkCancellation()
    }
}
public protocol WalletAdapter: Sendable {
    func review(_ request: SigningRequest, context: ExecutionContext) async throws -> TransactionReview
    func execute(_ request: SigningRequest, context: ExecutionContext) async throws -> JSONValue
}
public actor WalletAuthorizer {
    private let capabilities: [Capability], adapters: [String: any WalletAdapter]
    private let approve: @Sendable (SigningRequest, TransactionReview, ExecutionContext) async throws -> SigningApproval
    private var seen: Set<String> = [], closed = false, busy = false
    private var executionID: UUID?
    public init(capabilities: [Capability], adapters: [String: any WalletAdapter], approve: @escaping @Sendable (SigningRequest, TransactionReview, ExecutionContext) async throws -> SigningApproval) throws {
        try check(!capabilities.isEmpty && capabilities.count <= 64)
        self.capabilities = capabilities; self.adapters = adapters; self.approve = approve
    }
    public func close() {closed = true; executionID = nil}
    private func checkExecution(_ id: UUID, deadline: Int) throws {
        try check(!closed && busy && executionID == id, .invalidState)
        try check(timestamp() < deadline, .expired)
    }
    /// A pending approval cannot extend the owning session's expiry.
    public func handle(_ data: Data, sessionExpires: Int? = nil) async throws -> JSONValue {
        try Task.checkCancellation()
        try check(!closed && !busy, .invalidState)
        let request = try SigningRequest(data: data, capabilities: capabilities)
        let deadline = min(request.expires, sessionExpires ?? Int.max)
        try check(timestamp() < deadline, .expired)
        try check(seen.count < 1024 && !seen.contains(request.id), .replayOrGap)
        seen.insert(request.id); busy = true
        let id = UUID(); executionID = id
        defer {busy = false; executionID = nil}
        let context = ExecutionContext(deadline: deadline) {[weak self] in
            guard let self else {throw OathConnectError.invalidState}
            try await self.checkExecution(id, deadline: deadline)
        }
        guard let adapter = adapters[request.chain + "/" + request.method] else {throw OathConnectError.invalidState}
        let review = try await adapter.review(request, context: context)
        try Task.checkCancellation()
        try check(review.requestDigest == request.digest && !review.summary.isEmpty && review.summary.count <= 4000 && review.warnings.count <= 20 && review.warnings.allSatisfy {$0.count <= 500})
        try check(!closed && timestamp() < deadline, .expired)
        let approval = try await approve(request, review, context)
        try Task.checkCancellation()
        try check(!closed && timestamp() < deadline, .expired)
        try check(approval.approved && approval.requestDigest == request.digest, .invalidState)
        let result = try await adapter.execute(request, context: context)
        try check(result.canonical().count <= 22_000, .tooLarge); return result
    }
}
