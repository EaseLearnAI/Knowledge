import AppKit

let size = NSSize(width: 1024, height: 1024)
guard let context = CGContext(
    data: nil,
    width: 1024,
    height: 1024,
    bitsPerComponent: 8,
    bytesPerRow: 1024 * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    fatalError("Unable to create drawing context")
}
let graphicsContext = NSGraphicsContext(cgContext: context, flipped: false)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = graphicsContext
context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)

NSColor(calibratedRed: 0.965, green: 0.949, blue: 0.910, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

NSColor(calibratedWhite: 0.055, alpha: 1).setFill()
NSBezierPath(
    roundedRect: NSRect(x: 152, y: 152, width: 720, height: 720),
    xRadius: 210,
    yRadius: 210
).fill()

let bookmark = NSBezierPath()
bookmark.move(to: NSPoint(x: 364, y: 718))
bookmark.curve(
    to: NSPoint(x: 416, y: 770),
    controlPoint1: NSPoint(x: 364, y: 747),
    controlPoint2: NSPoint(x: 387, y: 770)
)
bookmark.line(to: NSPoint(x: 608, y: 770))
bookmark.curve(
    to: NSPoint(x: 660, y: 718),
    controlPoint1: NSPoint(x: 637, y: 770),
    controlPoint2: NSPoint(x: 660, y: 747)
)
bookmark.line(to: NSPoint(x: 660, y: 302))
bookmark.line(to: NSPoint(x: 512, y: 400))
bookmark.line(to: NSPoint(x: 364, y: 302))
bookmark.close()
NSColor(calibratedRed: 0.965, green: 0.949, blue: 0.910, alpha: 1).setFill()
bookmark.fill()

NSColor(calibratedRed: 0.753, green: 0.278, blue: 0.184, alpha: 1).setFill()
NSBezierPath(
    ovalIn: NSRect(x: 676, y: 676, width: 112, height: 112)
).fill()

NSGraphicsContext.restoreGraphicsState()

guard let cgImage = context.makeImage(),
      let pngData = NSBitmapImageRep(cgImage: cgImage).representation(
        using: .png,
        properties: [:]
      ) else {
    fatalError("Unable to encode app icon")
}

let destination = CommandLine.arguments.dropFirst().first
    ?? "KnowledgeIOS/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
try pngData.write(to: URL(fileURLWithPath: destination))
