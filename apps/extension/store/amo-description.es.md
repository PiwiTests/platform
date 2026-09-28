Esta traducción al español es un borrador: todavía no la ha revisado ningún hablante nativo. Si ves un error o una frase poco natural, [sugiere una corrección](https://github.com/PiwiTests/platform/issues/new?template=translation.yml).

Piwi Picker encuentra el locator que hay que usar para cualquier elemento de la página que estás viendo. Cada candidato se clasifica según su estabilidad y luego se cuenta en la página tal como está, para que el primero coincida exactamente con un solo elemento. La extensión también convierte un recorrido que haces clic a clic, en varias páginas, en una prueba de Playwright lista para ejecutarse.

**Las herramientas, directamente en la página**

- **Elegir un elemento**: los locators clasificados de un elemento, comprobados en la página, para copiarlos solos, como línea de acción o como aserción.
- **Inspeccionar**: el mejor locator del elemento que está bajo el puntero.
- **Consola**: escribe un locator y mira lo que encuentra en este momento, con el veredicto del modo estricto.
- **Multiselección**: el patrón común a las filas o las tarjetas de una lista.
- **Revisión**: los elementos difíciles de localizar en una prueba, cada uno con un data-testid sugerido.
- **Aserciones**: líneas expect(...) para un elemento.
- **Sesión**: elementos a los que pones nombre en varias páginas, exportados como page object, tabla Markdown o JSON.
- **Contexto para IA**: un bloque que describe un elemento, para dárselo a un agente de código.
- **Grabar acciones**: clics, textos escritos y opciones elegidas en las páginas de un sitio, convertidos en una prueba de TypeScript. Las contraseñas nunca se graban.

**Privado de forma predeterminada**

Elegir elementos y grabar nunca usan la red. No se recopila ni se envía nada.

**Opcional: conectar tu propia instancia de Piwi**

Piwi es un panel de control autoalojado para los resultados de las pruebas de Playwright. Una vez conectada la extensión a tu instancia (su URL y una clave de API, en la configuración), se añaden tres herramientas: grabaciones que llaman a tus propias funciones de prueba, **Funciones de prueba**, que indica cuáles funcionan en la página, y **Elementos probados**, que resalta los elementos que alcanzan tus pruebas. La extensión lee tu instancia y solo le envía una cosa: un informe de bug, cuando haces clic en Enviar en la vista previa que muestra exactamente lo que se envía.

**Permisos**

- La pestaña que estás viendo, solo cuando haces clic en el botón de la extensión o usas el atajo de teclado.
- Un solo sitio, que se pide cuando empiezas a grabar en él, para seguir tus acciones de una página a otra. No se concede nada al instalar la extensión.
- La dirección de tu instancia de Piwi, que se pide cuando guardas una conexión.

Documentación (en inglés): [piwitests.dev/features/extension](https://piwitests.dev/features/extension)

Piwi no está afiliado a Microsoft Corporation, ni cuenta con su aprobación o respaldo. Playwright es una marca comercial de Microsoft Corporation.
