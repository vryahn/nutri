# Revisión integral de Nutri

[Manual de Nutri](README.md)

Fecha: 2026-11-21. Estado: propuesto. Revisado en sesión adversarial a dos rondas: autor Claude Opus, red team Codex `gpt-6-astra`. La ronda 1 dejó 30 objeciones y la ronda 2 nueve nuevas, todas integradas aquí. El orden es iPhone primero y después web/PWA y macOS, con la misma matriz.

## 1. Objetivo y alcance

La revisión comprueba cuatro cosas:

- Cada caso de uso de Nutri funciona de punta a punta.
- Cada pantalla aprovecha el espacio sin huecos sin propósito.
- La precisión, la sincronización, la seguridad, la accesibilidad, el rendimiento y la mantenibilidad cumplen la [BIBLIA](../BIBLIA.md).
- Las reglas de [AGENTS.md](../AGENTS.md) se respetan: política de borrado, cierre al tocar fuera, paridad entre clientes y dependencia del plan maestro.

El resultado es una matriz trazable de casos con evidencia y un backlog priorizado. El backlog se corrige por tandas.

Queda fuera de alcance:

- iPad y orientación horizontal, porque el proyecto declara solo iPhone vertical.
- Funciones nuevas.
- Cambios normativos de metas o reglas, que gobierna el plan maestro de Anthropometry.
- Refactorizaciones sin un impedimento concreto.

## 2. Principios

- La precisión de los datos gana cualquier trade-off de experiencia de usuario.
- Design thinking en cuatro pasos:
  1. Empatizar: observar tareas reales de las dos personas usuarias.
  2. Definir: describir el problema con evidencia y un caso ID.
  3. Idear: proponer la solución mínima con la skill ponytail.
  4. Probar: usar la misma prueba que detectó el fallo, que debe fallar antes del arreglo y pasar después.
- Las heurísticas de referencia son Apple HIG (iOS 17–26), las heurísticas de Nielsen y la ley de Fitts. Orientan el análisis y solo se vuelven requisito después de observar la tarea (§6.3).
- La evidencia sintética no basta para cerrar un caso. Cada caso declara su entorno, y algunos exigen persistencia real, una sesión autenticada o el iPhone físico.

### Datos reales y autoridad

- Toda escritura de prueba (fases, metas, reglas, alimentos, recetas, fotos, borrados) ocurre en la cuenta de pruebas o en la demo, con fixtures identificables por el prefijo `QA-` y una limpieza verificada al terminar.
- En las cuentas reales solo se registran observaciones verdaderas, por ejemplo una comida o un pesaje que de verdad ocurrieron. No se introducen datos ficticios ni se altera la planificación.
- Capturas, trazas de Instruments, CSV y PDF se guardan en `privado/revision-integral/`, que está gitignoreado. Antes de subir cualquier artefacto al repo o a CI se revisa y se redacta para eliminar datos personales. Siempre que sea posible se usan datos sintéticos.

## 3. Entornos de evidencia

| Código | Entorno y procedimiento | Qué demuestra | Qué NO demuestra |
| --- | --- | --- | --- |
| SIM-DEMO | Simulador con `--ios-ui-demo` y XCUITest | Layout, gestos, navegación y cálculos del cliente | La persistencia de la cola, porque la demo no tiene directorio persistente (`Store.swift:134`). La IA real, porque usa fixtures (`CatalogAI.swift:59`). La red. |
| SIM-PERSIST | Simulador con sesión de la cuenta de pruebas. Bryan inicia sesión una vez, ya que el agente no teclea contraseñas, y la sesión queda en el Keychain del simulador. Después se relanza y se termina la app según cada caso. | Cola y caché en disco, recuperación tras terminar la app, cambio de cuenta local, interfaz contra datos reales de prueba | La red móvil y los permisos reales |
| LIVE-TEST | `python3 macos/scripts/check-live.py .env`, que usa `VITE_DEV_*` con la cuenta de pruebas, y `--write-fixtures` para `LiveWriteChecks`. Además, preview web con `/?dev=1` y la API REST con la misma cuenta. | Escrituras, RLS, Storage, concurrencia con la web, limpieza de fixtures | La IA real: el proxy restringe por UID (`api/ai.js:116`) y la cuenta de pruebas puede no estar autorizada. |
| DEVICE | iPhone físico de Bryan con una build Release firmada | Cámara, fototeca, red móvil, rendimiento, VoiceOver real, firma de 7 días, IA real con su cuenta autorizada (sin guardar resultados ficticios) | — |

