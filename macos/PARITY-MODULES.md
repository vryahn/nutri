# Paridad nativa de Recetas, Objetivos, Dashboard y Medidas

## Funciones implementadas

| Módulo | Flujo nativo | Contrato compartido |
| --- | --- | --- |
| Recetas | Buscar, filtrar por fuente, ordenar, crear, editar y borrar con deshacer. Captura de ingredientes en g, oz y, con densidad, ml o fl oz. Porciones con nombre, peso cocido, cálculo por 100 g y cobertura. Pegado de ingredientes con coincidencia única. IA con texto o hasta dos fotos, sugerencias de duplicados, coincidencias y alias del catálogo, búsqueda USDA y revisión editable de alimentos antes de guardarlos. | `recipes`, `recipe_items`, `recipe_per_100g`, `foods`, `save_recipe_atomic`, `merge_prefs`, proxy `/api/ai`. |
| Objetivos | Resolución por fecha y consulta de banda acoplada. Fases vigentes, programadas y previas. Corrección de fase vigente, nueva versión y edición de fases programadas. Edición histórica limitada al tipo de fase. Fechas específicas con deshacer, límites, reglas y evaluación como propuesta. Asistente para agrupaciones semanales, macros, agua/electrolitos, reglas y varias fechas. Confirmación para sobrescribir fechas del asistente y para borrar una fase programada. | `targets`, `replace_phase_atomic`, lectura de `body_metrics` y `daily_totals`. Asistente guarda todas sus filas con un upsert. Evaluar reglas no escribe objetivos. |
| Dashboard | Rangos cerrados, hoy, rangos locales guardados, fases y uniones por tipo. Totales, comparación con periodo previo aplicable, cobertura, media, suma, mediana/IQR, desviación/CV, tendencia y adherencia bayesiana. Mapa por día, energía/MA7, distribución de macros, micronutrientes frente a objetivo, tendencias, proteína semanal, sodio y alimentos principales. Gráficas propias de hasta cuatro series y dos unidades con agrupación y reductor. CSV de registros y resumen, PDF de informe y consulta de bitácora mediante planificación, lectura y respuesta. | `daily_totals`, `entry_nutrients`, `targets`, `body_metrics`, las gráficas en `prefs.data.dashboards`, proxy `/api/ai`. Los rangos guardados se almacenan localmente por cuenta. |
| Medidas | Fecha, 29 mediciones, notas, favoritos, checkpoint de sueño corto, derivados y tendencias. Importación con vista previa, fusión por defecto y reemplazo explícito de medidas y notas. Fotos privadas con vista, carga y eliminación permanente confirmada. Deshacer eliminación de una fila sin fotos. | `body_metrics`, `prefs.data.fav_body`, `prefs.data.profile.height_cm`, `prefs.data.sueno_umbral_h`, bucket privado `body-photos`. |

`replace_phase_atomic` exige siete filas de origen. La corrección de una fase vigente antigua que tenga días faltantes usa el upsert semanal de la aplicación web. Las versiones nuevas salen con reglas independientes. Un ajuste calculado por la app exige revisión en el plan maestro y se presenta sin acción de aplicación automática.

La presentación usa controles de macOS. La huella nutricional se muestra en barras horizontales, el informe usa PDF nativo paginado y los resultados USDA aparecen al solicitar la búsqueda desde el ingrediente. El lector de bitácora evita pasar a IA un valor parcial como cifra concluyente. La carga y el borrado de fotos usan Storage y PostgREST, con actualización de referencia y manejo de fallos por separado.

## Verificación

- [x] Compilación integrada SwiftUI DEBUG y firma local con el SDK macOS 26.5 de Command Line Tools.
- [x] Ejecución de `Nutri --module-checks` en bundle DEBUG firmado. Casos sintéticos para importación de receta con densidad y rechazo de cantidades incompatibles, nombres ambiguos y masas negativas. Objetivos con cero declarado y piso de sodio. Evaluación de reglas con ámbito histórico de cadenas, ausencia de regla, umbral incompleto, cooldown y banda acoplada. Adherencia con cobertura parcial, cuantil Bayes comparado con la implementación web y rango permitido de la consulta de IA.
- [x] Repetición de compilación DEBUG y `--module-checks` sobre la última versión de estos módulos.
- [ ] Verificación visual y de interacción con datos de demostración. Incluye edición y deshacer, apertura de asistentes, cambios de filtros y exportación a un archivo local.
- [x] Smoke de lectura REST autenticada desde cliente nativo para objetivos, totales diarios, registros, vistas de recetas y medidas. Renovación, cierre de sesión y RLS verificados con cuenta de prueba. Las lecturas con cero filas no ejercitan contenido persistido.
- [x] Prueba autenticada de guardado atómico de receta, objetivo por fecha, medida y foto privada con fixtures en la cuenta designada. Verificada la eliminación de todas las filas y el archivo sintéticos.
- [ ] Prueba autenticada del proxy de IA con una cuenta autorizada.
