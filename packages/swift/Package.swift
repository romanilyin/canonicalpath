// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "CanonicalPath",
    platforms: [
        .macOS(.v13),
        .iOS(.v16)
    ],
    products: [
        .library(name: "CanonicalPath", targets: ["CanonicalPath"])
    ],
    targets: [
        .target(name: "CanonicalPath", path: "Sources/CanonicalPath")
    ]
)
