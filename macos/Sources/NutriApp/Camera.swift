#if os(iOS)
import AVFoundation
import NutriCore
import SwiftUI
import UIKit

@MainActor
var nutriCameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

extension View {
    func nutriCamera(isPresented: Binding<Bool>, onPhoto: @escaping (Result<Data, Error>) -> Void) -> some View {
        fullScreenCover(isPresented: isPresented) {
            CameraCapture { result in
                isPresented.wrappedValue = false
                if let result { onPhoto(result) }
            }
            .ignoresSafeArea()
        }
    }
}

private struct CameraCapture: View {
    let finish: (Result<Data, Error>?) -> Void
    @State private var authorized = false

    var body: some View {
        Group {
            if authorized {
                CameraPicker(finish: finish)
            } else {
                ProgressView().task {
                    let access = AVCaptureDevice.authorizationStatus(for: .video)
                    let allowed = access == .notDetermined
                        ? await AVCaptureDevice.requestAccess(for: .video)
                        : access == .authorized
                    guard !Task.isCancelled else { return }
                    if allowed && nutriCameraAvailable {
                        authorized = true
                    } else {
                        finish(.failure(NutriError("No se pudo abrir la cámara. Revisa el permiso de Nutri en Ajustes o elige una foto de la fototeca.")))
                    }
                }
            }
        }
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    let finish: (Result<Data, Error>?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(finish: finish) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let finish: (Result<Data, Error>?) -> Void
        init(finish: @escaping (Result<Data, Error>?) -> Void) { self.finish = finish }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish(nil) }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard let image = info[.originalImage] as? UIImage, image.size.width > 0, image.size.height > 0 else {
                finish(.failure(NutriError("No se pudo abrir la imagen.")))
                return
            }
            // Draw upright into a fresh bitmap, with no location or camera metadata.
            let factor = min(1, 2048 / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * factor, height: image.size.height * factor)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let data = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.9) { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
            finish(.success(data))
        }
    }
}
#endif
