// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "ContactsBridge",
  platforms: [
    .macOS(.v12)
  ],
  dependencies: [
    .package(url: "https://github.com/raycast/extensions-swift-tools", from: "1.0.5"),
  ],
  targets: [
    .executableTarget(
      name: "ContactsBridge",
      dependencies: [
        .product(name: "RaycastSwiftMacros", package: "extensions-swift-tools"),
        .product(name: "RaycastSwiftPlugin", package: "extensions-swift-tools"),
        .product(name: "RaycastTypeScriptPlugin", package: "extensions-swift-tools"),
      ]
    ),
    .testTarget(
      name: "ContactsBridgeTests",
      dependencies: ["ContactsBridge"]
    )
  ]
)