Identidades. Las pruebas negativas automatizadas usan dos identidades no reales: la cuenta de pruebas (A) y una demo anónima (B). La comprobación entre las dos cuentas reales que exige BIBLIA §4.1 la ejecuta Bryan y es de solo lectura. El agente nunca guarda ni teclea esas credenciales.

Dispositivos. Los factores se combinan por pares, no como producto cartesiano:

- iPhone Air en simulador: dispositivo por defecto de toda prueba (decisión de Bryan, 2026-11-22), igual que su iPhone físico.
- Ancho mínimo: iPhone 17e, el más estrecho disponible en el runtime instalado (iOS 27.2). El iPhone SE de 375 pt y los runtimes de iOS 17–26 no están instalados; los casos de ancho mínimo se corren en el 17e solo cuando el caso lo exige.
- iPhone físico en DEVICE.

Idioma, tema, unidades y tamaño de texto también se combinan por pares. Dos cruces críticos se prueban siempre completos en iPhone Air: XXXL + inglés, y teclado + banner.

Datasets:

- Demo poblada.
- Cuenta vacía (primer uso).
- Día con más de 30 registros.
- Nombres largos de alimentos y micros.
- Cobertura parcial.
- Registros pendientes en cola.
- Fixture de Dashboard con fases discontinuas, overrides y bounds mixtos, calculado de forma independiente (D-02).
- Fixture `QA-` de 30 días en la cuenta de pruebas para medir rendimiento.

## 4. Fase 0: línea base

1. Comprobar que XCUITest (29 casos) y `NutriChecks` pasan. Mapear los 29 casos existentes a IDs de la matriz sin reescribirlos.
2. Registrar el runtime de iOS y las dimensiones reales de cada destino.
3. Inventariar cada presentación flotante: hojas, modales propios, menús, popovers y avisos. Por cada una, registrar tipo, cierre al tocar fuera, destino del foco, conservación del borrador, visibilidad de errores y de Deshacer. El inventario se evalúa contra §6.1.
4. Expandir cada ID de la matriz en una hoja de ejecución privada, con pasos, fixture concreto, criticidad y evidencia esperada.
5. Medir la línea base de rendimiento (§7.4).
6. Verificar primero las hipótesis estáticas de §8, que son baratas de confirmar y tienen alta probabilidad de ser defecto.

## 5. Matriz de casos de uso (iPhone)

Cada caso tiene ID, oráculo verificable, entorno, responsable, estado y evidencia. Los estados posibles son aprobado, fallido, bloqueado y no aplica. La evidencia puede ser un test, una captura o una consulta. Responsables: C = Claude con automatización; B = Bryan en DEVICE o con credenciales reales. El asterisco (\*) marca casos críticos, porque pueden producir un hallazgo S1 o S2. Un caso crítico bloqueado impide cerrar.

### Transversales

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| X-01\* | Borrar un solo elemento en cada lugar donde existe: registro, plantilla, alimento, receta, fecha específica, rango guardado y etiqueta | Sin confirmación, borrado optimista y Deshacer durante 5 s que restaura el elemento exacto | SIM-DEMO, SIM-PERSIST | C |
| X-02\* | Borrar varios elementos: Borrar día y fase programada | Pide confirmación. Cancelar no modifica nada. | SIM-DEMO | C |
| X-03\* | Borrar una foto de progreso | Pide confirmación. Cancelar no toca Storage ni las referencias. | LIVE-TEST | C |
| X-04\* | Cada presentación flotante que no ocupa toda la pantalla, según el inventario de Fase 0 | Se cierra al tocar fuera. Cualquier excepción se documenta con su limitación nativa concreta antes de aceptarse. | SIM-DEMO | C |

