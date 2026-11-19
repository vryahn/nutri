# Mantenimiento de Nutri para macOS y iPhone

[Manual de Nutri](README.md)

Para instalar o renovar la beta, sigue la guía de tu plataforma. Esta página reúne las rutas de código, las pruebas y el diagnóstico comunes. [Instalación en macOS](../macos/README.md) · [Instalación en iPhone](../ios/README.md)

## Dónde hacer el cambio

| Capa | Punto de entrada |
| --- | --- |
| macOS 14+ | SwiftPM 5.10 o posterior. `Nutri` compila la app y `NutriChecks` ejecuta las pruebas de núcleo. `build-app.sh` crea el bundle `Nutri.app`. [Package.swift](../macos/Package.swift) · [Empaquetado](../macos/scripts/build-app.sh) |
| iOS 17+ | El esquema compartido `Nutri` de Xcode contiene el target de app `Nutri` y las pruebas `NutriUITests`. La app compila los archivos de `macos/Sources/NutriApp` referenciados por el proyecto y enlaza `NutriCore` mediante el paquete local `../macos`. Al agregar un archivo de UI, comprueba que pertenece también al target del iPhone. [Proyecto Xcode](../ios/Nutri.xcodeproj/project.pbxproj) · [Esquema](../ios/Nutri.xcodeproj/xcshareddata/xcschemes/Nutri.xcscheme) |
| SwiftUI compartido | `NutriApp.swift` arranca `Store` y presenta Hoy, Alimentos, Recetas, Objetivos, Dashboard y Medidas, además de Ajustes. `DesignSystem.swift` concentra la paleta, tipografía e iconos. [Vistas](../macos/Sources/NutriApp) |
| Adaptadores | `Platform.swift` resuelve imágenes AppKit/UIKit, tamaños táctiles y teclados. `SharedViews.swift` y `FeatureHelpers.swift` adaptan importación, exportación y selección de fotos. `Camera.swift` pide permiso y captura en iOS. [Plataforma](../macos/Sources/NutriApp/Platform.swift) · [Vistas compartidas](../macos/Sources/NutriApp/SharedViews.swift) · [Archivos y fotos](../macos/Sources/NutriApp/FeatureHelpers.swift) · [Cámara](../macos/Sources/NutriApp/Camera.swift) |
| `NutriCore` | `Domain.swift` y `Rules.swift` calculan nutrición y reglas de fase. `CSV.swift` y `JSONValue.swift` decodifican entradas. `Supabase.swift` implementa sesión, REST/RPC del esquema `nutri`, Storage y el proxy de IA. `Outbox.swift` persiste la caché y las operaciones de bitácora. [Núcleo Swift](../macos/Sources/NutriCore) |

Los tres clientes comparten Supabase y sus políticas de acceso. La nutrición de catálogo se expresa por 100 g y las cantidades persistidas, en gramos. Conserva cero y desconocido como valores distintos, exige densidad explícita para normalizar ml y consulta las vistas SQL para los registros sincronizados. Objetivos refleja el plan maestro aprobado de Anthropometry y las reglas de fase generan propuestas para revisión. [Reglas del repositorio](../AGENTS.md) · [Dominio Swift](../macos/Sources/NutriCore/Domain.swift) · [Matriz de paridad](../macos/PARITY.md)

## Contratos y oráculos

- `sync-domain.mjs` genera `Contracts.json` a partir de `domain.js`, `i18n.js` y los prompts de alimentos y recetas de `ai.js`. Los dos clientes leen ese recurso. Regenera el archivo cuando cambie alguna fuente y revisa el diff. [Generador](../macos/scripts/sync-domain.mjs) · [Contrato](../macos/Sources/NutriCore/Resources/Contracts.json) · [Consumo de prompts](../macos/Sources/NutriApp/CatalogAI.swift)
- Los oráculos de `web-domain.json` fijan entradas y salidas de funciones concretas. `check-web-oracles.mjs` compara JavaScript contra esos resultados y `NutriChecks` consume el mismo fixture en Swift. Si cambia un resultado esperado, comprueba primero si se trata de una modificación de dominio aprobada o una diferencia de cálculo ya documentada, como el redondeo SQL. [Fixture](../macos/Tests/NutriChecks/Fixtures/web-domain.json) · [Verificador JS](../macos/scripts/check-web-oracles.mjs) · [Verificador Swift](../macos/Tests/NutriChecks/NutriChecks.swift)
- La huella SHA-256 truncada cubre `Contracts.json`, `api/ai.js` y las migraciones SQL incrementales ordenadas. Vite la publica en `/native-contract.json` y cada bundle la incorpora en `Info.plist`. `Store` comprueba la huella publicada al iniciar con sesión y conexión, y muestra el aviso si recibe otra. iOS calcula la misma huella en Python para que Xcode pueda compilar sin Node. [Cálculo JS](../scripts/native-contract.mjs) · [Vite](../vite.config.js) · [Cálculo iOS](../ios/scripts/write_info.py) · [Store](../macos/Sources/NutriApp/Store.swift)

