import XCTest
import CryptoKit
@testable import OathConnect

private actor TestRelay: WalletRelay {
    nonisolated let relay = "https://relay.example.org", session: String
    let sendKey: SymmetricKey, receiveKey: SymmetricKey
    let expires: Int
    var inbox: [Data], replies: [JSONValue] = [], closed = false
    init(session: String, sendKey: SymmetricKey, receiveKey: SymmetricKey, expires: Int, inbox: [Data]) {
        self.session = session; self.sendKey = sendKey; self.receiveKey = receiveKey; self.expires = expires; self.inbox = inbox
    }
    func call(method: String, suffix: String, grant: String, body: Data) throws -> Data {
        try check(!closed)
        if method == "GET" {return try json(["messages": try inbox.prefix(1).map {try JSONSerialization.jsonObject(with: $0)}])}
        if method == "DELETE" && suffix.hasPrefix("/messages") {inbox.removeFirst()}
        if method == "POST" {
            let f = try object(body, keys:["v","session","sender","sequence","expires","nonce","ciphertext"])
            let bytes = try decode64(string(f,"ciphertext"),maximum:24592)
            let box = try AES.GCM.SealedBox(nonce:AES.GCM.Nonce(data:decode64(string(f,"nonce"),maximum:12,exact:12)),ciphertext:bytes.dropLast(16),tag:bytes.suffix(16))
            let aad = try json(["OathConnect/frame/v1",session,"wallet",number(f,"sequence"),expires])
            replies.append(try JSONValue.parse(AES.GCM.open(box,using:sendKey,authenticating:aad)))
        }
        return Data("{}".utf8)
    }
    func attest(value: Data, grant: String) throws -> Data {try json(["origin":"", "grant":grant, "proof":"test-transport-only"])}
    func close() {closed = true}
    func count() -> Int {replies.count}
    func last() -> JSONValue? {replies.last}
}
private actor SessionAdapter: WalletAdapter {
    var executed = 0
    func review(_ request: SigningRequest) -> TransactionReview {.init(requestDigest:request.digest,summary:"Test-only action",warnings:[])}
    func execute(_ request: SigningRequest) -> JSONValue {executed += 1; return .string("test-result")}
    func count() -> Int {executed}
}
final class SessionTests: XCTestCase, @unchecked Sendable {
    private func fixture(chain: String = "eip155:11155111") throws -> (WalletSession, TestRelay, Capability) {
        let now = timestamp(), expires = now + 3600, session = encode64(Data(repeating:4,count:32))
        let send = SymmetricKey(size:.bits256), receive = SymmetricKey(size:.bits256)
        let issuer = Curve25519.Signing.PrivateKey(), client = ClientIdentity()
        let project = ApprovedProject(id:"test",name:"Approved test website",roles:["dapp"],origins:["https://app.example.org"],keys:["one":encode64(issuer.publicKey.rawRepresentation)],enabled:true)
        let grant = try json(["v":1,"project":"test","kid":"one","audience":"https://relay.example.org","session":session,"role":"dapp","origin":"https://app.example.org","clientKey":client.publicKey,"issued":now,"expires":now+300,"id":encode64(Data(repeating:8,count:16))])
        let payload = encode64(grant), token = payload + "." + encode64(try issuer.signature(for:Data(("OathConnect/grant/v1."+payload).utf8)))
        let caps: JSONValue = .array([.object(["chain":.string("eip155:11155111"),"methods":.array([.string("test_sign")])])])
        let proposal = JSONValue.object(["type":.string("proposal"),"capabilities":caps])
        let attestation = JSONValue.object(["origin":.string("https://app.example.org"),"grant":.string(token),"proof":.string(try client.proof(grant:token,method:"ATTEST",path:"/v1/sessions/"+session,body:proposal.canonical()))])
        let request = JSONValue.object(["type":.string("request"),"id":.string(encode64(Data(repeating:9,count:16))),"chain":.string(chain),"account":.string("test-account"),"method":.string("test_sign"),"params":.object([:]),"expires":.integer(Int64(now+120))])
        let values: [JSONValue] = [.object(["type":.string("proposal"),"capabilities":caps,"identity":attestation]),request]
        let frames = try values.enumerated().map {index,value in
            let aad = try json(["OathConnect/frame/v1",session,"dapp",index+1,expires])
            let box = try AES.GCM.seal(value.canonical(),using:receive,authenticating:aad)
            return try json(["v":1,"session":session,"sender":"dapp","sequence":index+1,"expires":expires,"nonce":encode64(Data(box.nonce)),"ciphertext":encode64(box.ciphertext+box.tag)])
        }
        let transport = TestRelay(session:session,sendKey:send,receiveKey:receive,expires:expires,inbox:frames)
        let pairing = WalletPairing(session:session,relay:transport.relay,hello:Data("{}".utf8),channel:EncryptedChannel(session:session,sendKey:send,receiveKey:receive,expires:expires))
        let native = try WalletSession(pairing:pairing,transport:transport,trustedProjects:[project],getGrant:{"test-transport-grant"})
        return (native,transport,try Capability(chain:"eip155:11155111",account:"test-account",methods:["test_sign"]))
    }
    func testNegotiationAndApprovedRequest() async throws {
        let (session, relay, cap) = try fixture(); try await session.join()
        let approved = try await session.approveSession {requested,peer in
            XCTAssertNil(requested[0].account); XCTAssertEqual(peer.name,"Approved test website"); return [cap]
        }
        XCTAssertEqual(approved,[cap]); let adapter = SessionAdapter()
        let authorizer = try WalletAuthorizer(capabilities:[cap],adapters:[cap.chain+"/test_sign":adapter],approve:{_,review in .init(approved:true,requestDigest:review.requestDigest)})
        try await session.serveOnce(authorizer:authorizer)
        let count = await adapter.count(), replies = await relay.count(), last = await relay.last()
        XCTAssertEqual(count,1); XCTAssertEqual(replies,2); XCTAssertEqual(last?.fields?["result"],.string("test-result")); await session.close()
    }
    func testNegotiatedGrantIndependentlyRejectsOtherChain() async throws {
        let (session, relay, cap) = try fixture(chain:"eip155:1"); try await session.join()
        _ = try await session.approveSession {_,_ in [cap]}
        let adapter = SessionAdapter(), wider = try Capability(chain:"eip155:1",account:"test-account",methods:["test_sign"])
        let authorizer = try WalletAuthorizer(capabilities:[wider],adapters:[wider.chain+"/test_sign":adapter],approve:{_,review in .init(approved:true,requestDigest:review.requestDigest)})
        do {try await session.serveOnce(authorizer:authorizer); XCTFail("Unauthorized request accepted")} catch {}
        let count = await adapter.count(), replies = await relay.count(); XCTAssertEqual(count,0); XCTAssertEqual(replies,1)
    }
    func testClosingDuringSessionPromptPreventsApprovalReply() async throws {
        let (session, relay, cap) = try fixture(); try await session.join()
        do {_ = try await session.approveSession {_,_ in await session.close(); return [cap]}; XCTFail("Closed session approved")} catch {}
        let replies = await relay.count(); XCTAssertEqual(replies,0)
    }
}
