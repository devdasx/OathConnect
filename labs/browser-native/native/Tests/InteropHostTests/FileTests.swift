import XCTest
import Foundation
@testable import InteropHost

final class FileTests: XCTestCase {
    func testPrivatePublicationAndExistingFilePreservation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("oathconnect-file-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer {try? FileManager.default.removeItem(at: directory)}
        let path = directory.appendingPathComponent("result.json").path
        try writePrivate(.object(["test": .bool(true)]), path)
        let first = try readBounded(path)
        XCTAssertEqual(String(decoding: first, as: UTF8.self), "{\"test\":true}")
        let permissions = try FileManager.default.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(permissions?.intValue, 0o600)
        XCTAssertThrowsError(try writePrivate(.null, path))
        XCTAssertEqual(try readBounded(path), first)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["result.json"])
        try Data(repeating: 0, count: 65_537).write(to: URL(fileURLWithPath: path))
        XCTAssertThrowsError(try readBounded(path))
    }
}