### Hoy

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| T-01\* | Registrar un alimento por búsqueda, con porción y por gramos | Nutrientes = gramos / 100 × valores. 150 g = 1.5 × macros y micros. | SIM-DEMO, SIM-PERSIST | C |
| T-02\* | Registrar un líquido en ml y fl oz con densidad distinta de 1 | Gramos persistidos = ml × densidad. Al reabrir se ve la misma cantidad. | SIM-PERSIST | C |
| T-03 | Frecuentes con y sin sección preseleccionada | Máximo 8 chips. La cantidad propuesta es la moda y se puede editar. Se respeta el contexto de la sección. | SIM-DEMO | C |
| T-04\* | Gestos sobre la misma tarjeta: scroll vertical, toque, swipe corto, swipe completo y pulsación larga | Cada gesto produce solo su efecto: el toque edita, el swipe corto se cancela, el swipe completo borra con Deshacer y la pulsación larga mueve. Posición y datos quedan intactos. | SIM-DEMO | C |
| T-05 | Arrastrar dentro de una sección y entre secciones. Intentar arrastrar una fila pendiente ⛅ | `sort_order` se persiste por id. La fila pendiente no se mueve. | SIM-DEMO, SIM-PERSIST | C |
| T-06 | Agua: añadir vaso, cantidad libre, cambiar el tamaño del vaso, quitar el último, unidades imperiales | Total y meta correctos. El agua nunca aparece en micros. | SIM-DEMO | C |
| T-07\* | Copiar y pegar día, Ayer y plantillas | El agua no se copia. Las filas pendientes salen de la cola al borrar el día. | SIM-DEMO, SIM-PERSIST | C |
| T-08 | Importar CSV en Hoy | Solo entran filas válidas. Las coincidencias y las filas excluidas se ven antes de confirmar. | SIM-DEMO | C |
| T-09\* | Resumen Estado, Objetivos y Mini; personalizar; mostrar rangos; cobertura parcial | Sodio < 1,500 mg siempre en rojo. Con cobertura incompleta no aparece un porcentaje concluyente. | SIM-DEMO | C |
| T-10\* | "Guardar y registrar" desde una fecha histórica y una sección concreta, incluido cancelar y volver | El registro se persiste en esa fecha y sección. Cancelar no deja un borrador huérfano. | SIM-DEMO, SIM-PERSIST | C |
| T-11\* | Pasar la medianoche con el editor abierto, tras suspender la app y tras cambiar de zona horaria | La fecha visible coincide con la persistida y ningún registro cae en otro día | SIM-PERSIST | C |
| T-12\* | Secciones: crear, renombrar, ordenar, archivar una con registros históricos, Deshacer y recrear con el mismo nombre | Al archivarla, sus registros pasan a "Sin etiqueta". Recrearla la revive. Las referencias históricas quedan intactas. | SIM-PERSIST | C |
| T-13 | Propuesta de regla de fase | Muestra el motivo y no modifica las metas | SIM-DEMO | C |

### Cola y sincronización

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| Q-01\* | Se pierde la respuesta después de que el servidor confirmó la escritura | El reintento choca con la PK y se descarta. Queda un solo UUID con el payload final. | LIVE-TEST | C |
| Q-02\* | Terminar la app antes de confirmar localmente y relanzarla | La operación se reanuda y la cola termina vacía | SIM-PERSIST | C |
| Q-03\* | Insertar y después editar o borrar mientras la operación está pendiente o en vuelo | El estado final es la última intención. Los nutrientes de la vista coinciden con `entryNutrients`. | SIM-PERSIST | C |
| Q-04\* | Rechazo permanente con operaciones dependientes | Se descartan con un aviso visible y nada queda colgado | LIVE-TEST | C |
| Q-05\* | Activar modo avión, registrar, cerrar sesión y entrar con otra identidad | La cola de A nunca se escribe como B. La caché queda aislada por uid. | SIM-PERSIST | C |
| Q-06\* | Editar el mismo día desde la web y desde el iPhone | Sin duplicados ni ediciones perdidas | SIM-PERSIST, LIVE-TEST | C |
| Q-07\* | Red móvil: registrar con datos celulares, pasar de Wi-Fi a celular durante un drenaje y quedarse sin cobertura | La cola se drena sin duplicar. El indicador ⛅ es fiel en todo momento. | DEVICE | B |

### Alimentos

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| F-01 | Búsqueda por texto y semántica, sin conexión; filtros combinados y limpiar | Aparecen resultados del catálogo propio y del base. Sin red se usa el fallback local. | SIM-DEMO, SIM-PERSIST | C |
| F-02\* | Alta manual con base en g y con base en ml con densidad; base ml sin densidad | Normalización exacta por 100 g: 100 ml × 1.03 = 103 g. Sin densidad no se puede guardar. | SIM-DEMO | C |
| F-03\* | Datos con IA: texto, foto, EAN válido e inválido, chips USDA | Un EAN inválido tecleado bloquea. La etiqueta gana a OFF. Un 0 no llena el campo. | SIM-DEMO (fixtures); DEVICE con proxy real | C, B |
| F-04 | Micros con nombres largos, favoritos y unidades en iPhone Air + inglés + XXXL | El micro se identifica sin hover. La estrella mide al menos 44 pt. | SIM-DEMO | C |
| F-05 | Editar, guardar copia del catálogo base, borrar, y swipes según propietario | Un alimento del catálogo base no se edita directamente: se crea una copia privada. | SIM-DEMO, SIM-PERSIST | C |
| F-06 | Importar CSV | Solo entran filas válidas. La revisión es accesible con el teclado abierto. | SIM-DEMO | C |
| F-07 | Avisos ⚠, marcar como revisado y editar después | El guardado posterior limpia `reviewed_at` | SIM-PERSIST | C |
| F-08 | Ver en el iPhone un cambio hecho en la web, con Wi-Fi estable, reconexión, pestaña activa, pestaña inactiva y app suspendida | Se mide desde el commit en la web hasta que la fila se ve en el iPhone. Con la pestaña activa: ≤ 30 s de espera + duración de la consulta + 5 s, porque la espera empieza al terminar cada consulta (`FoodsView.swift:293`). Pestaña inactiva o app suspendida: 0 consultas periódicas. Pestaña activa: ≤ 2 consultas de catálogo por minuto. | SIM-PERSIST, LIVE-TEST | C |