## Pruebas y builds desde la raíz

Ejecuta los checks locales primero. Usa Node 24 como CI. `sync-domain.mjs` escribe el contrato versionado y se ejecuta cuando corresponda regenerarlo.

```sh
node macos/scripts/check-web-oracles.mjs
test "$(python3 ios/scripts/write_info.py --contract)" = "$(node scripts/native-contract.mjs)"
swift run --package-path macos NutriChecks
swift run --package-path macos Nutri --module-checks
swift build --package-path macos -c release
NUTRI_SNAPSHOT_STATES=1 swift run --package-path macos Nutri --snapshot-checks
```

Para reproducir las pruebas táctiles, usa un iPhone SE de tercera generación si está disponible. Copia su UDID de `simctl` y desactiva el teclado físico del simulador para comprobar el teclado en pantalla. `NUTRI_IOS_UI_TESTING=YES` genera configuración sintética exclusiva de Debug en simulador. [Pruebas XCUITest](../ios/NutriUITests/NutriUITests.swift) · [Configuración de pruebas](../ios/scripts/write_info.py)

```sh
xcrun simctl list devices available
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
xcodebuild -project ios/Nutri.xcodeproj -scheme Nutri -destination 'id=UDID_DEL_SIMULADOR' -parallel-testing-enabled NO NUTRI_IOS_UI_TESTING=YES test
```

Para comprobar que Release compila para iPhone con la configuración pública del `.env` local, ejecuta lo siguiente. Para instalar, sigue el flujo de firma personal de la guía iOS.

