// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "OathConnect",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "OathConnect", targets: ["OathConnect"])],
    targets: [
        .target(name: "OathConnect", path: "native/Sources/OathConnect"),
        .testTarget(name: "OathConnectTests", dependencies: ["OathConnect"], path: "native/Tests/OathConnectTests", resources: [.process("Fixtures")])
    ]
)
