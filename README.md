# Storyboard Studio

Un espacio de trabajo visual para organizar fotos y armar storyboards como si fuera un artboard.

## Funciones

- Biblioteca lateral para cargar todas las fotos del proyecto.
- Artboards 16:9, 9:16 y 1:1.
- Arrastrar fotos desde la biblioteca al artboard, sin definir una cantidad por página.
- Distribución automática que compara filas según las proporciones reales de las fotos y el formato del canvas.
- Agregar, quitar y duplicar fotos recalcula la composición, con márgenes seguros y sin huecos reservados.
- Reordenar fotos arrastrándolas; se conserva la secuencia de lectura de izquierda a derecha y de arriba hacia abajo.
- La opción `Completa` respeta siempre la orientación y proporción original de la foto.
- Encuadre `Recortar` opcional, con punto focal configurable.
- Agregar pendientes incorpora las fotos de la biblioteca aún no usadas, sin reemplazar las tomas editadas.
- Las páginas adicionales se crean cuando el usuario quiere separar la secuencia; no hay un cupo de fotos por hoja.
- Páginas múltiples, guardado local e importación/exportación del proyecto.
- Exportar la hoja como PNG/JPG o imprimir todas las páginas a PDF.

## Uso local

Abrí `index.html` en el navegador. No requiere instalación ni servidor.

## Verificación

`node --test tests/*.test.cjs` comprueba márgenes, proporciones, orden y ausencia de superposiciones en los tres formatos.
