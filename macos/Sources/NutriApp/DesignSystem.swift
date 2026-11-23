#if os(macOS)
import AppKit
#else
import UIKit
#endif
import CoreText
import SwiftUI

private var designResources: Bundle {
    #if os(macOS)
    Bundle.main.resourceURL.flatMap { Bundle(url: $0.appendingPathComponent("Nutri_Nutri.bundle")) } ?? .module
    #else
    .main
    #endif
}

/// The two Petróleo palettes in src/index.css, in sRGB.
struct NutriPalette {
    let bg = color(0x071010, 0xF3F9F9)
    let surface = color(0x101A1A, 0xFCFFFF)
    let surface2 = color(0x182525, 0xEBF3F3)
    let surface3 = color(0x243232, 0xDAE6E5)
    let border = color(0x2D3939, 0xCDD9D9)
    let text = color(0xE9F7F6, 0x0A1C1C)
    let text2 = color(0x9CB2B1, 0x415454)
    let text3 = color(0x7A8F8E, 0x5C7070)
    let accent = color(0x069C92, 0x047972)
    let accentDeep = color(0x028078, 0x058179)
    let accentGlass = color(0x3CB8AE, 0x076F69)
    let dockAccent = color(0x076A64, 0x076F69)
    let onAccent = color(0xF7FBFB, 0xF8FDFD)
    let ok = color(0x4F9B53, 0x2E7C35)
    let near = color(0xC5B640, 0x766000)
    let warn = color(0xB97F2C, 0x966104)
    let danger = color(0xDE6666, 0xB84548)
    let kcal = color(0xD56F46, 0xB24F25)
    let protein = color(0x4F9B53, 0x2E7C35)
    let carbs = color(0x6389E2, 0x4669BF)
    let fat = color(0xAA8621, 0x876804)

    func nutrient(_ key: String, fallback: Color? = nil) -> Color {
        switch key {
        case "kcal": kcal
        case "protein_g": protein
        case "carbs_g", "agua_ml": carbs
        case "fat_g": fat
        default: fallback ?? accent
        }
    }

    func goalGradient(scheme: ColorScheme, fromNear: Bool, fraction: Double) -> Color {
        let stops = scheme == .dark ? [0x4F9B53, 0xC5B640, 0xB97F2C] : [0x2E7C35, 0x766000, 0x966104]
        let index = fromNear ? 1 : 0
        func channel(_ shift: Int) -> Double {
            let from = Double(stops[index] >> shift & 255)
            let to = Double(stops[index + 1] >> shift & 255)
            return (from + (to - from) * fraction) / 255
        }
        return Color(.sRGB, red: channel(16), green: channel(8), blue: channel(0), opacity: 1)
    }

    private static func color(_ dark: Int, _ light: Int) -> Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255,
                           green: CGFloat(hex >> 8 & 255) / 255,
                           blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
        #else
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat(hex >> 16 & 255) / 255,
                           green: CGFloat(hex >> 8 & 255) / 255,
                           blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
        #endif
    }
}

private struct NutriPaletteKey: EnvironmentKey {
    static let defaultValue = NutriPalette()
}

extension EnvironmentValues {
    var nutriPalette: NutriPalette {
        get { self[NutriPaletteKey.self] }
        set { self[NutriPaletteKey.self] = newValue }
    }
}

let nutriAccent = NutriPalette().accent

enum NutriFontWeight: Int {
    case regular = 400
    case medium = 500
    case semibold = 600
    case bold = 700
}

private enum NutriTypography {
    // These are the exact variable families requested by index.html.
    private static let families = [
        "Inter": "Inter-Regular",
        "SpaceGrotesk": "SpaceGrotesk-Light",
        "JetBrainsMono": "JetBrainsMono-Regular"
    ]

