# Manual de Nutri

Nutri tiene tres clientes. La web instalable, la app de macOS y la beta para iPhone consultan la misma cuenta de Supabase. La web dibuja sus pantallas con React. macOS y iPhone comparten vistas SwiftUI y un núcleo Swift. El identificador de la cuenta, las unidades almacenadas y las reglas de acceso conectan los tres clientes. Cada instalación conserva su propia sesión y sus operaciones pendientes.

## Elige tu punto de entrada

| Quiero… | Empieza aquí |
| --- | --- |
| Entender qué hace Nutri desde cada pantalla o reproducir un problema de usuario | [Manual de los seis módulos y de la cuenta](MODULOS.md). Cada módulo incluye recorrido, archivos de ambas interfaces y un ejemplo de prueba. |
| Ejecutar o cambiar la PWA, entender navegación, preferencias, conexión y actualización | [Web y PWA](WEB.md). |
| Trabajar en Swift, distinguir código compartido y específico, compilar, instalar o diagnosticar | [Desarrollo nativo](NATIVO.md), [instalación macOS](../macos/README.md) e [instalación y gestos de iPhone](../ios/README.md). |
| Cambiar un cálculo, un permiso, una migración, el conector MCP o el proxy de IA | [Datos e integraciones](DATOS-E-INTEGRACIONES.md). Para llamadas de terceros hay [ejemplos REST en el README](../README.md#api--contract-for-external-scripts). |
| Auditar casos de uso, experiencia, espacio y atributos no funcionales de punta a punta | [Revisión integral](REVISION-INTEGRAL.md). Matriz trazable por cliente, empezando por iPhone. |
| Decidir qué reglas de proyecto y de planificación aplican | [Instrucciones de trabajo](../AGENTS.md) y [Biblia del proyecto](../BIBLIA.md). El plan maestro aprobado de Anthropometry gobierna objetivos y fases. Los registros de Nutri sirven para seguimiento. |

## Sigue un registro de extremo a extremo

1. Al registrar una comida, el cliente identifica alimento o receta, cantidad en gramos, fecha local y etiqueta. El catálogo conserva nutrientes por 100 g. Con 150 g de un alimento, un nutriente declarado aporta 1.5 veces su valor de catálogo. Una cantidad desconocida conserva su condición de dato faltante.
2. En Hoy, la cola de entradas conserva el cambio mientras llega al servidor. El usuario puede ver su fila antes de que otro dispositivo pueda leerla. Confirma el resultado en una segunda sesión tras la sincronización. [Cola web](../src/lib/outbox.js) y [transporte nativo](NATIVO.md).
3. Las vistas SQL calculan los nutrientes de cada entrada y los totales del día. Hoy y Dashboard relacionan el resultado con la versión de objetivos que corresponde a esa fecha. Editar un alimento puede modificar los totales históricos de sus consumidores. [Tablas, vistas y precedencias](DATOS-E-INTEGRACIONES.md).
4. Si los clientes discrepan, compara la misma cuenta, día, unidad, versión del objetivo y cobertura. Reproduce el caso con datos sintéticos. Compara la vista SQL con el cálculo de dominio y, por último, con lo que presenta cada cliente. [Pruebas web](WEB.md) y [oráculos nativos](NATIVO.md).

## Qué mantener cuando cambia algo

| Cambio | Documentación y verificación |
| --- | --- |
| Pantalla, gesto o formulario | Actualiza el recorrido en [Módulos](MODULOS.md). Revisa React y SwiftUI, tanto la versión compacta como la de escritorio. Conserva pruebas de la acción, su cancelación y el resultado al reabrir. |
| Definición de un nutriente, unidad, regla o dato faltante | Actualiza [Datos e integraciones](DATOS-E-INTEGRACIONES.md). Contrasta SQL, dominio web y núcleo Swift con la misma muestra. Comprueba la huella y los recursos generados según la [guía nativa](NATIVO.md). |
| Autenticación, catálogo, caché o sincronización | Describe qué se guarda por cuenta, qué sobrevive al cierre y qué dispara una lectura remota. Prueba la reconexión y dos clientes abiertos. Para Alimentos comprueba también volver al primer plano y el refresco periódico. |
| Proveedor, API, OAuth, cuotas o migración | Revisa el contrato del consumidor, datos de entrada y salida, autorización y modo de fallo. Actualiza la [guía de integraciones](DATOS-E-INTEGRACIONES.md), los ejemplos públicos afectados y las [evaluaciones](../evals/README.md) si cambia la extracción. |
| Compilación, distribución, configuración o CI | Actualiza el procedimiento del cliente afectado y enlaza el workflow vigente. Distingue pruebas unitarias, simulador, instalación firmada y acciones observadas en hardware. |

## Fuentes y antecedentes

- Las guías anteriores describen el producto actual. El [spec original](../SPEC.md) y el [plan de arranque](../plan-app-nutricion.md) documentan decisiones iniciales. La [planificación de macOS](../macos/PLAN.md), sus [matrices de paridad](../macos/PARITY.md) y los [análisis de fidelidad](../macos/FIDELITY-SHELL-TODAY.md) permiten reconstruir decisiones de migración.
- La [bitácora de ingeniería](../tech-logs/) conserva investigaciones fechadas. Los identificadores efectivos de modelos, horarios y targets de compilación se verifican en su configuración vigente. La [referencia de marca](../brand/nutrimetry-brand.html) acompaña los tokens de cada cliente.
- Para la beta iPhone 1.0.0 (compilación 3), el código de referencia es [d2cc1d6](https://github.com/vryahn/nutri/commit/d2cc1d650dc26da5a17eea4cb612810f8df307d1). En esa revisión pasaron juntas 24 pruebas de interfaz con datos sintéticos en iPhone SE simulado y la compilación Release para dispositivo. El 18 de noviembre de 2026 se verificaron la instalación firmada y el arranque en un iPhone Air desbloqueado. Xcode abrió Nutri y una consulta posterior confirmó que el proceso seguía activo. [Ejecución iOS](https://github.com/vryahn/nutri/actions/runs/44260288239).
