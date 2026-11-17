import SwiftUI

#if os(macOS)
import AppKit

typealias NutriPlatformImage = NSImage

let nutriDidBecomeActiveNotification = NSApplication.didBecomeActiveNotification
#elseif os(iOS)
import UIKit

typealias NutriPlatformImage = UIImage

let nutriDidBecomeActiveNotification = UIApplication.didBecomeActiveNotification
#endif

extension Image {
    init(nutriImage: NutriPlatformImage) {
        #if os(macOS)
        self.init(nsImage: nutriImage)
        #else
        self.init(uiImage: nutriImage)
        #endif
    }
}

extension View {
    func nutriOnExitCommand(perform action: @escaping () -> Void) -> some View {
        #if os(macOS)
        onExitCommand(perform: action)
        #else
        onKeyPress(.escape) {
            action()
            return .handled
        }
        #endif
    }
}

func nutriTouchSize(_ size: CGFloat) -> CGFloat {
    #if os(iOS)
    max(size, 44)
    #else
    size
    #endif
}
