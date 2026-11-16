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
- Para revisar las seis pantallas con datos locales, ejecuta `macos/scripts/build-app.sh debug`, abre `macos/.build/app-debug/Nutri.app` y pulsa `Probar con datos locales`. Los cambios de demostración viven en memoria. El mismo bundle de desarrollo admite `--module-checks` para las pruebas sintéticas de los módulos.
- Para una prueba de integración de lectura con una cuenta designada, ejecuta `python3 macos/scripts/check-live.py .env`. Usa exclusivamente `VITE_DEV_EMAIL` y `VITE_DEV_PASSWORD` del archivo privado. La prueba comprueba inicio de sesión, lectura, renovación, aislamiento y cierre de sesión. Con `--write-fixtures` agrega una prueba de escritura en esa cuenta designada. Crea alimentos, entradas, recetas, objetivos y medidas sintéticos con identificadores únicos, prueba una imagen privada y verifica la eliminación de cada registro y archivo de la prueba.

Actualiza los catálogos de claves y traducciones compartidas con `node macos/scripts/sync-domain.mjs` cuando cambien `src/lib/domain.js` o `src/lib/i18n.js`. Las pruebas de dominio y transporte se ejecutan mediante `NutriChecks`, que funciona con el toolchain de Command Line Tools. Agrega `--keychain` después de `NutriChecks` para verificar escritura, renovación y limpieza con una sesión sintética local.

[Plan de entrega](PLAN.md) · [Matriz de paridad](PARITY.md)
