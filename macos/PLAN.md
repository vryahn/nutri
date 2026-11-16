# Nutri nativo para macOS

Fecha: 2026-11-16. Alcance autorizado: aplicación nativa SwiftUI, conservando funciones y datos de Nutri, instalada en esta Mac. No es un contenedor web ni un exportador de datos.

## Arquitectura y entrega

- Cliente SwiftUI en `macos/`, compilado con Swift Package Manager y los frameworks de Apple. Sin WebView, sin dependencias de terceros nuevas.
- Reutilizar Supabase Auth, REST del esquema `nutri`, Storage privado y el proxy de IA existente. Sin migración de base de datos ni claves de proveedores en el cliente.
- Sesión en Keychain; caché y outbox locales separadas por usuario. Errores visibles y escrituras idempotentes. Los nutrientes siguen calculados por las vistas SQL.
- Paquete `Nutri.app` con icono existente, menús, atajos, ventanas y selectores de archivos nativos. Instalación local en `/Applications/Nutri.app`, firma local ad hoc. App Store y notarización para distribución pública no forman parte de esta instalación.
- Mantener la web operativa. Trabajar directamente en `main`; conservar cambios preexistentes de IA/evals; staging por rutas exactas. Commit con `b.ra@live.com.mx`, push y verificación remota tras pruebas.

## Matriz funcional de aceptación

| Área | Funciones que verificar |
| --- | --- |
| Cuenta | Inicio/cierre de sesión, renovación, separación entre usuarios, ajustes de idioma/unidades/tema/perfil y contraseña |
| Hoy | Fecha local, alimentos/recetas/agua, cantidades/porciones/densidad, secciones, editar/borrar/deshacer, orden, copiar día, plantillas, frecuentes, totales/rangos y cobertura |
| Alimentos | Búsqueda, catálogo base/privado, alta/edición/copia/borrado, macros y 108 micros, porciones/densidad, advertencias, importación, IA/foto/EAN y revisión antes de guardar |
| Recetas | Ingredientes, cantidades, peso cocido, cálculo por 100 g, guardado atómico, edición/borrado, importación y asistencia IA |
| Objetivos | Resolución por fecha, versiones/fases, overrides, bounds, reglas como propuestas; edición atómica y preservación histórica |
| Dashboard | Rangos/fases, totales y adherencia con cobertura, tendencias/gráficas, alimentos principales, exportaciones y consulta de bitácora |
| Medidas | Registro/edición por fecha, métricas y derivados, notas, fotos privadas, importación sin perder métricas previas |
| Sin conexión | Arranque con caché, búsqueda local, outbox de registros persistente, UUID idempotente, reconexión, no cruzar usuarios |

## Secuencia

1. Inventario del código y contratos; verificar Swift, acceso Git y escritura en Applications.
2. Dominio, transporte, sesión y persistencia; pruebas sintéticas de límites y paridad.
3. Interfaz nativa de los seis módulos y ajustes; integrar contratos existentes.
4. Build y revisión adversarial: datos ausentes/0, errores, concurrencia, offline, sesión y permisos.
5. Ejecutar la aplicación, inspeccionar interfaz y corregir defectos. Empaquetar e instalar.
6. Ejecutar las pruebas web existentes y Swift; commit/push de archivos propios, verificar CI y aplicación instalada.

## Pruebas obligatorias

- 150 g = 1.5 veces los nutrientes por 100 g; receta (A + 2B)/2.5; ml sin densidad rechazado.
- Cero declarado distinto de desconocido; cobertura parcial nunca muestra adherencia concluyente; piso de sodio conservado.
- Override diario gana a recurrencia; versión futura no anticipada; banda acoplada no elige un target automáticamente.
- Sesión expirada/renovada, errores REST y filas afectadas cero visibles; persistencia aislada por UID.
- Outbox tras reinicio, insert intentado inmutable, edición posterior conservada, retry sin duplicados, errores permanentes visibles.
- Importación con comillas/comas/saltos/BOM, ambigüedades rechazadas; ninguna prueba altera registros personales.
- `swift run --package-path macos NutriChecks`, build release, firma/bundle verificables; `npm run lint`, `npm test`, `npm run build`.
- Apertura desde `/Applications/Nutri.app`; revisión visual de login y módulos con datos sintéticos o una cuenta de prueba disponible. Distinguir explícitamente pruebas locales de verificación autenticada real.

## Límites y reversión

No modificar targets del usuario, plan maestro, políticas RLS, esquema ni cambios ajenos. No guardar datos privados ni tokens en el repositorio o artefactos públicos. Una limitación de paridad impide declarar la migración completa y se registra explícitamente. Para revertir el cliente local, retirar la app instalada; no hay migración de datos que revertir. Para revertir código publicado, commit inverso limitado a esta entrega.

## Referencias técnicas verificadas

- https://developer.apple.com/documentation/swiftui/navigationsplitview
- https://www.swift.org/getting-started/cli-swiftpm/
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/auth/sessions

## Estado

Implementación de seis módulos instalada en `/Applications/Nutri.app`. Desarrollo y release compilados y firmados localmente. Las pruebas de dominio, cola, sesión, llavero, lectura autenticada y escrituras sintéticas con limpieza están verificadas.

La revisión gráfica comprobó el login del bundle instalado y el registro de 150 g en Hoy con el fixture local. ScreenCaptureKit falló durante la revisión de los demás módulos. La matriz de paridad registra la cobertura de las pruebas y lo pendiente.
