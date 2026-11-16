# Paridad nativa de Nutri

| Superficie | Implementado en macOS | Verificación |
| --- | --- | --- |
| Cuenta y ajustes | Login de Supabase, renovación serializada, Keychain, cierre local, español/inglés, unidades, tema, perfil/avatar, contraseña, umbral de sueño y bandas. | Contratos de sesión y esquema simulados en `NutriChecks`. Prueba real de lectura y renovación por separado. |
| Hoy | Fecha local, catálogo en caché, alimentos/recetas/agua, porciones y densidad, secciones, edición, orden, borrar/deshacer, copiar día, plantillas, frecuentes de 30 días e importación CSV. Resumen configurable, micros, cobertura, guía acoplada y propuesta de revisión. | Fixtures locales para flujos de escritura. Comparaciones de dominio, cola y CSV en `NutriChecks`. |
| Transporte y caché | Caché UID, escritura de entradas con UUID, cola persistente, confirmación del UUID ante reenvío y reintento por conexión. Retención del orden de operaciones intentadas y errores de escritura visibles. | Simulación HTTP con sesión expirada, renovación concurrente, respuestas con cero filas, SQLSTATE y cambio de cuenta. |
| Alimentos | Catálogo base y privado, búsqueda local/semántica, alta/edición/copia, borrado con deshacer, micros, porciones/densidad, revisión, importación y datos de IA, USDA y Open Food Facts. | Lectura autenticada de catálogo y revisión de pantallas con datos locales. Proveedores dependen del proxy existente. |
| Recetas | Edición de ingredientes, peso cocido, porciones, cobertura y guardado atómico. Importación, descomposición con IA y respaldo USDA. | Comparaciones de escala y precisión SQL. Prueba de lectura sobre vista de recetas. |
| Objetivos | Fases, versiones, fechas específicas, límites y asistente. Propuestas de ajuste con señales de peso/adherencia, pendientes de revisión en el plan maestro. | Precedencia por fecha y banda acoplada en `NutriChecks`. Pruebas sintéticas de reglas y formularios. |
| Dashboard | Rangos, tendencia, adherencia, cobertura, alimentos principales, gráficas, exportación y consulta de bitácora. | Pruebas sintéticas de agregación, consulta y visualización. Lectura autenticada de totales. |
| Medidas | Medidas, derivados, notas, imágenes privadas, tendencia e importación. | Pruebas sintéticas de derivados y CSV. Lectura autenticada de medidas. |

La demostración pública y la pantalla de consentimiento OAuth de MCP siguen disponibles en la web. El cliente de desarrollo incluye una demostración local separada sin escrituras en Supabase. La carga nativa usa un selector de archivos CSV. Consulta la [matriz de los cuatro módulos](PARITY-MODULES.md) para el detalle de recetas, objetivos, Dashboard y medidas.

## Comprobaciones antes de publicar

- [x] Compilación y firma de desarrollo. Pruebas de módulos con datos sintéticos en el bundle.
- [x] Inspección gráfica del inicio de sesión instalado y del registro de 150 g en Hoy con datos locales.
- [ ] Inspección de interacción de los restantes flujos gráficos. ScreenCaptureKit dejó de entregar imágenes durante la revisión (`SCStreamError -3811`).
- [x] `NutriChecks` numérico y de transporte. Prueba del llavero con credenciales sintéticas separadas.
- [x] Prueba designada de Supabase de solo lectura. Respuestas correctas en siete tablas y vistas, renovación de sesión, aislamiento RLS y revocación de la sesión de prueba. La cuenta de prueba no tenía filas de recetas ni de medidas antes de la prueba de escritura.
- [x] Escritura autenticada con fixtures en la cuenta designada. Alta de alimento, registro de 150 g y edición a 225 g con valores SQL verificados, receta atómica, objetivo por fecha, medida y JPG privado. Limpieza de todas las filas y el objeto verificada por ID y ruta.
- [ ] Verificación de proveedores de IA con una cuenta autorizada por el proxy.
- [x] Compilación release, revisión de valores privados, firma ad hoc, instalación en `/Applications/Nutri.app` y apertura de login.
- [x] Lint, 268 pruebas y compilación web.
