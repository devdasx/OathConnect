import XCTest
import CryptoKit
@testable import OathConnect

final class InteropTests: XCTestCase {
    func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "v1", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    func testTypeScriptCryptoVectorAndReplay() async throws {
        let f = try fixture(), now = try number(f, "now"), uri = try string(f, "uri")
        let privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: decode64(string(f, "walletPrivate"), maximum: 32, exact: 32))
        let p = try WalletPairing.join(uri: uri, trustedRelay: "https://relay.example.org", now: now, privateKey: privateKey)
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: p.hello)), try json(f["hello"]!))
        let frames = try XCTUnwrap(f["frames"] as? [String: Any])
        let clear = try await p.channel.open(frame: json(frames["dapp"]!), now: now)
        XCTAssertEqual(String(decoding: clear, as: UTF8.self), try string(f, "plaintext"))
        do { _ = try await p.channel.open(frame: json(frames["dapp"]!), now: now); XCTFail("Replay accepted") } catch {XCTAssertEqual(error as? OathConnectError, .replayOrGap)}
        let encrypted = try await p.channel.seal(json: Data(string(f, "plaintext").utf8), now: now, nonce: AES.GCM.Nonce(data: Data(repeating: 5, count: 12)))
        XCTAssertEqual(try json(JSONSerialization.jsonObject(with: encrypted)), try json(frames["wallet"]!))
    }
    func testTrustAndStrictParsing() throws {
        let f = try fixture(), now = try number(f, "now"), uri = try string(f, "uri")
        let key = P256.KeyAgreement.PrivateKey()
        XCTAssertThrowsError(try WalletPairing.join(uri: uri, trustedRelay: "https://evil.example", now: now, privateKey: key))
        XCTAssertThrowsError(try WalletPairing.join(uri: uri, trustedRelay: "https://relay.example.org", now: now + 301, privateKey: key))
        XCTAssertThrowsError(try decode64("Zh", maximum: 1))
        XCTAssertThrowsError(try decode64("Zg=", maximum: 1))
        XCTAssertThrowsError(try number(["v": true], "v"))
    }
    func testTamperingDoesNotConsumeCounter() async throws {
        let f = try fixture(), now = try number(f, "now")
        let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: decode64(string(f, "walletPrivate"), maximum: 32))
        let p = try WalletPairing.join(uri: string(f, "uri"), trustedRelay: "https://relay.example.org", now: now, privateKey: key)
        let frames = try XCTUnwrap(f["frames"] as? [String: Any]); var bad = try XCTUnwrap(frames["dapp"] as? [String: Any])
        bad["nonce"] = encode64(Data(repeating: 6, count: 12))
        do {_ = try await p.channel.open(frame: json(bad), now: now); XCTFail("Tamper accepted")} catch {XCTAssertEqual(error as? OathConnectError, .authenticationFailed)}
        _ = try await p.channel.open(frame: json(frames["dapp"]!), now: now)
        await p.channel.close()
        do {_ = try await p.channel.seal(json: Data("{}".utf8), now: now); XCTFail("Closed channel accepted")} catch {XCTAssertEqual(error as? OathConnectError, .invalidState)}
    }
}
