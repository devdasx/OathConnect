// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "OathConnectInteropHost", platforms: [.macOS(.v13)],
    dependencies: [.package(path: "../../..")],
    targets: [.executableTarget(name: "InteropHost", dependencies: [.product(name: "OathConnect", package: "OathConnect")])]
)
