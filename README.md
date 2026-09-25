# GB Studio

Un espacio de trabajo visual de GB Films con dos secciones: Storyboards para organizar tomas y Reviews para corregir fotos y videos.

## Reviews

- Para revisar un archivo ya guardado en Dropbox, compartí **ese archivo** y pegá su enlace en «Vincular desde Dropbox». Reviews conserva el enlace y reproduce el original; no lo sube ni crea otra copia. Dropbox recomienda `raw=1` para mostrar directamente el contenido de un enlace compartido, y la app lo aplica al reproducir. También se puede abrir el enlace original desde el visor.
- La vista directa sin conexión OAuth requiere un enlace accesible para cualquiera que lo tenga, sin contraseña ni restricción de equipo. Quien obtenga ese enlace podrá abrir el archivo en Dropbox. Si la política de la productora exige enlaces privados, hará falta una integración autenticada de Dropbox; esta modalidad por enlace no evita sus permisos ni garantiza que todos los formatos de video se reproduzcan en el navegador.
- En Reviews solo se pueden vincular archivos ya compartidos en Dropbox: no hay carga local ni arrastrar archivos desde el equipo. Cada archivo tiene sus propios comentarios. Los archivos locales creados en versiones anteriores siguen disponibles para no perder trabajo, pero ya no se pueden agregar nuevos.
- Reviews abre en un tablero de proyectos. Cada proyecto tiene título, cliente, agencia y director; al crearlo se abre una primera review de montaje y después podés crear otras independientes para VFX, cliente o cualquier etapa. Cada review mantiene separados sus archivos y comentarios. Los proyectos y reviews se pueden renombrar o eliminar, y los archivos se pueden quitar. Las eliminaciones usan confirmaciones diseñadas dentro de la app, no ventanas del navegador.
- Los archivos y comentarios de Reviews creados antes de esta organización se conservan automáticamente en el proyecto «Reviews anteriores», dentro de «Review original».
- Podés vincular un `.fbx` compartido en Dropbox para previsualizarlo en 3D cuando Dropbox permita leerlo desde el navegador; un enlace que bloquee CORS no podrá abrirse en el visor. Los FBX locales heredados siguen disponibles. Las texturas externas pueden requerir sus archivos aparte.
- Dentro de cada review podés crear secciones (por ejemplo, «Última versión») y arrastrar archivos entre ellas o reordenarlos. Quitar una sección mueve su contenido a «Sin clasificar», sin borrar archivos ni comentarios.
- En video, cada comentario queda asociado al segundo actual y aparece como marca en la línea de tiempo. Hacer clic en un comentario vuelve a ese momento.
- Dibujá sobre el cuadro antes de publicar un comentario. El trazo se guarda con ese comentario y se muestra al seleccionarlo; el archivo original no se modifica.
- «Dibujo temporal» permite marcar la imagen sin guardar esos trazos con el comentario. «Limpiar» los quita.
- Scroll hace zoom; `Z` + clic con mouse o lápiz acerca, y `Z` + arrastre vertical ajusta el zoom de forma continua. `H` vuelve a encuadrar. `F` alterna pantalla completa y `Q` oculta/muestra los controles.
- Los botones y atajos `I`/`O` marcan un rango de reproducción, sin recortar ni modificar el archivo original. La regla puede alternar entre tiempo y fotogramas. En modo fotogramas, cada 8 px de arrastre avanza un cuadro estimado; también podés escribir un número de frame o usar los botones ±1F. La numeración usa el FPS seleccionado y permite comenzar en 1001. `←`/`→` avanzan o retroceden un fotograma estimado, `↑`/`↓` saltan entre tiempos de comentarios, `Inicio`/`Fin` van a los extremos del video. En videos de FPS variable o con límites del decodificador del navegador, el cuadro efectivamente mostrado puede no coincidir exactamente con el número calculado.
- «Captura PNG» descarga el cuadro visible con la anotación superpuesta cuando el navegador permite leer los píxeles del archivo. Enlaces externos de Dropbox normalmente no habilitan esa lectura por CORS: en ese caso la app muestra un aviso y no promete una captura inexistente. «Descargar MP4» ofrece el original únicamente cuando el archivo ya es MP4; no convierte ni recorta otros formatos.
- «Copiar enlace de vista» crea una URL de esta app con el enlace compartido de Dropbox. Al abrirla, el video se muestra sin iniciar sesión y Google se solicita recién para comentar. Por ahora ese enlace es largo y los comentarios **no se sincronizan entre personas**: quedan en el navegador de quien los escribió. Se necesita una base compartida con reglas de acceso y un dominio configurado para enlaces cortos como `gb-films.com/archivo-x`.
- Podés resolver, reabrir o eliminar comentarios, y eliminar un archivo con todos sus comentarios.
- Esta primera versión guarda la organización, los enlaces y comentarios en IndexedDB, dentro del navegador y el perfil donde se cargaron. Los archivos vinculados a Dropbox **no** se copian allí; solo permanecen los archivos locales heredados. No hay sincronización de reviews o comentarios entre computadoras todavía. Para video, usá un formato compatible con el navegador (por ejemplo, MP4/H.264 o WebM).

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

La app está conectada al proyecto Firebase `GB Studio` (`gb-studio-260bc`) mediante `firebase-config.js`. La configuración web de Firebase contiene identificadores públicos; la seguridad del acceso depende de Authentication y sus reglas. El acceso es obligatorio para abrir Storyboards y editar Reviews. Una URL de vista de Dropbox puede reproducir el archivo sin login porque ese enlace ya debe permitir acceso a cualquiera que lo tenga; los comentarios siguen locales, no están protegidos ni compartidos por Firebase.

Para completar la activación en Firebase:

1. Abrí `Authentication` → `Sign-in method`.
2. Habilitá el proveedor `Google` y elegí el correo de asistencia del proyecto.
3. En los dominios autorizados, verificá que figure `gb-films.github.io`.

Después, el botón `Iniciar sesión` de la cabecera abre el acceso con Google y muestra el perfil autenticado. Si el proveedor todavía no está habilitado, la app conserva el modo local y muestra un aviso.