### Recetas

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| R-01\* | Crear una receta con ingredientes, peso cocido y porciones | (A + 2B) / 2.5. Dos ingredientes de 100 g y 100 kcal con 160 g finales = 125 kcal/100 g. | SIM-DEMO, SIM-PERSIST | C |
| R-02 | Pegar una lista con un nombre ambiguo y un volumen sin densidad | El nombre ambiguo exige elegir. El volumen sin densidad no se convierte. | SIM-DEMO | C |
| R-03\* | Conversión ida y vuelta g↔oz y ml↔fl oz, coma decimal, porciones acumuladas y peso cocido imperial | Preview, base de datos y reapertura coinciden dentro de 0.1 g. Los gramos canónicos se conservan mientras no se editen. | SIM-DEMO, SIM-PERSIST | C |
| R-04 | IA: descomponer, duplicado sugerido, ingrediente nuevo con nombre largo y números de varios dígitos | La fila no se solapa y los campos editables se leen | SIM-DEMO; DEVICE con proxy real | C, B |
| R-05\* | Guardado atómico con fallo de red y con modificación concurrente desde la web | Sin estado parcial y sin sobrescritura inadvertida | SIM-PERSIST, LIVE-TEST | C |
| R-06 | Reabrir una receta guardada | Coincide exactamente con lo guardado | SIM-DEMO | C |

### Objetivos (solo cuenta de pruebas o demo)

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| O-01\* | Consultar una fecha antes del inicio, un día normal y un override | El override gana. Una versión futura no se anticipa. | SIM-DEMO | C |
| O-02\* | Programar fase, corregir la vigente y crear nueva fase desde hoy | Las 7 filas quedan coherentes. En fases previas solo cambia el régimen. | SIM-PERSIST | C |
| O-03\* | Fallo inyectado en cada camino de guardado: guardado ordinario, `replace_phase_atomic` y `saveWizard`. Colisión de fechas. Modificación concurrente entre la lectura de validación y la escritura, con los mismos IDs y distinto contenido. | Sin estados parciales. Confirmación explícita antes de sobrescribir. Se detecta el cambio de contenido. | SIM-PERSIST, LIVE-TEST | C |
| O-04 | Bounds: mínimo mayor que máximo, objetivo fuera de rango, piso de sodio | Avisos ⚠ no bloqueantes. El piso de 1,500 mg es inamovible. | SIM-DEMO | C |
| O-05 | Reglas: editar, pausar desde el calendario y quitar la pausa; teclado de dígitos y teclado con signo | Evaluar una regla deja las metas intactas | SIM-DEMO | C |

### Progreso · Dashboard

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| D-01 | Presets, rango manual y rangos guardados | Los presets históricos terminan ayer. Hoy incluye el día en curso. | SIM-DEMO | C |
| D-02\* | Operaciones (suma, promedio, mediana/IQR, σ/CV, tendencia, Bayes) sobre el fixture de fases discontinuas, días vacíos y parciales y bounds mixtos | Cifras, denominadores y Hints idénticos al fixture calculado de forma independiente | SIM-DEMO | C |
| D-03 | Mis gráficas: 4 series y 2 unidades; reabrir con la variable elegida; tocar para leer | Los valores coinciden con los datos del rango | SIM-DEMO | C |
| D-04 | Exportar CSV crudo, resumen y PDF: guardar, reabrir, cancelar, reintentar; proveedor de Archivos no disponible o sin espacio; informe largo | Contenido y paginación correctos. Los micros ausentes quedan como celdas vacías. El fallo se muestra con un aviso. La UI no se congela. | SIM-DEMO, DEVICE | C, B |
| D-05 | Preguntar a la bitácora | Solo usa cifras del contexto. El rango no pasa de 92 días. | DEVICE con cuenta autorizada | B |