    static let registered: Bool = {
        var complete = true
        for (family, _) in families {
            guard let url = designResources.url(forResource: family, withExtension: "ttf", subdirectory: "Fonts") else {
                complete = false
                continue
            }
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) { complete = false }
        }
        return complete
    }()

    static func font(_ family: String, size base: CGFloat, weight: NutriFontWeight) -> Font {
        _ = registered
        let size = scaled(base)
        guard let name = families[family] else { return .system(size: size) }
        let base = CTFontCreateWithName(name as CFString, size, nil)
        // FourCC for the OpenType wght variation axis.
        let descriptor = CTFontDescriptorCreateCopyWithVariation(CTFontCopyFontDescriptor(base),
                                                                  NSNumber(value: 0x77676874), CGFloat(weight.rawValue))
        let varied = CTFontCreateWithFontDescriptor(descriptor, size, nil)
        return Font(varied)
    }

    // ponytail: el CTFont fijo ignoraba Dynamic Type en iPhone. Se escala al construir la fuente, con tope 1.6×
    // para no romper la densidad de datos; un cambio de tamaño en vivo llega a cada vista en su siguiente redibujo.
    private static func scaled(_ size: CGFloat) -> CGFloat {
        #if os(iOS)
        min(UIFontMetrics.default.scaledValue(for: size), size * 1.6)
        #else
        size
        #endif
    }
}

extension Font {
    static func nutriSans(_ size: CGFloat, weight: NutriFontWeight = .regular) -> Font {
        NutriTypography.font("Inter", size: size, weight: weight)
    }

    static func nutriDisplay(_ size: CGFloat, weight: NutriFontWeight = .medium) -> Font {
        NutriTypography.font("SpaceGrotesk", size: size, weight: weight)
    }

    static func nutriMono(_ size: CGFloat, weight: NutriFontWeight = .medium) -> Font {
        NutriTypography.font("JetBrainsMono", size: size, weight: weight).monospacedDigit()
    }
}

struct NutriIcon: View {
    let name: String
    let size: CGFloat

    init(_ name: String, size: CGFloat = 20) {
        self.name = name
        self.size = size
    }

