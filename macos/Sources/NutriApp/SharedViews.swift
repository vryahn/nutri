#if os(macOS)
import AppKit
#else
import UIKit
#endif
import ImageIO
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

func decimal(_ value: String) -> Double? {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
    guard let number = Double(text), number.isFinite else { return nil }
    return number
}

func formText(_ value: Double?) -> String { value.map { String($0) } ?? "" }

func jpegData(_ url: URL, maxSide: Int = 1280, quality: Double = 0.85) throws -> Data {
    let granted = url.startAccessingSecurityScopedResource()
    defer { if granted { url.stopAccessingSecurityScopedResource() } }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw NutriError("No se pudo abrir la imagen.") }
    return try jpegData(source, maxSide: maxSide, quality: quality)
}

#if os(iOS)
func jpegData(_ data: Data, maxSide: Int, quality: Double = 0.85) throws -> Data {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw NutriError("No se pudo abrir la imagen.") }
    return try jpegData(source, maxSide: maxSide, quality: quality)
}
#endif

private func jpegData(_ source: CGImageSource, maxSide: Int, quality: Double) throws -> Data {
    let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxSide,
        kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options),
          let result = jpegData(image, quality: quality) else {
        throw NutriError("No se pudo convertir la imagen.")
    }
    return result
}

func jpegData(_ image: CGImage, quality: Double) -> Data? {
    #if os(macOS)
    NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: quality])
    #else
    UIImage(cgImage: image).jpegData(compressionQuality: quality)
    #endif
}

#if os(macOS)
@MainActor
func openFiles(_ types: [UTType], multiple: Bool = false) -> [URL] {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = types
    panel.allowsMultipleSelection = multiple
    return panel.runModal() == .OK ? panel.urls : []
}
#endif

extension View {
    func nutriFilePicker(isPresented: Binding<Bool>, types: [UTType], multiple: Bool = false,
                         onPick: @escaping (Result<[URL], Error>) -> Void) -> some View {
        fileImporter(isPresented: isPresented, allowedContentTypes: types,
                     allowsMultipleSelection: multiple, onCompletion: onPick)
    }
}

struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.nutriDisplay(16))
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .nutriCard()
    }
}

struct ColumnHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    init(_ title: String, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.trailing = trailing()
    }

    var body: some View {
        HStack {
            Text(title).font(.nutriDisplay(24))
            Spacer()
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}

struct EditorTitle: View {
    let title: String
    let close: () -> Void

    var body: some View {
        HStack {
            Text(title).font(.nutriDisplay(19))
            Spacer()
            Button(action: close) { NutriIcon("x", size: 16).frame(width: nutriTouchSize(36), height: nutriTouchSize(36))
                .contentShape(Rectangle()) }
                .buttonStyle(.borderless).keyboardShortcut(.cancelAction).accessibilityLabel("Cerrar")
        }
    }
}

struct NutriSheet<Content: View, Footer: View>: View {
    @EnvironmentObject private var store: Store
    @Environment(\.nutriPalette) private var palette
    let title: String
    let close: () -> Void
    let content: Content
    let footer: Footer
    let showsFooter: Bool

    init(_ title: String, close: @escaping () -> Void, showsFooter: Bool = true, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.close = close
        self.content = content()
        self.footer = footer()
        self.showsFooter = showsFooter
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(title).font(.nutriDisplay(19))
                Spacer()
                Button(action: close) {
                    NutriIcon("x", size: 16).frame(width: nutriTouchSize(36))
                }
                .buttonStyle(NutriButtonStyle(.quiet, height: 36, horizontal: 0))
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel(store.tr("Cerrar"))
                .accessibilityIdentifier("sheet.close")
            }
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
            Rectangle().fill(palette.border).frame(height: 1)
            ViewThatFits(in: .vertical) {
                content.padding(.horizontal, 20).padding(.vertical, 16).fixedSize(horizontal: false, vertical: true)
                ScrollView { content.padding(.horizontal, 20).padding(.vertical, 16) }
                    .scrollDismissesKeyboard(.interactively)
            }
            if showsFooter {
                Rectangle().fill(palette.border).frame(height: 1)
                footer.padding(.horizontal, 20).padding(.vertical, 12)
            }
        }
        .nutriGlass(modal: true)
    }
}

