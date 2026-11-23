# Nutri para iPhone · beta personal

La app usa SwiftUI y requiere iOS 17 o posterior. Inicia sesión con la misma cuenta de Nutri que utilizas en la web o en el Mac. El iPhone guarda su propia sesión en el llavero y su propia cola de registros pendientes. Los cambios sincronizados se reflejan en los demás dispositivos.

[Manual de mantenimiento para macOS y iPhone](../docs/NATIVO.md)

## Instalar en tu iPhone

1. Instala Xcode desde el [Mac App Store](https://apps.apple.com/app/xcode/id497799835). Usa una versión que admita el iOS de tu iPhone. Abre Xcode, completa la instalación inicial y selecciona el componente iOS si lo solicita.
2. En **Xcode → Settings → Apple Accounts** (o **Accounts**), añade tu cuenta de Apple. Xcode la mostrará como **Personal Team**.
3. Desde la raíz de este repositorio abre el proyecto con `open ios/Nutri.xcodeproj`. La compilación lee `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del archivo privado `.env` de la raíz. La segunda debe empezar por `sb_publishable_`. En el checkout habitual de Bryan se usa la configuración local existente.
4. En el navegador del proyecto, selecciona **Nutri → TARGETS → Nutri → Signing & Capabilities**. Activa **Automatically manage signing** y selecciona tu **Personal Team**. Si Xcode dice que el **Bundle Identifier** está ocupado, usa uno único, por ejemplo `com.tunombre.nutri.iphone`. Conserva ese identificador y el equipo en las siguientes instalaciones.
5. Conecta el iPhone por USB, desbloquéalo, acepta **Confiar en este ordenador** y selecciónalo como destino junto al esquema **Nutri**. Si Xcode pide activar el **Modo de desarrollador**, hazlo en **Ajustes → Privacidad y seguridad → Modo de desarrollador**. Reinicia el iPhone y confirma al desbloquearlo. La opción aparece después de iniciar el emparejamiento con Xcode.
6. Pulsa **⌘R**. Cuando Nutri se abra en el iPhone, usa **Probar con datos locales** para explorar la compilación Debug o inicia sesión con tu cuenta Nutri para usar la bitácora real. Si iOS pide confiar en el desarrollador, confirma tu cuenta en **Ajustes → General → VPN y gestión de dispositivos** y vuelve a abrir Nutri.

La firma gratuita caduca a los **siete días**. Para renovarla conecta el mismo iPhone y vuelve a pulsar **⌘R** con el mismo equipo e identificador. Instala encima de la copia existente para conservar los registros locales pendientes de sincronizar. [Cuenta gratuita y Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account/) · [Ejecutar una app en un dispositivo](https://developer.apple.com/documentation/xcode/building-and-running-an-app) · [Activar el modo de desarrollador](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)

## Alcance y verificación de la beta

| Decisión de la migración | Verificación |
| --- | --- |
| Compartir el código de Hoy, Alimentos, Recetas, Objetivos, Dashboard, Medidas y Ajustes con macOS. | Compilación de SwiftUI para iPhone y pruebas de navegación táctil con datos sintéticos. |
| Usar el mismo dominio, contratos y transporte. Preservar cero frente a desconocido, agua histórica separada según preferencia, reglas de fase, preferencias atómicas y reintentos de la cola por cuenta. | `NutriChecks`, oráculos calculados por la web y comparación de la huella de contratos de la app con la del sitio. |
| Mantener la jerarquía visual de la web y el indicador de sincronización estable. Adaptar archivos, fotos y exportación al teléfono. | Arranque y navegación en iPhone SE de 375 puntos, con capturas de una sesión sintética. |
| Instalar la beta por firma personal. | Compilación Release para dispositivo en CI. La instalación firmada, los permisos del sistema, la red móvil y la interacción con fotos personales se comprueban en el iPhone físico. |

Para comprobar la sincronización durante la beta, registra en tu cuenta un vaso de agua que realmente hayas tomado. Verifica que se muestre según tu ajuste de agua y que aparezca una sola vez al volver a abrir Hoy en el Mac o la web. Para explorar pantallas sin afectar esa cuenta, usa la demo local de Debug.

## Gestos y acciones en iPhone

Con datos locales, desplaza Hoy hacia el final de la lista. En iOS 18 o posterior, comprueba que queden **Hoy** y **Añadir registro**, y que el último registro pueda quedar por encima de los controles. Toca **Hoy** para reabrir la barra en la misma posición. Cambia de pestaña y prueba el **+** de cada módulo. En **Progreso**, comprueba que Dashboard abra una gráfica y Medidas enfoque el peso del día visible. Repite con Reducir transparencia activado.

| Pantalla | Cómo probarla con los datos locales |
| --- | --- |
| Hoy | Abre el detalle desde el resumen compacto o añade un vaso desde **Agua**. Toca **Añadir registro** y comprueba que puedes registrar con el teclado decimal visible. Toca un registro para editarlo, desliza hacia la izquierda para borrarlo o mantén pulsado para moverlo a otra comida. |
| Alimentos y Recetas | Toca una fila o tarjeta para editar. Un deslizamiento corto se cancela. En Alimentos, usa **Filtros y acciones** para importar un CSV y confirma las filas válidas con el teclado abierto. En Recetas, busca o pega ingredientes y abre de nuevo la receta guardada. |
| Objetivos | Desliza una fase programada para abrir su confirmación de borrado. Desliza una fecha específica para borrarla y toca **Deshacer** para recuperarla. En las reglas puedes elegir y quitar la fecha de pausa desde el calendario. |
| Progreso · Dashboard | Borra un rango guardado y toca **Deshacer**. En la huella nutricional, toca un eje para ver su porcentaje. Las explicaciones de cifras parciales y opciones deshabilitadas también se abren al tocar. |
| Progreso · Medidas | Edita una medida, cambia de día y vuelve para comprobar el autoguardado. En una importación puedes complementar o reemplazar el día existente. |
| Cuenta | Cambia las unidades y comprueba el campo de agua en Hoy. |

Las cantidades, medidas y porcentajes usan teclado decimal. Los días de una regla usan teclado de dígitos. Los ajustes de carbohidratos admiten signo. **Listo** cierra el teclado numérico para seguir editando o guardar.

La compilación 7 cubrió los 31 casos de interfaz en un iPhone Air físico con datos sintéticos, entre la suite completa y las repeticiones focalizadas. Se verificaron los dos estados de la barra, las seis acciones y el acceso al último registro y a **Guardar** en Recetas.

La compilación 6 se probó el 21 de noviembre de 2026 en un iPhone Air con datos sintéticos. En ejecuciones completas y focalizadas pasaron los 29 casos de interfaz. La revisión en el dispositivo confirmó dos registros visibles al abrir Hoy, la barra de pestañas reducida al desplazar, texto de accesibilidad XXXL y **Registrar**, **Guardar** y **Listo** visibles por encima del teclado en el formulario correspondiente. El flujo de CI ejecuta la suite en el simulador de 375 puntos. [Pruebas](NutriUITests/NutriUITests.swift) · [Flujo de CI](../.github/workflows/ios.yml)
