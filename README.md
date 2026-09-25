# GB Studio

Un espacio de trabajo visual de GB Films con dos secciones: Storyboards para organizar tomas y Reviews para corregir fotos y videos.

## Reviews

- Para revisar un archivo ya guardado en Dropbox, compartí **ese archivo** y pegá su enlace en «Vincular desde Dropbox». Reviews conserva el enlace y reproduce el original; no lo sube ni crea otra copia. Dropbox recomienda `raw=1` para mostrar directamente el contenido de un enlace compartido, y la app lo aplica al reproducir. También se puede abrir el enlace original desde el visor.
- La vista directa sin conexión OAuth requiere un enlace accesible para cualquiera que lo tenga, sin contraseña ni restricción de equipo. Quien obtenga ese enlace podrá abrir el archivo en Dropbox. Si la política de la productora exige enlaces privados, hará falta una integración autenticada de Dropbox; esta modalidad por enlace no evita sus permisos ni garantiza que todos los formatos de video se reproduzcan en el navegador.
- Cargá una foto o un video desde la sección Reviews; cada archivo tiene sus propios comentarios.
- En video, cada comentario queda asociado al segundo actual y aparece como marca en la línea de tiempo. Hacer clic en un comentario vuelve a ese momento.
- Dibujá sobre el cuadro antes de publicar un comentario. El trazo se guarda con ese comentario y se muestra al seleccionarlo; el archivo original no se modifica.
- Podés resolver, reabrir o eliminar comentarios, y eliminar un archivo con todos sus comentarios.
- Esta primera versión guarda la lista, los enlaces y comentarios en IndexedDB, dentro del navegador y el perfil donde se cargaron. Los archivos cargados desde el equipo también se guardan ahí; los vinculados a Dropbox **no**. No hay sincronización de reviews o comentarios entre computadoras todavía. La capacidad local depende del espacio disponible en el navegador. Para video, usá un formato compatible con el navegador (por ejemplo, MP4/H.264 o WebM).

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
- Alta de proyectos con título y cliente obligatorios, más agencia y director opcionales. La identidad de productora queda fija como GRAN BERTA FILMS y puede ocultarse en el artboard.
- Archivo de proyectos ordenable por última modificación, título o cliente.
- Versiones agrupadas dentro de cada proyecto para crear alternativas horizontales, verticales o cuadradas.
- Exportar la hoja como PNG/JPG o imprimir todas las páginas a PDF.

## Uso local

Abrí `index.html` en el navegador. No requiere instalación ni servidor.

## Verificación

`node --test tests/*.test.cjs` comprueba márgenes, proporciones, orden y ausencia de superposiciones en los tres formatos.

## Acceso con Google

La app está conectada al proyecto Firebase `GB Studio` (`gb-studio-260bc`) mediante `firebase-config.js`. La configuración web de Firebase contiene identificadores públicos; la seguridad del acceso depende de Authentication y sus reglas. El acceso es obligatorio: la interfaz y los proyectos quedan bloqueados hasta completar el inicio de sesión con Google.

Para completar la activación en Firebase:

1. Abrí `Authentication` → `Sign-in method`.
2. Habilitá el proveedor `Google` y elegí el correo de asistencia del proyecto.
3. En los dominios autorizados, verificá que figure `gb-films.github.io`.

Después, el botón `Iniciar sesión` de la cabecera abre el acceso con Google y muestra el perfil autenticado. Si el proveedor todavía no está habilitado, la app conserva el modo local y muestra un aviso.
