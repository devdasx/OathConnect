import Foundation
import CryptoKit

/// Obtain this registry through an authenticated wallet update or a separately pinned channel.
/// A registry fetched only from the relay cannot authenticate that relay's peers independently.
public struct ApprovedProject: Codable, Sendable {
    public let id: String, name: String
    public let roles: [String], origins: [String], keys: [String: String]
    public let enabled: Bool
    public let notAfter: Int?
    public init(id: String, name: String, roles: [String], origins: [String], keys: [String: String], enabled: Bool, notAfter: Int? = nil) {
        self.id = id; self.name = name; self.roles = roles; self.origins = origins; self.keys = keys; self.enabled = enabled; self.notAfter = notAfter
    }
}
public struct PeerIdentity: Sendable, Equatable {
    public let project: String, name: String, origin: String, role: String
}
public enum PeerIdentityVerifier {
    public static func verify(value: Data, attestation: Data, projects: [ApprovedProject], relay: String, session: String, expectedRole: String) throws -> PeerIdentity {
        try verify(value: value, attestation: attestation, projects: projects, relay: relay, session: session, expectedRole: expectedRole, now: timestamp())
    }
    static func verify(value: Data, attestation: Data, projects: [ApprovedProject], relay: String, session: String, expectedRole: String, now: Int) throws -> PeerIdentity {
        try validateOrigin(relay); _ = try decode64(session, maximum: 32, exact: 32)
        try check(["wallet", "dapp"].contains(expectedRole) && projects.count <= 1024)
        let a = try object(attestation, keys: ["origin", "grant", "proof"], maximum: 8192)
        let origin = try string(a, "origin"), token = try string(a, "grant"), proof = try string(a, "proof")
        try check(token.utf8.count <= 4096)
        let pieces = token.split(separator: ".", omittingEmptySubsequences: false)
        try check(pieces.count == 2)
        let payload = String(pieces[0])
        let g = try object(decode64(payload, maximum: 2048), keys: ["v", "project", "kid", "audience", "session", "role", "origin", "clientKey", "issued", "expires", "id"], maximum: 2048)
        try check(number(g, "v") == 1)
        let id = try string(g, "project"), kid = try string(g, "kid"), audience = try string(g, "audience"), role = try string(g, "role"), grantOrigin = try string(g, "origin")
        try check([id, kid].allSatisfy {$0.range(of: "^[a-z0-9][a-z0-9_-]{0,63}$", options: .regularExpression) != nil})
        try check(audience == relay && string(g, "session") == session && role == expectedRole)
        let issued = try number(g, "issued"), expires = try number(g, "expires")
        try check(issued >= now - 300 && issued <= now + 5 && expires > now && expires <= now + 305 && expires > issued && expires - issued <= 300, .expired)
        _ = try decode64(string(g, "id"), maximum: 16, exact: 16)
        guard let project = projects.first(where: {$0.id == id && $0.enabled}), project.roles.contains(role), project.notAfter == nil || now < project.notAfter!, let issuer = project.keys[kid] else {throw OathConnectError.authenticationFailed}
        try check(origin == grantOrigin)
        if origin.isEmpty {try check(role == "wallet")} else {try validateOrigin(origin); try check(project.origins.contains(origin))}
        let issuerKey = try Curve25519.Signing.PublicKey(rawRepresentation: decode64(issuer, maximum: 32, exact: 32))
        let signature = try decode64(String(pieces[1]), maximum: 64, exact: 64)
        try check(issuerKey.isValidSignature(signature, for: Data(("OathConnect/grant/v1." + payload).utf8)), .authenticationFailed)
        let p = try object(decode64(proof, maximum: 512), keys: ["v", "at", "nonce", "signature"], maximum: 512)
        try check(number(p, "v") == 1)
        let at = try number(p, "at"), nonce = try string(p, "nonce")
        try check(at >= now - 30 && at <= now + 5, .expired); _ = try decode64(nonce, maximum: 16, exact: 16)
        let body = try JSONValue.parse(value).canonical()
        let signed = try json(["OathConnect/proof/v1", hash(Data(token.utf8)), "ATTEST", "/v1/sessions/" + session, hash(body), at, nonce])
        let clientKey = try Curve25519.Signing.PublicKey(rawRepresentation: decode64(string(g, "clientKey"), maximum: 32, exact: 32))
        try check(clientKey.isValidSignature(decode64(string(p, "signature"), maximum: 64, exact: 64), for: signed), .authenticationFailed)
        return PeerIdentity(project: id, name: project.name, origin: origin, role: role)
    }
}
