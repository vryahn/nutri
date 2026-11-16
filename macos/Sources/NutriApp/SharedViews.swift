import AppKit
import ImageIO
import NutriCore
import SwiftUI
import UniformTypeIdentifiers

let nutriAccent = Color(red: 0.008, green: 0.50, blue: 0.47)

func decimal(_ value: String) -> Double? {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: ",", with: ".")
    guard let number = Double(text), number.isFinite else { return nil }
    return number
}

func formText(_ value: Double?) -> String { value.map { String($0) } ?? "" }

func jpegData(_ url: URL, maxSide: Int = 1280) throws -> Data {
    let granted = url.startAccessingSecurityScopedResource()
    defer { if granted { url.stopAccessingSecurityScopedResource() } }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw NutriError("No se pudo abrir la imagen.") }
    let options = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxSide,
        kCGImageSourceShouldCacheImmediately: true
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options),
          let result = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else {
        throw NutriError("No se pudo convertir la imagen.")
    }
    return result
}

@MainActor
func openFiles(_ types: [UTType], multiple: Bool = false) -> [URL] {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = types
    panel.allowsMultipleSelection = multiple
    return panel.runModal() == .OK ? panel.urls : []
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
            Text(title).font(.headline)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.quaternary, lineWidth: 1) }
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
            Text(title).font(.system(size: 29, weight: .semibold))
            Spacer()
            trailing
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
    }
}

struct EditorTitle: View {
    let title: String
    let close: () -> Void

    var body: some View {
        HStack {
            Text(title).font(.title2.weight(.semibold))
            Spacer()
            Button(action: close) { Image(systemName: "xmark.circle.fill").font(.title3) }
                .buttonStyle(.borderless).keyboardShortcut(.cancelAction).accessibilityLabel("Cerrar")
        }
    }
}