```sh
xcodebuild -project ios/Nutri.xcodeproj -scheme Nutri -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

| Prueba | Datos y comprobación |
| --- | --- |
| `NutriChecks` y `--module-checks` | Dominio, transporte sintético y lógica de módulos. `swift run --package-path macos NutriChecks --keychain` agrega el ciclo de una sesión sintética en Keychain. [Pruebas del núcleo](../macos/Tests/NutriChecks/NutriChecks.swift) · [Pruebas de módulos](../macos/Sources/NutriApp/ModuleChecks.swift) |
| Renders macOS y XCUITest iOS | `DemoData.swift` provee datos sintéticos locales. Los renders de macOS cubren seis módulos, temas claro y oscuro y 390/768/1280 puntos por defecto. `NUTRI_SNAPSHOT_DIR` cambia la salida y `NUTRI_SNAPSHOT_FIXTURE` acepta un JSON sintético creado con `python3 macos/scripts/capture-demo-fixture.py .env RUTA_JSON`. Ese script abre una demo anónima en Supabase y ejecuta `seed_demo`. XCUITest activa la demo local con `--ios-ui-demo` y sí ejecuta gestos y pulsaciones. [Datos locales](../macos/Sources/NutriApp/DemoData.swift) · [Renders](../macos/Sources/NutriApp/SnapshotChecks.swift) · [Captura de fixture](../macos/scripts/capture-demo-fixture.py) |
| Integración Supabase | `python3 macos/scripts/check-live.py .env` comprueba inicio de sesión, lecturas, renovación, aislamiento y cierre con una cuenta de prueba designada. `--write-fixtures` escribe registros identificables y comprueba su limpieza, incluida una imagen privada. Mantén los archivos de configuración fuera del repositorio y usa datos sintéticos en evidencias compartidas. [Runner](../macos/scripts/check-live.py) · [Pruebas de escritura](../macos/Tests/NutriChecks/LiveWriteChecks.swift) |

CI de macOS comprueba el contrato generado, oráculos, núcleo, módulos y compilación Release. CI de iOS compara ambas huellas, corre XCUITest en iPhone SE simulado de 375 puntos, exporta sus adjuntos sintéticos y compila Release para `generic/platform=iOS` con firma desactivada. La instalación firmada, el permiso y la captura de cámara, la fototeca y la red móvil requieren verificación en iPhone físico. En Mac, usa la app abierta para comprobar teclado, ratón y arrastre. [Workflow macOS](../.github/workflows/macos.yml) · [Workflow iOS](../.github/workflows/ios.yml)

### Regresión táctil de iOS 1.0.0, compilación 3

- **Hoy.** Inicia el scroll hacia arriba y hacia abajo sobre el cuerpo de un registro y comprueba que la pantalla se desplace. Mantén pulsado el registro, suéltalo sobre el encabezado de otra comida y comprueba que aparezca en esa sección. Un toque abre el editor, un deslizamiento corto devuelve la tarjeta a su sitio y uno completo hacia la izquierda borra con opción de **Deshacer**. Toca el resumen fijo para volver a la tarjeta completa.
- **Alimentos y Recetas.** Comprueba que tocar una tarjeta abra el editor, que el catálogo compartido respete el propietario y que la revisión CSV siga accesible con el teclado abierto. En Recetas, verifica búsqueda de ingredientes mientras escribes, pegado, guardado y reapertura.
- **Objetivos, Dashboard y Medidas.** Desliza una fase para abrir confirmación y una fecha específica para probar **Deshacer**. Selecciona y quita la pausa de una regla en el calendario. En Dashboard toca un eje de la huella y verifica que se pueda deshacer el borrado de un rango guardado. En Medidas comprueba autoguardado al cambiar de día y las dos modalidades de importación, complementar o reemplazar.
- **Teclado.** `.decimalPad` para cantidades, medidas y porcentajes. `.numberPad` para días. `.numbersAndPunctuation` para deltas de carbohidratos que admiten signo. Prueba **Listo** (`keyboard.done`) con el teclado visible y comprueba que conserva el valor editado. En Mac comprueba ⌘1–⌘6, ⌘, y ⌘N en Hoy.

[Guía táctil](../ios/README.md#gestos-y-acciones-de-la-compilación-3) · [Casos XCUITest](../ios/NutriUITests/NutriUITests.swift) · [Adaptador de teclado](../macos/Sources/NutriApp/Platform.swift)

## Firma, datos locales y diagnóstico

**Configuración y firma.** Ambos empaquetados leen la URL de Supabase y la llave `sb_publishable_` del `.env` local o de `NUTRI_ENV_FILE`. En Mac, `macos/scripts/build-app.sh release` crea `macos/.build/app-release/Nutri.app` y `macos/scripts/install-app.sh` valida firma e identificador antes de reemplazar la instalación. La firma ad hoc puede volver a pedir acceso al llavero al recompilar. `NUTRI_SIGN_IDENTITY` permite usar una identidad estable. En iPhone, abre `ios/Nutri.xcodeproj` y ejecuta con firma automática y Personal Team sobre el dispositivo. Usa el mismo equipo e identificador al renovar la instalación para conservar la cola local. [Firma macOS](../macos/README.md#compilar-probar-e-instalar) · [Firma iPhone](../ios/README.md#instalar-en-tu-iphone)

**Caché y cola.** El llavero guarda la sesión con un servicio que incorpora el identificador del bundle y el host. `Application Support/NutriNative/<uid>/` contiene `cache/` y `entries-outbox.json` dentro del espacio de la app. `Store.read` puede usar caché ante una desconexión, un error de transporte o un 5xx. Cerrar sesión limpia la caché de la cuenta y conserva su cola de registros. Los cambios de `entries` son optimistas y se reproducen por UUID cuando vuelve la red o la app pasa a primer plano. Un fallo transitorio reintenta con espera exponencial. Un fallo de escritura permanente descarta la operación y avisa. [Sesión](../macos/Sources/NutriCore/Supabase.swift) · [Persistencia y reintentos](../macos/Sources/NutriCore/Outbox.swift) · [Store](../macos/Sources/NutriApp/Store.swift)

| Síntoma | Dónde mirar |
| --- | --- |
| Alimentos no refleja un cambio de otro cliente | Confirma que el cambio se guardó y que la cuenta tiene acceso. Con Alimentos visible y la app activa, prueba volver a primer plano, reconectar y esperar el refresco silencioso de 30 s. `FoodsView` consulta `Store.catalog(allowCached: false)` en refrescos silenciosos. El `flush()` de `Store` drena la cola de entradas. [Alimentos](../macos/Sources/NutriApp/FoodsView.swift) · [Store](../macos/Sources/NutriApp/Store.swift) |
| Registros pendientes o duplicados | Revisa el indicador de sincronización y el UUID. El reintento de una inserción duplicada consulta `entries` en el servidor con la sesión del propietario antes de darla por confirmada. Conserva la cola mientras investigas y verifica que el UUID final aparezca una sola vez. [Store](../macos/Sources/NutriApp/Store.swift) |
| Login falla después de compilar | Comprueba el `Info.plist` de la app real, la configuración pública y la firma. `swift run` sirve para checks locales y el bundle añade la configuración de sesión. Si persiste un error de Keychain, revisa el servicio sin exponer el contenido del ítem. [Empaquetado macOS](../macos/scripts/build-app.sh) · [Configuración iOS](../ios/scripts/write_info.py) · [Llavero](../macos/Sources/NutriCore/Supabase.swift) |
| Aviso de versión desactualizada | Compara la huella del bundle con `/native-contract.json` de la web desplegada. Revisa los cambios de contrato, proxy y migraciones entre ambas compilaciones antes de generar o instalar otra. [Huella](../scripts/native-contract.mjs) · [Comprobación en arranque](../macos/Sources/NutriApp/Store.swift) |
| Cámara o teclado ausente | Para cámara, comprueba permiso y disponibilidad en dispositivo físico. Para teclado, reproduce con el teclado en pantalla del simulador y vuelve a probar en hardware si el fallo es exclusivo del dispositivo. [Cámara](../macos/Sources/NutriApp/Camera.swift) · [Teclado](../macos/Sources/NutriApp/Platform.swift) |
