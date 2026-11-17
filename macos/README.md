# Nutri para macOS

Nutri usa SwiftUI, AppKit y Swift Charts. Requiere macOS 14 o posterior. Abre una sesión propia en el mismo Supabase que [Nutri web](https://nutri.vryahn.com). Los seis módulos leen las mismas tablas y vistas, y las operaciones conservan las políticas de acceso vigentes.

## Compilar, probar e instalar

Usa Swift 5.10 o posterior, Command Line Tools de Apple y Python 3. Desde la raíz del repositorio:

```sh
swift run --package-path macos NutriChecks
macos/scripts/build-app.sh release
macos/scripts/install-app.sh
open /Applications/Nutri.app
```

La compilación toma `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del `.env` local. Puedes elegir otro archivo con `NUTRI_ENV_FILE`. La aplicación exige una llave pública `sb_publishable_` y usa el proxy de IA de producción. Las claves de proveedores y las credenciales de cuenta quedan fuera del paquete. `build-app.sh` selecciona el SDK 26 cuando Command Line Tools también tiene ese SDK disponible, ya que el SDK más nuevo puede requerir el plugin de macros de SwiftUI que el entorno no incluye.

La instalación verifica la firma local ad hoc y el identificador `com.vryahn.nutri.native`. El script permite actualizar el paquete con ese identificador en la ruta seleccionada. Una recompilación con firma ad hoc puede hacer que macOS vuelva a pedir acceso al ítem del llavero. Para quitar el cliente, mueve `Nutri.app` a la papelera. Elimina los datos locales mediante `Cerrar sesión`; las operaciones de bitácora pendientes quedan en la cola de su cuenta para reintentar al volver a entrar.

## Uso y verificación

- Navega con ⌘1–⌘6, abre Ajustes con ⌘, y registra un alimento o receta desde Hoy con ⌘N.
- La sesión local usa el llavero de macOS. La caché y la cola de entradas viven en `~/Library/Application Support/NutriNative/`, limitadas por UID. Los indicadores de conexión y sincronización muestran los casos pendientes.
- El cliente usa las vistas SQL para los registros sincronizados. Las previsualizaciones locales conservan la distinción entre cero y valor desconocido. El redondeo decimal de las previsualizaciones sigue SQL en los casos en que el cálculo flotante web redondea distinto.
- Las reglas de fase muestran propuestas para revisar en el plan maestro de Anthropometry. La guía de banda acoplada calcula macros para la energía que el usuario elija.
- La opción «Explorar» abre la misma demostración anónima de la web. El build DEBUG conserva además «Probar con datos locales», sin red ni escrituras. El bundle de desarrollo admite `--module-checks` para las pruebas sintéticas y `--snapshot-checks` para renderizar las seis pantallas en ambos temas y anchos de 390, 768 y 1280 puntos.
- Para una prueba de integración de lectura con una cuenta designada, ejecuta `python3 macos/scripts/check-live.py .env`. Usa exclusivamente `VITE_DEV_EMAIL` y `VITE_DEV_PASSWORD` del archivo privado. La prueba comprueba inicio de sesión, lectura, renovación, aislamiento y cierre de sesión. Con `--write-fixtures` agrega una prueba de escritura en esa cuenta designada. Crea alimentos, entradas, recetas, objetivos y medidas sintéticos con identificadores únicos, prueba una imagen privada y verifica la eliminación de cada registro y archivo de la prueba.

Actualiza los catálogos de claves y traducciones compartidas con `node macos/scripts/sync-domain.mjs` cuando cambien `src/lib/domain.js` o `src/lib/i18n.js`. Las pruebas de dominio y transporte se ejecutan mediante `NutriChecks`, que funciona con el toolchain de Command Line Tools. Agrega `--keychain` después de `NutriChecks` para verificar escritura, renovación y limpieza con una sesión sintética local.

Los prompts de «Datos con IA» ya no se copian a mano: `sync-domain.mjs` los extrae de `src/lib/ai.js` y los guarda en `Contracts.json` (`prompts`), de donde los lee `CatalogAI.swift`. Tras cambiar un prompt, ejecuta `node macos/scripts/sync-domain.mjs` y recompila la app. El build web publica `/native-contract.json` con la huella de `scripts/native-contract.mjs` (contratos, `api/ai.js` y migraciones); `build-app.sh` guarda esa huella en el Info.plist y, si la web desplegada ya tiene otra, la app muestra un aviso de que está desactualizada.

La versión 1.1 reproduce la paleta Petróleo, las tres familias tipográficas, los iconos Lucide, la navegación, los editores y los estados del sitio. Los archivos de fuentes y sus licencias se incluyen en el paquete. La corrección de conversiones con densidad, bases incompatibles y datos faltantes se aplica también a la web.

Para comparar el dominio original con sus fixtures ejecuta `node macos/scripts/check-web-oracles.mjs`. Para obtener capturas de estados abiertos, añade `NUTRI_SNAPSHOT_STATES=1` al comando `--snapshot-checks`. `NUTRI_SNAPSHOT_DIR` elige la carpeta de salida; `NUTRI_SNAPSHOT_FIXTURE` permite cargar un JSON de demo creado por `macos/scripts/capture-demo-fixture.py`. Las capturas prueban composición y estados, no simulan interacción real.

[Plan de entrega](PLAN.md) · [Matriz de paridad y evidencia](PARITY.md)