    static let assets: [String: NutriPlatformImage] = {
        guard let base = designResources.resourceURL?.appendingPathComponent("Icons"),
              let files = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: nil) else { return [:] }
        return Dictionary(uniqueKeysWithValues: files.compactMap { url in
            guard url.pathExtension == "pdf", let image = loadPDF(url) else { return nil }
            return (url.deletingPathExtension().lastPathComponent, image)
        })
    }()

    private static func loadPDF(_ url: URL) -> NutriPlatformImage? {
        #if os(macOS)
        NSImage(contentsOf: url)
        #else
        guard let page = CGPDFDocument(url as CFURL)?.page(at: 1) else { return nil }
        let bounds = page.getBoxRect(.mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let pixels: CGFloat = url.lastPathComponent.hasPrefix("nutri-") ? 240 : 96
        let format = UIGraphicsImageRendererFormat()
        format.scale = pixels / max(bounds.width, bounds.height)
        return UIGraphicsImageRenderer(size: bounds.size, format: format).image { renderer in
            let context = renderer.cgContext
            context.translateBy(x: -bounds.minX, y: bounds.maxY)
            context.scaleBy(x: 1, y: -1)
            context.drawPDFPage(page)
        }
        #endif
    }

    var body: some View {
        Group {
            if let image = Self.assets[name] {
                Image(nutriImage: image).renderingMode(.template).resizable().scaledToFit()
            } else {
                Image(systemName: name).resizable().scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct NutriButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, quiet, danger }
    var kind: Kind
    var height: CGFloat
    var horizontal: CGFloat
    var radius: CGFloat

    init(_ kind: Kind = .secondary, height: CGFloat = 44, horizontal: CGFloat = 12, radius: CGFloat = 12) {
        self.kind = kind
        self.height = height
        self.horizontal = horizontal
        self.radius = radius
    }

    func makeBody(configuration: Configuration) -> some View {
        NutriButtonContent(configuration: configuration, style: self)
    }

    private struct NutriButtonContent: View {
        @Environment(\.nutriPalette) private var palette
        @Environment(\.isEnabled) private var isEnabled
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var hovering = false
        let configuration: Configuration
        let style: NutriButtonStyle

        var body: some View {
            configuration.label
                .font(.nutriSans(14, weight: style.kind == .primary ? .medium : .regular))
                .foregroundStyle(foreground)
                .padding(.horizontal, style.horizontal)
                .frame(minHeight: nutriTouchSize(style.height))
                .background(background, in: RoundedRectangle(cornerRadius: style.radius, style: .circular))
                .overlay {
                    if style.kind == .secondary {
                        RoundedRectangle(cornerRadius: style.radius, style: .circular).strokeBorder(palette.border)
                    }
                }
                .contentShape(Rectangle())
                .opacity(isEnabled ? 1 : 0.6)
                .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
                .onHover { hovering = $0 }
        }

        private var foreground: Color {
            switch style.kind {
            case .primary: palette.onAccent
            case .secondary, .quiet: palette.text2
            case .danger: palette.danger
            }
        }

        private var background: Color {
            switch style.kind {
            case .primary: palette.accentDeep
            case .secondary: hovering ? palette.surface3 : palette.surface2
            case .quiet, .danger: hovering ? palette.surface2 : .clear
            }
        }
    }
}

extension View {
    func nutriCard(radius: CGFloat = 16, fill: Color? = nil) -> some View {
        modifier(NutriCard(radius: radius, fill: fill))
    }

    func nutriInput(height: CGFloat = 44, focus: FocusState<Bool>.Binding? = nil) -> some View {
        modifier(NutriInput(height: height, focus: focus))
    }

    func nutriGlass(radius: CGFloat = 16, modal: Bool = false) -> some View {
        modifier(NutriGlass(radius: radius, modal: modal))
    }
}

private struct NutriCard: ViewModifier {
    @Environment(\.nutriPalette) private var palette
    let radius: CGFloat
    let fill: Color?

    func body(content: Content) -> some View {
        content
            .background(fill ?? palette.surface, in: RoundedRectangle(cornerRadius: radius, style: .circular))
            .overlay { RoundedRectangle(cornerRadius: radius, style: .circular).strokeBorder(palette.border).allowsHitTesting(false) }
    }
}

private struct NutriInput: ViewModifier {
    @Environment(\.nutriPalette) private var palette
    @FocusState private var internalFocus: Bool
    let height: CGFloat
    let focus: FocusState<Bool>.Binding?

    func body(content: Content) -> some View {
        let binding = focus ?? $internalFocus
        let focused = binding.wrappedValue
        return content
            .textFieldStyle(.plain)
            .focused(binding)
            .foregroundStyle(palette.text)
            .padding(.horizontal, 12)
            .frame(minHeight: nutriTouchSize(height))
            .background(palette.surface2, in: RoundedRectangle(cornerRadius: 12, style: .circular))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .circular)
                    .strokeBorder(focused ? palette.accent : palette.border, lineWidth: focused ? 2 : 1)
                    .allowsHitTesting(false)
            }
    }
}

private struct NutriGlass: ViewModifier {
    @Environment(\.nutriPalette) private var palette
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let radius: CGFloat
    let modal: Bool

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .circular)
        content
            .background {
                if reduceTransparency {
                    shape.fill(palette.surface)
                } else {
                    shape.fill(modal ? Material.regular : Material.ultraThin)
                    let alpha = colorScheme == .light ? (modal ? 0.90 : 0.82) : (modal ? 0.85 : 0.72)
                    shape.fill(palette.surface.opacity(alpha))
                }
            }
            .overlay { shape.strokeBorder(palette.border).allowsHitTesting(false) }
    }
}

struct NutriSectionAction: Identifiable {
    let id: String
    let label: String
    let icon: String
    let action: () -> Void
    var enabled: Bool

    init(_ id: String, label: String, icon: String, enabled: Bool = true, action: @escaping () -> Void) {
        self.id = id
        self.label = label
        self.icon = icon
        self.enabled = enabled
        self.action = action
    }
}

private struct NutriSectionActionsKey: EnvironmentKey {
    static let defaultValue: (([NutriSectionAction]) -> Void)? = nil
}

private struct NutriWindowWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat = 1280
}

private struct NutriAccountOverlayKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var nutriSectionActionsHandler: (([NutriSectionAction]) -> Void)? {
        get { self[NutriSectionActionsKey.self] }
        set { self[NutriSectionActionsKey.self] = newValue }
    }

    var nutriWindowWidth: CGFloat {
        get { self[NutriWindowWidthKey.self] }
        set { self[NutriWindowWidthKey.self] = newValue }
    }

    var nutriHasAccountOverlay: Bool {
        get { self[NutriAccountOverlayKey.self] }
        set { self[NutriAccountOverlayKey.self] = newValue }
    }
}