### Progreso · Medidas

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| M-01\* | Autoguardado al cambiar de fecha y de campo | El valor se persiste y se relee | SIM-DEMO, SIM-PERSIST | C |
| M-02\* | Interrupción con un campo activo: bloquear, cambiar de app, terminar y fallo de red | La persistencia se confirma o el borrador se recupera. Nunca aparece un falso "Guardado". | SIM-PERSIST, DEVICE | C, B |
| M-03 | Favoritos, medidas segmentales, derivados y sueño en iPhone Air + XXXL | Todo se lee completo y la unidad nunca se oculta | SIM-DEMO | C |
| M-04 | Importar en modo complementar y en modo reemplazar | Las fotos se conservan en los dos modos | SIM-DEMO | C |
| M-05 | Fotos desde biblioteca, Archivos y cámara: permiso inicial, denegado y reautorizado; cancelar cada selector; foto de iCloud pendiente; archivo ilegible | El formulario se conserva, el aviso es claro y sigue siendo posible capturar a mano | DEVICE | B |
| M-06\* | Corte de red entre referencia y subida (`BodyView.swift:800`, `:802`) y entre borrado y metadatos (`:827`, `:839`); subida múltiple parcial; cambio de cuenta durante la operación | Se distinguen dos estados. El transitorio es visible y explicado. El final, reconciliado tras reconexión y relanzamiento, no deja referencias huérfanas ni objetos sin referencia. Nunca se borra un objeto cuya subida quedó ambigua. | SIM-PERSIST, LIVE-TEST | C |

### Cuenta, ciclo de vida y seguridad

| ID | Caso | Oráculo | Entorno | Resp. |
| --- | --- | --- | --- | --- |
| A-01 | Login, validación local, demo y cerrar sesión con pendientes | Avisa si hay cola sin sincronizar | SIM-DEMO, SIM-PERSIST | C |
| A-02 | Idioma, unidades y tema | El cambio es inmediato y los gramos canónicos no cambian | SIM-DEMO | C |
| A-03 | Perfil, avatar desde biblioteca o cámara, cambiar contraseña | El avatar queda separado de las fotos de progreso | DEVICE | B |
| A-04 | Configuración de bandas y umbral de sueño | Hoy y Dashboard usan las bandas nuevas | SIM-DEMO | C |
| A-05\* | Sesión expirada, 401, 5xx, proxy de IA con 501 o 403, respuesta vacía | Error visible con acción. Se usa la caché cuando corresponde. | SIM-PERSIST, LIVE-TEST | C |
| A-06 | Cliente desactualizado: huella coincidente, divergente e inaccesible | El banner es correcto. Las operaciones críticas funcionan o se bloquean con explicación. | SIM-PERSIST | C |
| A-07 | Renovar la firma de 7 días instalando encima | Se conserva la cola local | DEVICE | B |
| S-01\* | Con la identidad A, leer y escribir filas conocidas de B (`entries`, `foods`, `targets`, `body_metrics`, `prefs`) y su prefijo en `body-photos` | Lectura vacía. Escritura y Storage denegados. | LIVE-TEST | C |
| S-02\* | Comprobación entre las dos cuentas reales (BIBLIA §4.1) | Ninguna ve datos privados de la otra | Navegador y DEVICE | B |
| S-03 | Revisar el bundle Release y los logs | Solo contiene la publishable key. Los logs no tienen PII. `PrivacyInfo.xcprivacy` es coherente con las APIs que se usan. | DEVICE, revisión estática | C |
| S-04\* | Auditar dependencias: alertas de Dependabot y `npm audit` (web), paquetes Swift resueltos (nativo) | Cada alerta se clasifica según dónde llega: bundle de producción, función serverless (`api/`), solo build o dev, o no alcanzable. Crítica o alta en producción o serverless = S1, se corrige actualizando o reemplazando sin añadir dependencias nuevas. Solo build o dev = S3, con motivo documentado. | Revisión estática, CI | C |
| AX-01\* | Completar T-01, T-06 y M-01 solo con VoiceOver | Cada paso es alcanzable. El foco es correcto al abrir y cerrar modales. Cada acción de gesto tiene una acción personalizada. | DEVICE | B |
| AX-02\* | Dynamic Type de tamaño por defecto a XXXL | La tipografía crece de forma medible (H1) y no hay recortes | SIM-DEMO | C |
| AX-03 | Contraste en ambos temas, reducir movimiento y reducir transparencia | Ningún par baja de 4.5:1 y se respetan las dos preferencias | SIM-DEMO | C |

## 6. Experiencia y espacio

