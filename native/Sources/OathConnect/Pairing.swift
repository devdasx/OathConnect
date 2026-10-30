import Foundation
import CryptoKit

public struct WalletPairing: Sendable {
    public let session: String
    public let relay: String
    public let hello: Data
    public let channel: EncryptedChannel

    /// The trusted relay is supplied by wallet policy, never copied automatically from the QR.
    public static func join(uri: String, trustedRelay: String) throws -> WalletPairing {
        try join(uri: uri, trustedRelay: trustedRelay, now: timestamp(), privateKey: P256.KeyAgreement.PrivateKey())
    }
    static func join(uri: String, trustedRelay: String, now: Int, privateKey: P256.KeyAgreement.PrivateKey) throws -> WalletPairing {
        let prefix = "oathconnect://pair#"
        try check(uri.hasPrefix(prefix) && uri.utf8.count <= 2048)
        let raw = try decode64(String(uri.dropFirst(prefix.count)), maximum: 1400)
        let i = try object(raw, keys: ["v", "session", "relay", "expires", "secret", "publicKey"], maximum: 1400)
        try check(number(i, "v") == 1)
        let session = try string(i, "session"), relay = try string(i, "relay"), expires = try number(i, "expires")
        try validateOrigin(relay); try validateOrigin(trustedRelay); try check(relay == trustedRelay, .untrustedRelay)
        try check(expires > now && expires <= now + 300, .expired)
        _ = try decode64(session, maximum: 32, exact: 32)
        let secret = try decode64(string(i, "secret"), maximum: 32, exact: 32)
        let dapp = try string(i, "publicKey"), wallet = encode64(privateKey.publicKey.x963Representation)
        let peer = try P256.KeyAgreement.PublicKey(x963Representation: decode64(dapp, maximum: 65, exact: 65))
        let transcript = try json(["OathConnect/pair/v1", session, relay, expires, dapp, wallet])
        let mac = encode64(Data(HMAC<SHA256>.authenticationCode(for: transcript, using: SymmetricKey(data: secret))))
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer)
        let transcriptText = String(decoding: transcript, as: UTF8.self)
        func key(_ sender: String) throws -> SymmetricKey {
            shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: secret, sharedInfo: try json(["OathConnect/channel/v1", transcriptText, sender]), outputByteCount: 32)
        }
        return WalletPairing(session: session, relay: relay,
            hello: try json(["v": 1, "session": session, "publicKey": wallet, "mac": mac]),
            channel: EncryptedChannel(session: session, sendKey: try key("wallet"), receiveKey: try key("dapp"), expires: expires + 3300))
    }
}

public actor EncryptedChannel {
    public let session: String
    public let expires: Int
    private let sendKey: SymmetricKey, receiveKey: SymmetricKey
    private var send = 0, receive = 0
    private var closed = false
    init(session: String, sendKey: SymmetricKey, receiveKey: SymmetricKey, expires: Int) {self.session = session; self.sendKey = sendKey; self.receiveKey = receiveKey; self.expires = expires}
    public func close() {closed = true}
    public func seal(json plaintext: Data) throws -> Data {try seal(json: plaintext, now: timestamp())}
    func seal(json plaintext: Data, now: Int, nonce: AES.GCM.Nonce? = nil) throws -> Data {
        try check(!closed && now < expires && send < 4096, .invalidState); try check(plaintext.count <= 24_576, .tooLarge)
        _ = try JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])
        send += 1
        do {
            let aad = try json(["OathConnect/frame/v1", session, "wallet", send, expires])
            let sealed = try AES.GCM.seal(plaintext, using: sendKey, nonce: nonce, authenticating: aad)
            return try json(["v": 1, "session": session, "sender": "wallet", "sequence": send, "expires": expires, "nonce": encode64(Data(sealed.nonce)), "ciphertext": encode64(sealed.ciphertext + sealed.tag)])
        } catch {closed = true; throw error}
    }
    public func open(frame data: Data) throws -> Data {try open(frame: data, now: timestamp())}
    func open(frame data: Data, now: Int) throws -> Data {
        try check(!closed && now < expires, .invalidState)
        let f = try object(data, keys: ["v", "session", "sender", "sequence", "expires", "nonce", "ciphertext"])
        let version = try number(f, "v"), frameSession = try string(f, "session"), sender = try string(f, "sender"), frameExpires = try number(f, "expires")
        try check(version == 1 && frameSession == session && sender == "dapp" && frameExpires == expires)
        let sequence = try number(f, "sequence"); try check(sequence == receive + 1 && sequence <= 4096, .replayOrGap)
        let nonce = try AES.GCM.Nonce(data: decode64(string(f, "nonce"), maximum: 12, exact: 12))
        let ciphertext = try decode64(string(f, "ciphertext"), maximum: 24_592); try check(ciphertext.count >= 16)
        let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
        let aad = try json(["OathConnect/frame/v1", session, "dapp", sequence, expires])
        let clear: Data
        do { clear = try AES.GCM.open(sealed, using: receiveKey, authenticating: aad) } catch { throw OathConnectError.authenticationFailed }
        _ = try JSONSerialization.jsonObject(with: clear, options: [.fragmentsAllowed]); receive = sequence; return clear
    }
}