private struct NutriSectionActions: ViewModifier {
    @Environment(\.nutriSectionActionsHandler) private var handler
    let actions: [NutriSectionAction]

    func body(content: Content) -> some View {
        content
            .onAppear { handler?(actions) }
            .onChange(of: actions.map { "\($0.id)\($0.label)\($0.enabled)" }) { _, _ in handler?(actions) }
    }
}

extension View {
    func nutriSectionActions(_ actions: [NutriSectionAction]) -> some View {
        modifier(NutriSectionActions(actions: actions))
    }
}

struct NutriSelectGroup {
    var label: String? = nil
    let options: [(key: String, title: String)]
}

/// A full-size Nutri select trigger with a native outside-click dismissible popover.
struct NutriSelect: View {
    @Environment(\.nutriPalette) private var palette
    @State private var opened = false
    @State private var width: CGFloat = 140
    let value: String
    let select: (String) -> Void
    let groups: [NutriSelectGroup]
    let height: CGFloat
    let currentLabel: String?

    init(value: String, select: @escaping (String) -> Void, options: [(String, String)], height: CGFloat = 44, currentLabel: String? = nil) {
        self.init(value: value, select: select, groups: [NutriSelectGroup(options: options)], height: height, currentLabel: currentLabel)
    }

    init(value: String, select: @escaping (String) -> Void, groups: [NutriSelectGroup], height: CGFloat = 44, currentLabel: String? = nil) {
        self.value = value
        self.select = select
        self.groups = groups
        self.height = height
        self.currentLabel = currentLabel
    }

    var body: some View {
        let selection = groups.lazy.flatMap(\.options).first { $0.key == value }?.title ?? currentLabel ?? value
        Button { opened.toggle() } label: {
            HStack(spacing: 8) {
                Text(selection).lineLimit(1)
                Spacer(minLength: 0)
                NutriIcon("chevron-down", size: 14)
            }.padding(.horizontal, 12).frame(height: nutriTouchSize(height))
                .font(.nutriSans(height == 44 ? 16 : 14)).foregroundStyle(palette.text)
                .contentShape(Rectangle()).nutriCard(radius: height == 44 ? 12 : 8, fill: palette.surface2)
        }.buttonStyle(.plain)
            .onGeometryChange(for: CGFloat.self, of: { $0.size.width }) { width = $0 }
            .popover(isPresented: $opened, arrowEdge: .bottom) { choices }
    }

    private var choices: some View {
        let rowHeight = Int(nutriTouchSize(36)) + 2
        return ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(groups.indices, id: \.self) { index in
                    let group = groups[index]
                    if let name = group.label {
                        Text(name).font(.nutriSans(12)).foregroundStyle(palette.text3)
                            .padding(.horizontal, 8).padding(.top, index == 0 ? 4 : 8)
                    }
                    ForEach(group.options.indices, id: \.self) { option in
                        let choice = group.options[option]
                        Button {
                            select(choice.key)
                            opened = false
                        } label: {
                            HStack(spacing: 8) {
                                Text(choice.title).frame(maxWidth: .infinity, alignment: .leading)
                                if choice.key == value { NutriIcon("check", size: 14).foregroundStyle(palette.accent) }
                            }.padding(.horizontal, 8).frame(minHeight: nutriTouchSize(36)).contentShape(Rectangle())
                                .background(choice.key == value ? palette.surface3 : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                        }.buttonStyle(.plain).accessibilityAddTraits(choice.key == value ? .isSelected : [])
                    }
                }
            }.padding(6)
        }.font(.nutriSans(14)).foregroundStyle(palette.text).background(palette.surface2)
            .frame(width: max(width, 168), height: min(360, CGFloat(groups.reduce(12) { $0 + $1.options.count * rowHeight + ($1.label == nil ? 0 : 23) })))
            .nutriOnExitCommand { opened = false }
    }
}
