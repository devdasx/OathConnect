import XCTest
@testable import OathConnect

final class IdentityTests: XCTestCase {
    func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "identity", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    func testTypeScriptAdmissionAndProofInteroperate() throws {
        let f = try fixture(), a = try XCTUnwrap(f["attestation"] as? [String: Any])
        let projects = try JSONDecoder().decode([ApprovedProject].self, from: json([f["project"]!]))
        let identity = try PeerIdentityVerifier.verify(value: json(f["value"]!), attestation: json(a), projects: projects, relay: string(f,"relay"), session: string(f,"session"), expectedRole: "dapp", now: number(f,"now"))
        XCTAssertEqual(identity.project, "example"); XCTAssertEqual(identity.origin, "https://app.example.org")
        let proof = try object(decode64(string(a,"proof"), maximum:512), keys:["v","at","nonce","signature"])
        let key = try ClientIdentity(testKey: decode64(string(f,"clientSeed"), maximum:32, exact:32))
        let nativeProof = try key.proof(grant: string(a,"grant"), method:"ATTEST", path:"/v1/sessions/" + string(f,"session"), body: JSONValue.parse(json(f["value"]!)).canonical(), at:number(f,"now"), nonce:string(proof,"nonce"))
        // Valid Ed25519 signatures need not have byte-identical nonces across providers.
        var nativeAttestation = a; nativeAttestation["proof"] = nativeProof
        let verifiedNative = try PeerIdentityVerifier.verify(value:json(f["value"]!), attestation:json(nativeAttestation), projects:projects, relay:string(f,"relay"), session:string(f,"session"), expectedRole:"dapp", now:number(f,"now"))
        XCTAssertEqual(verifiedNative,identity)
    }
    func testWrongPeerOriginExpiredAndTamperedPayloadRejected() throws {
        let f = try fixture(), a = try XCTUnwrap(f["attestation"] as? [String: Any])
        let projects = try JSONDecoder().decode([ApprovedProject].self, from: json([f["project"]!]))
        func verify(_ value: Any, _ attestation: [String: Any], _ role:String = "dapp", _ offset:Int = 0, _ registry:[ApprovedProject]? = nil) throws {
            _ = try PeerIdentityVerifier.verify(value:json(value), attestation:json(attestation), projects:registry ?? projects, relay:string(f,"relay"), session:string(f,"session"), expectedRole:role, now:number(f,"now") + offset)
        }
        XCTAssertThrowsError(try verify(["type":"tampered"],a))
        XCTAssertThrowsError(try verify(f["value"]!,a,"wallet"))
        XCTAssertThrowsError(try verify(f["value"]!,a,"dapp",31))
        XCTAssertThrowsError(try verify(f["value"]!,a,"dapp",0,[]))
        var altered = a; altered["origin"] = "https://attacker.example"
        XCTAssertThrowsError(try verify(f["value"]!,altered))
    }
}
