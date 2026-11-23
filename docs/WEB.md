# Desarrollo y operación de la web

[Manual de Nutri](README.md) · [Recorridos por pantalla](MODULOS.md) · [Datos e integraciones](DATOS-E-INTEGRACIONES.md) · [Clientes nativos](NATIVO.md)

## Arranque en un checkout existente

Usa Node 24 según [.nvmrc](../.nvmrc) y los scripts de [package.json](../package.json). En la raíz, configura el archivo local `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. La segunda variable recibe la clave publicable del proyecto de pruebas. El [ejemplo de entorno](../.env.example) enumera opciones locales. Un checkout que ya apunta a un backend configurado puede consumirlo directamente. Para aprovisionar una instancia nueva consulta [datos y migraciones](DATOS-E-INTEGRACIONES.md).

```sh
npm ci
npm run dev
```

Vite usa el puerto 5173 de forma predeterminada. Puedes iniciar sesión con una cuenta de prueba o usar la demo. La demo web inicia una sesión anónima en Supabase y prepara datos de ese usuario. La demo local de la compilación Debug de iPhone usa fixtures en el dispositivo. El enlace web `/login?demo=1&lang=en` permite probar la demo en inglés. Para revisar la PWA generada, ejecuta `npm run build` y después `npm run preview`. El servidor de Vite desarrolla los archivos del frontend. Las funciones bajo `/api` pertenecen al despliegue Vercel. [Login](../src/pages/Login.jsx), [selector de idioma de demo](../src/lib/demo.js) y [configuración de Vite](../vite.config.js).

## Navegación y responsabilidades

| Desde dónde | Qué ocurre |
| --- | --- |
| [index.html](../index.html), [main.jsx](../src/main.jsx) | Arrancan tema y aplicación. El punto de entrada monta React, BrowserRouter y ErrorBoundary. Inicializa Sentry en producción si existe DSN y registra el service worker. |
| [App.jsx](../src/App.jsx) | Resuelve sesión y preferencias. Protege las rutas, conserva el destino al ir a login y compone la navegación. Hoy se abre en `/`. Alimentos, Recetas, Objetivos, Dashboard y Medidas tienen rutas propias. Los módulos secundarios se cargan por demanda y se precargan en reposo después de autenticar. |
| [Menú de sección](../src/lib/sectionMenu.js) y [menú de cuenta](../src/components/UserMenu.jsx) | La página publica sus acciones en «Más opciones». La cuenta agrupa perfil, región, configuración y contraseña. La navegación compacta y la barra lateral ofrecen los mismos destinos con diferentes ubicaciones. |
| [Consentimiento](../src/pages/OAuthConsent.jsx), [landing pública](../public/about/index.html) | El consentimiento OAuth del conector usa `/oauth/consent` como pantalla dedicada. La landing en `/about` es estática y tiene su propia exclusión en el fallback de Workbox. Las reglas de entrada y discovery viven en [vercel.json](../vercel.json). |
| [supabase.js](../src/lib/supabase.js), [domain.js](../src/lib/domain.js) | El primero configura el cliente del esquema `nutri`. El segundo reúne unidades, micronutrientes, objetivos, cobertura y cálculos. Las páginas usan tablas, vistas y RPC con la identidad autenticada. El contrato externo se explica en [Datos e integraciones](DATOS-E-INTEGRACIONES.md). |

## Interfaz, idioma y entrada de datos

- En móvil, la barra inferior reúne los seis destinos y el **+** de la sección. Al desplazarte hacia el final quedan la pestaña activa y la acción sobre el contenido, con un degradado translúcido inferior. Toca la pestaña activa para expandir la navegación sin mover la página. En escritorio la acción aparece en la barra lateral. [Navegación](../src/App.jsx) · [Acciones de sección](../src/lib/sectionMenu.js)

- Conserva los tokens de tema en [index.css](../src/index.css) y [tailwind.config.js](../tailwind.config.js). Comprueba ancho de 375 px, escritorio, temas claro/oscuro, foco visible, navegación por teclado y reducción de movimiento en el flujo afectado. El menú de cuenta permite elegir tema de sistema. [Gestión del tema](../src/lib/theme.js).
- La cadena española sirve de clave de traducción. Las preferencias de idioma y unidades se recuperan por cuenta. La fecha del diario es local. Convierte las cantidades en el límite del formulario para que cambiar la unidad de presentación conserve los gramos almacenados. [Idioma y unidades](../src/lib/i18n.js), [selector de fecha](../src/lib/datePicker.js) y [campo de cantidad](../src/components/AmountField.jsx).
- Una tarjeta táctil puede abrir un editor, moverse verticalmente con la pantalla y aceptar un deslizamiento horizontal de borrado. Comprueba cada intención con una fila propia y otra protegida cuando aplique. En formularios revisa teclado adecuado al dato, cierre de la hoja, confirmación y deshacer. El [gesto web](../src/components/SwipeToDelete.jsx), la [hoja](../src/components/Sheet.jsx), la [confirmación](../src/components/ConfirmSheet.jsx) y el [aviso de deshacer](../src/components/UndoToast.jsx) son los puntos compartidos.
- El importador separa lectura de CSV, validación, resolución de alimento y escritura. Al cambiar columnas o separador decimal, verifica la plantilla, las filas válidas e inválidas, los mensajes y el resultado guardado. [Analizador](../src/lib/importer.js), [hoja de importación](../src/components/ImportSheet.jsx) y [pruebas](../src/lib/importer.test.js).

## Tres diagnósticos distintos cuando la web parece atrasada

| Síntoma | Recorrido de diagnóstico |
| --- | --- |
| Sigue apareciendo la interfaz de la versión anterior | Verifica el despliegue de Vercel y el service worker. Se comprueba al volver, reconectar, iniciar sesión y cada hora en una sesión larga. Cuando el nuevo worker toma el control, un cliente ya controlado recarga una vez. [main.jsx](../src/main.jsx) y [manifest y Workbox](../vite.config.js). |
| Un alimento modificado en otro dispositivo tarda en aparecer | La caché permite pintar el último catálogo y la consulta de Alimentos lo actualiza. Con la vista abierta comprueba regreso al primer plano, reconexión y refresco a los 30 s en línea. Verifica alta, cambio y borrado propios con dos sesiones de prueba y conserva la búsqueda activa. [Foods.jsx](../src/pages/Foods.jsx), [catálogo](../src/lib/catalog.js) y [caché](../src/lib/cache.js). |
| Una comida ya aparece en Hoy pero otro dispositivo aún no la recibe | Hoy proyecta operaciones pendientes sobre las filas remotas. La cola de `entries` persiste localmente y distingue al propietario. El UUID del cliente y el orden de las operaciones permiten reproducir un alta, una edición o un borrado tras recuperar la red. Contrasta el indicador de pendientes y una lectura posterior del servidor. Antes de limpiar datos del navegador, comprueba si quedan escrituras locales. [Cola y envío](../src/lib/outbox.js), [pruebas de la cola](../src/lib/outbox.test.js) y [Hoy](../src/pages/Today.jsx). |

La caché web conserva en almacenamiento local catálogo, metadatos admitidos, etiquetas, objetivos, frecuentes y entradas del día actual. Otros resultados pueden permanecer en memoria. Al cerrar sesión se limpia la caché. La cola de entradas tiene un ciclo propio. Operaciones como guardar una receta o reemplazar una fase dependen de su operación remota.

## Cómo comprobar y publicar

Desde la raíz, este es el mismo núcleo de validación que utiliza el [workflow web](../.github/workflows/ci.yml).

```sh
npm run lint
npm test
npm run build
```

Cuando un cambio toca el dominio, contrasta SQL, JavaScript y Swift con los [oráculos y pruebas nativos](NATIVO.md). Para cambios de extracción, consulta la [guía de evals](../evals/README.md) antes de usar proveedores reales. Para capturas o seeds revisa el [manual de scripts](../scripts/README.md) y elige una cuenta de prueba. En el navegador reproduce el gesto completo además de comprobar el valor final.

El push a `main` despliega en Vercel. Comprueba el estado de CI y del despliegue asociado al commit. El build publica `native-contract.json` junto al frontend. Una modificación compartida puede requerir distribuir otro binario para que el usuario reciba el cambio en macOS o iPhone. [Huella del contrato](../scripts/native-contract.mjs), [desarrollo nativo](NATIVO.md) y [manual de la beta](../ios/README.md).