struct NutriModal<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let close: () -> Void
    var maxWidth: CGFloat = 448
    var scrimOpacity: Double = 0.4
    var fullscreen = false
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 640
            ZStack(alignment: compact ? .bottom : .center) {
                Color.black.opacity(scrimOpacity)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                content
                    .frame(width: fullscreen ? geometry.size.width : min(geometry.size.width, maxWidth),
                           height: fullscreen ? geometry.size.height : nil)
                    .frame(maxHeight: fullscreen ? geometry.size.height : geometry.size.height * 0.88)
                    .transition(reduceMotion ? .identity : .opacity.combined(with: .offset(y: 16)))
                    .accessibilityAddTraits(.isModal)
            }
        }
    }
}

/// Wraps chips and controls at the proposed width, like a flex-wrap row.
struct NutriFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    private func positions(_ width: CGFloat, _ subviews: Subviews) -> ([CGRect], CGSize) {
        var result: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        for view in subviews {
            let natural = view.sizeThatFits(.unspecified)
            let size = natural.width > width ? view.sizeThatFits(.init(width: width, height: nil)) : natural
            if x > 0 && x + size.width > width {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            result.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            usedWidth = max(usedWidth, x + size.width)
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return (result, CGSize(width: usedWidth, height: y + lineHeight))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        positions(proposal.width ?? .infinity, subviews).1
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (frames, _) = positions(bounds.width, subviews)
        for (view, frame) in zip(subviews, frames) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}

struct NutriPresentedModal {
    let id: String
    let close: () -> Void
    let maxWidth: CGFloat
    let scrimOpacity: Double
    let fullscreen: Bool
    let content: AnyView

    init<Content: View>(_ id: String, close: @escaping () -> Void, maxWidth: CGFloat = 448,
                        scrimOpacity: Double = 0.4, fullscreen: Bool = false, @ViewBuilder content: () -> Content) {
        self.id = id
        self.close = close
        self.maxWidth = maxWidth
        self.scrimOpacity = scrimOpacity
        self.fullscreen = fullscreen
        self.content = AnyView(content())
    }
}

struct NutriPresentedModalKey: PreferenceKey {
    static let defaultValue: NutriPresentedModal? = nil

    static func reduce(value: inout NutriPresentedModal?, nextValue: () -> NutriPresentedModal?) {
        value = nextValue() ?? value
    }
}

struct NutriModalVisibleKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension View {
    @ViewBuilder
    func nutriHint(_ text: String?) -> some View {
        #if os(iOS)
        if let text, !text.isEmpty {
            modifier(NutriTouchHint(text: text))
        } else {
            self
        }
        #else
        help(text ?? "").accessibilityHint(text ?? "")
        #endif
    }
}

#if os(iOS)
private struct NutriTouchHint: ViewModifier {
    let text: String
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .accessibilityHint(text)
            .overlay {
                // A disabled control can still explain why it is unavailable.
                Color.clear.contentShape(Rectangle())
                    .onTapGesture { shown.toggle() }
                    .accessibilityHidden(true)
                    .popover(isPresented: $shown) {
                        Text(text).font(.nutriSans(13)).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: 260, alignment: .leading).padding(12)
                            .presentationCompactAdaptation(.popover)
                    }
            }
    }
}
#endif

/// Icon that exists only to show a hint: click/tap (or VoiceOver press) toggles a popover, hover shows the tooltip.
struct NutriHintButton<Label: View>: View {
    let text: String
    @ViewBuilder let label: () -> Label
    @State private var shown = false

    var body: some View {
        Button { shown.toggle() } label: {
            #if os(iOS)
            label().frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            #else
            label()
            #endif
        }
            .buttonStyle(.plain)
            .help(text)
            .accessibilityLabel(text)
            .popover(isPresented: $shown) {
                Text(text).font(.nutriSans(13)).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 260, alignment: .leading).padding(12)
                    .presentationCompactAdaptation(.popover)
            }
    }
}
