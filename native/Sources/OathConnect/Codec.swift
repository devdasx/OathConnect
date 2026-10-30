import Foundation
import CryptoKit

public enum OathConnectError: Error, Equatable, Sendable {
    case malformed, untrustedRelay, expired, invalidState, authenticationFailed, replayOrGap, tooLarge, relayRejected, deliveryUnknown
}
func check(_ condition: Bool, _ error: OathConnectError = .malformed) throws { if !condition { throw error } }
func encode64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
func decode64(_ value: String, maximum: Int, exact: Int? = nil) throws -> Data {
    try check(!value.isEmpty && value.utf8.count <= (maximum * 4 + 2) / 3 && value.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil)
    let base = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    guard let data = Data(base64Encoded: base + String(repeating: "=", count: (4 - base.count % 4) % 4)) else { throw OathConnectError.malformed }
    try check(data.count <= maximum && encode64(data) == value && (exact == nil || data.count == exact))
    return data
}
func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]) }
func object(_ data: Data, keys: Set<String>, maximum: Int = 36_000) throws -> [String: Any] {
    try check(data.count <= maximum, .tooLarge)
    guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], Set(result.keys) == keys else { throw OathConnectError.malformed }
    return result
}
func timestamp() -> Int { Int(Date().timeIntervalSince1970) }
func string(_ object: [String: Any], _ key: String) throws -> String { guard let value = object[key] as? String else { throw OathConnectError.malformed }; return value }
func number(_ object: [String: Any], _ key: String) throws -> Int {
    guard let n = object[key] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite, abs(n.doubleValue) <= 9_007_199_254_740_991, n.doubleValue.rounded(.towardZero) == n.doubleValue else { throw OathConnectError.malformed }
    return n.intValue
}
func validateOrigin(_ value: String) throws {
    guard let u = URLComponents(string: value), u.scheme == "https", u.host != nil, u.user == nil, u.password == nil, u.path.isEmpty, u.query == nil, u.fragment == nil, value.utf8.count <= 256 else { throw OathConnectError.untrustedRelay }
}
func hash(_ data: Data) -> String { encode64(Data(SHA256.hash(data: data))) }

import CoreFoundation
