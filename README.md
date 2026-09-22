# GB Studio

Un espacio de trabajo visual de GB Films para organizar storyboards y, progresivamente, sumar herramientas de preproducción como shot lists y planes de rodaje.

## Funciones

- Biblioteca lateral para cargar todas las fotos del proyecto.
- Artboards 16:9, 9:16 y 1:1.
- Arrastrar fotos desde la biblioteca al artboard, sin definir una cantidad por página.
- Distribución automática que compara filas según las proporciones reales de las fotos y el formato del canvas.
- Agregar, quitar y duplicar fotos recalcula la composición, con márgenes seguros y sin huecos reservados.
- Reordenar fotos arrastrándolas; se conserva la secuencia de lectura de izquierda a derecha y de arriba hacia abajo.
- Arrastrar una foto fuera del canvas la elimina directamente del storyboard.
- Alt + arrastrar una miniatura de la barra de páginas duplica esa página con sus fotos y datos.
- La opción `Completa` respeta siempre la orientación y proporción original de la foto.
- Encuadre `Recortar` opcional, con punto focal configurable.
- Agregar pendientes incorpora las fotos de la biblioteca aún no usadas, sin reemplazar las tomas editadas.
- Las páginas adicionales se crean cuando el usuario quiere separar la secuencia; no hay un cupo de fotos por hoja.
- La información debajo de la foto puede mostrarse con recuadro blanco y texto negro o con recuadro negro y texto blanco. La información superpuesta conserva su estilo negro translúcido.
- Páginas múltiples, guardado local e importación/exportación del proyecto.
- Exportar la hoja como PNG/JPG o imprimir todas las páginas a PDF.

## Uso local

Abrí `index.html` en el navegador. No requiere instalación ni servidor.

## Verificación

`node --test tests/*.test.cjs` comprueba márgenes, proporciones, orden y ausencia de superposiciones en los tres formatos.

## Acceso con Google

La app está conectada al proyecto Firebase `GB Studio` (`gb-studio-260bc`) mediante `firebase-config.js`. La configuración web de Firebase contiene identificadores públicos; la seguridad del acceso depende de Authentication y sus reglas.

Para completar la activación en Firebase:

1. Abrí `Authentication` → `Sign-in method`.
2. Habilitá el proveedor `Google` y elegí el correo de asistencia del proyecto.
3. En los dominios autorizados, verificá que figure `gb-films.github.io`.

Después, el botón `Iniciar sesión` de la cabecera abre el acceso con Google y muestra el perfil autenticado. Si el proveedor todavía no está habilitado, la app conserva el modo local y muestra un aviso.