### 6.1 Puertas obligatorias

Un fallo en cualquiera de estas puertas es un hallazgo S2 y no se promedia con el resto:

- Ninguna acción primaria (Registrar, Guardar, Listo, Deshacer) queda tapada por el teclado, un banner, un inset o la barra de pestañas.
- Ningún dato numérico ni nombre de nutriente queda truncado sin una forma táctil de leerlo completo.
- No hay controles solapados en iPhone Air con XXXL.
- Todo flotante que no ocupa toda la pantalla se cierra al tocar fuera (X-04) y conserva el borrador o avisa antes de perderlo.
- La política de borrado se cumple (X-01 a X-03).

### 6.2 Rúbrica de espacio y jerarquía

Cada criterio se puntúa de 0 a 2 con estas anclas:

| Criterio | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Primera vista | La tarea principal requiere scroll en iPhone Air con texto por defecto | Visible pero comprimida o detrás de un banner | Dato y acción principales visibles en la altura realmente disponible |
| Huecos | Un bloque vacío sin información ni acción saca contenido útil de la vista | Hueco tolerable, o estado vacío sin acción | Todo espacio en blanco separa grupos o es margen de seguridad. El estado vacío tiene mensaje y acción. |
| Jerarquía | Varios datos compiten como primarios | El primario está claro pero los secundarios hacen ruido | Un primario por tarjeta, secundarios subordinados y números alineados |
| Consistencia | El patrón difiere del resto de la app para la misma acción | Variación menor | Mismo patrón de hoja, swipe, Deshacer y cierre que el resto |

Cada pantalla se evalúa en reposo y en transición. Hay que capturarla antes y después de abrir el teclado, de mostrar avisos, de expandir contenido, de abrir una hoja anidada y de cerrarla, para detectar huecos residuales o saltos. La altura disponible se mide con el banner de demo o versión visible, con una fila pendiente o un Deshacer en pantalla y con las pestañas expandidas y reducidas.

### 6.3 Tareas observadas

Antes de fijar requisitos de rapidez o ergonomía, las dos personas usuarias ejecutan cinco tareas en su propio iPhone y solo con datos verdaderos. Todas empiezan con la app en primer plano en Hoy. El fin de cada tarea es:

- Registrar un frecuente: la fila aparece con sus nutrientes.
- Registrar por búsqueda: la fila aparece con sus nutrientes.
- Registrar agua: el total de agua se actualiza.
- Corregir un registro: la fila muestra el nuevo valor.
- Pesarse: el valor se relee al cambiar de día y volver.

En cada tarea se cuentan toques, tiempo y errores. Las metas de toques y de tiempo se fijan después de esta observación y por tamaño de texto. No se impone "todo sin scroll" ni "todo abajo" donde choque con XXXL o con la navegación nativa.

## 7. No funcional (iPhone)

### 7.1 Severidad

- **S1**: dato guardado incorrecto, pérdida de datos, exposición de datos entre cuentas o acceso no autorizado (tablas, fotos, caché o cola local).
- **S2**: caso de uso bloqueado o puerta de §6.1 incumplida.
- **S3**: fricción, espacio mal usado o rendimiento fuera de presupuesto sin bloqueo.
- **S4**: pulido.

### 7.2 Seguridad, privacidad y accesibilidad

Estos aspectos están en la matriz como S-01 a S-03 y AX-01 a AX-03, con el mismo tratamiento de estado, evidencia y criticidad que cualquier otro caso.

### 7.3 Rendimiento

Condiciones de medición:

- Build Release en el iPhone físico, con el fixture `QA-` de 30 días en la cuenta de pruebas.
- Wi-Fi estable. Para los arranques con caché también se mide en modo avión.
- 10 repeticiones por métrica, reportando p50 y p95.
- Arranque en frío: después de reiniciar el iPhone. Arranque en caliente: después de forzar el cierre sin reiniciar.

| Métrica | Medición | Presupuesto inicial |
| --- | --- | --- |
| Arranque en frío con caché | Instruments App Launch hasta el primer frame, más el tiempo hasta que el resumen de Hoy muestra datos, medido en vídeo a 60 fps | p95 ≤ 2.0 s |
| Arranque en caliente | Desde que se toca el icono hasta que Añadir registro responde al toque, en vídeo a 60 fps | p95 ≤ 0.8 s |
| Scroll de Hoy con más de 30 registros y de Dashboard | Instruments Animation Hitches | hitch ratio < 5 ms/s |
| Memoria | Instruments Allocations tras 3 ciclos por las 6 pantallas | crecimiento < 20 MB |
| PDF largo, carga de fotos y drenaje de 50 operaciones en cola | Instruments Hangs | ningún bloqueo > 250 ms |

