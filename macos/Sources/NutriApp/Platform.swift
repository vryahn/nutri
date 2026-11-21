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

enum NutriKeyboard {
    case text, decimal, integer, signedDecimal

    #if os(iOS)
    var type: UIKeyboardType {
        switch self {
        case .text: .default
        case .decimal: .decimalPad
        case .integer: .numberPad
        case .signedDecimal: .numbersAndPunctuation
        }
    }
    #endif
}

extension View {
    func nutriDecimalKeyboard() -> some View {
        nutriKeyboard(.decimal)
    }

    func nutriKeyboard(_ kind: NutriKeyboard) -> some View {
        #if os(iOS)
        keyboardType(kind.type)
        #else
        self
        #endif
    }

    func nutriKeyboardDismissal(_ title: String, isActive: Bool = true) -> some View {
        #if os(iOS)
        modifier(NutriKeyboardDismissal(title: title, isActive: isActive))
        #else
        self
        #endif
    }

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

#if os(iOS)
private struct NutriKeyboardDismissal: ViewModifier {
    @Environment(\.nutriPalette) private var palette
    @State private var keyboardShown = false
    @State private var numericFieldFocused = false
    let title: String
    let isActive: Bool

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if isActive && keyboardShown && numericFieldFocused {
                    Button(title) {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    }
                    .buttonStyle(NutriButtonStyle(.quiet))
                    .accessibilityIdentifier("keyboard.done")
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 12)
                    .background(palette.surface)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidBeginEditingNotification)) { notification in
                guard let field = notification.object as? UITextField else { return }
                numericFieldFocused = [NutriKeyboard.decimal, .integer, .signedDecimal].contains { $0.type == field.keyboardType }
            }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidEndEditingNotification)) { _ in numericFieldFocused = false }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardShown = true }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardShown = false }
    }
}
#endif

@MainActor
var nutriPhoneLayout: Bool {
    #if os(iOS)
    UIDevice.current.userInterfaceIdiom == .phone
    #else
    false
    #endif
}

func nutriTouchSize(_ size: CGFloat) -> CGFloat {
    #if os(iOS)
    max(size, 44)
    #else
    size
    #endif
}