La línea base de Fase 0 confirma o ajusta estos presupuestos. Una regresión respecto a la línea base es un hallazgo aunque cumpla el presupuesto.

### 7.4 Energía y mantenibilidad

- Energía y red: F-08 cubre las consultas por minuto. No debe haber ningún ciclo de refresco con la app en segundo plano.
- Mantenibilidad: solo se refactoriza ante un impedimento concreto para corregir o probar un hallazgo. El tamaño de un archivo no es un hallazgo por sí mismo.

## 8. Hipótesis de la revisión estática

Hay que verificarlas primero. Las citas apuntan a `macos/Sources/NutriApp/`, salvo `NutriUITests.swift`, que está en `ios/NutriUITests/`. Astra contrastó cada cita en la ronda 2. Cada una indica dónde mirar y no prueba por sí sola el efecto observable.

| ID | Hipótesis | Evidencia | Caso |
| --- | --- | --- | --- |
| H1 | La tipografía propia no escala con Dynamic Type: crea un `CTFont` de tamaño fijo, sin `UIFontMetrics` ni `relativeTo` | `DesignSystem.swift:121`, `:124–129` | AX-02 |
| H2 | Bloquear el teléfono con un campo de Medidas activo no guarda. El autoguardado depende del cambio de foco o de `onDisappear`, y `scenePhase` solo drena la cola de Hoy. | `BodyView.swift:253`, `:254`; `NutriApp.swift:102` | M-02 |
| H3 | El asistente de metas compara conjuntos de IDs y no detecta cambios de contenido concurrentes | `TargetsView.swift:654` (`saveWizard`), `:663`, `:667` | O-03 |
| H4 | Quedan estados intermedios entre foto y referencia: la referencia se registra antes de la subida, y el objeto se borra antes de quitar la referencia | `BodyView.swift:800`, `:802`, `:827`, `:839` | M-06 |
| H5 | Los micros de Alimentos se truncan en pantallas estrechas: dos columnas, una sola línea y `.help` sin equivalente táctil | `FoodsView.swift:927`, `:969` | F-04 |
| H6 | La fila de ingrediente nuevo de IA se comprime: nombre, cantidad de 54 pt, dos botones y cuatro macros en horizontal | `RecipesView.swift:571`, `:578`, `:582`, `:587`, `:593`; `Platform.swift:117` | R-04 |
| H7 | Medidas mantiene dos columnas y filas de 44 pt con texto ampliado | `BodyView.swift:230`, `:443`, `:458` | M-03 |
| H8 | La altura útil la consumen a la vez el banner, el inset de avisos, el inset de registrar, las pestañas y el teclado | `NutriApp.swift:249`, `:284`; `TodayView.swift:233` | §6.2 |
| H9 | Las hojas grandes con contenido alineado arriba dejan un hueco inferior (Agua y resumen). Los modales propios se limitan al 88 %. | `TodayView.swift:259`, `:311`; `SharedViews.swift:217` | §6.2 |
| H10 | El refresco de 30 s de Alimentos puede seguir corriendo con la pestaña inactiva dentro de `TabView` | `FoodsView.swift:289`, `:293`; `NutriApp.swift:249` | F-08 |
| H11 | El cambio automático de fecha a medianoche con un editor abierto puede registrar en otro día | `TodayView.swift:212`, `:216`, `:1011` | T-11 |
| H12 | El test de "Guardar y registrar" termina antes del registro definitivo | `NutriUITests.swift:348`, `:373` | T-10 |

## 9. Ejecución por tandas

1. Fase 0 (línea base) y verificación de H1 a H12.
2. Tanda iPhone S1: Q-01 a Q-07, M-02, M-06, R-05, O-03 y S-01 a S-04.
3. Tanda iPhone S2: puertas de §6.1, AX-01, AX-02 y casos funcionales bloqueados.
4. Tanda iPhone S3 y S4: rúbrica de espacio, rendimiento y pulido.
5. Fase web/PWA: la misma matriz a 375, 768 y 1280 px, cambiando el entorno por navegador y preview.
6. Fase macOS: ventana estrecha y amplia, teclado, ratón y arrastre.

### Puerta antes de cada push

En Nutri, push equivale a deploy. Antes de cada push de una tanda hay que cumplir todo lo que aplique:

- Una prueba que falla antes del arreglo y pasa después.
- Paridad en web, macOS e iOS en el mismo cambio. Una diferencia solo se acepta por limitación real de la plataforma o porque la función es exclusiva de un cliente, y se documenta en MODULOS.md o NATIVO.md.
- Cada cliente tocado se verifica con su prueba propia:
  - Web: lint, test, build y preview a 375, 768 y 1280 px con estados degradados.
  - Swift compartido: `NutriChecks`, `--module-checks`, XCUITest y el build de macOS.
- Casos numéricos si el cambio toca cálculos.
- `npm run eval` sin regresión si el cambio toca `src/lib/ai.js`.
- El recorrido afectado documentado en el mismo commit.

Para después solo queda la cobertura ajena al cambio.

## 10. Criterios de cierre

- Todos los casos de la matriz tienen estado y evidencia, y ningún caso crítico (\*) está bloqueado.
- No queda ningún hallazgo S1 o S2 abierto.
- Todas las puertas de §6.1 se cumplen en iPhone Air con texto por defecto y XXXL.
- La rúbrica de §6.2 no tiene ningún 0 en Hoy, Agua, Añadir registro y Medidas.
- Los presupuestos de §7.3 se cumplen, o Bryan acepta la desviación con un motivo.
- Los fixtures `QA-` están limpios y verificados.
- La CI de web, macOS e iOS está verde.

## 11. Registro de ejecución

### 2026-11-22 · Fase 0 y primera tanda (iPhone)

Orquestación: Claude Opus. Trabajo mecánico de checks locales y análisis de dependencias: Codex `gpt-6.2-sol`. El sandbox del plugin Codex (`workspace-write`) no permite `xcodebuild` ni `simctl`, así que el orquestador lanzó las corridas del simulador con los logs a archivo. Evidencia en `privado/revision-integral/fase0/`.

**Línea base**

| Check | Resultado |
| --- | --- |
| Oráculos web, contrato nativo, `NutriChecks`, `--module-checks`, build Release de macOS | OK |
| `npm run lint`, `npm test` (292), `npm run build` | OK |
| XCUITest en iPhone Air, iOS 27.2 | 29/29 OK con las correcciones de esta tanda. El SE creado para la línea base desapareció del runtime y un disco lleno invalidó dos corridas intermedias; ninguna de las dos llegó a ejecutar pruebas válidas. |

**Hipótesis**

| ID | Resultado |
| --- | --- |
| H1 | Confirmada (S2, AX-02). Corregida: `NutriTypography` escala con `UIFontMetrics` solo en iOS, con tope de 1.6×. El tamaño por defecto no cambia. Un cambio de tamaño en vivo se aplica al redibujar cada vista. |
| H2 | Confirmada (S1, M-02), también en la web. Corregida: SwiftUI guarda al cambiar `scenePhase` y la web en `visibilitychange`, solo si hay ediciones. Sin `beginBackgroundTask`: la escritura dispone de los segundos de gracia del sistema. Falta la prueba en el iPhone físico (M-02, responsable B). |
| H3 | El asistente solo compara IDs. Es un caso concurrente raro con confirmación explícita previa: S3, sin cambio. |
| H10 | Probable falso positivo: `.task(id: scenePhase)` se cancela al desaparecer la pestaña. Pendiente de medir en F-08. |
| H11 | Caso de borde de medianoche con el editor abierto: S3, pendiente de T-11. |
| H12 | Hueco de cobertura del test: pendiente de T-10. |
| H4–H9 | Pendientes de la revisión visual (§6.2) y de LIVE-TEST. |

**S-04 (dependencias)**

- Antes: npm reportaba 1 crítica, 6 altas, 16 moderadas y 1 baja; Dependabot, 43 alertas abiertas.
- Alcanzables desde `api/mcp.js` (S1): `@modelcontextprotocol/sdk` 1.30.0 → 1.32.2 y `zod` 4.4.3 → 4.6.7.
- `proxy-addr` (la crítica) y `body-parser` vienen de la rama Express del SDK, que `api/` no carga (S3).
- Se actualizaron también, solo de build y desarrollo: `vite` 7.3.8, `source-map-js` 1.2.4 y `brace-expansion`.
- Todo con `npm update` dentro de los rangos de `package.json`, sin dependencias nuevas.
- Después: 0 críticas y 0 altas. Quedan 15 moderadas y 1 baja (6 moderadas en el árbol de producción). `api/mcp.js` y `api/ai.js` cargan con las versiones nuevas.

**Pendiente de la tanda S1:** Q-01 a Q-07, M-06, R-05, O-03 y S-01 a S-03 requieren SIM-PERSIST o LIVE-TEST, que necesitan que Bryan inicie sesión una vez con la cuenta de pruebas en el simulador, o el iPhone físico.
