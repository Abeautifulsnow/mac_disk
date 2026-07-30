

# mac-disk-scanner

**Una herramienta profesional de análisis y limpieza de espacio en disco para macOS, desarrollada con Tauri, Rust y React**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightblue.svg)](macos)
[![Rust](https://img.shields.io/badge/Rust-1.76+-orange.svg)](https://rust-lang.org)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://reactjs.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-purple.svg)](https://tauri.app)

Una aplicación de escritorio de alto rendimiento para macOS que te ayuda a identificar y gestionar archivos y directorios que consumen espacio. Desarrollada con tecnologías web modernas y el rendimiento nativo de Rust.

## ✨ Características Principales

### 🔍 **Escaneo Inteligente de Disco**
- **Análisis Recursivo de Directorios**: Escanea a profundidad cualquier directorio para encontrar archivos y carpetas grandes
- **Seguimiento de Progreso en Tiempo Real**: Actualizaciones en vivo con tiempo estimado restante (ETA)
- **Rendimiento Optimizado**: Recorrido de transmisión de un solo paso con retención acotada de los top-K y reutilización eficiente de metadatos
- **Estado de Escaneo Progresivo**: Los eventos de progreso muestran las fases de descubrimiento y procesamiento, y las vistas previas de coincidencias aparecen durante el escaneo antes de que se confirmen los resultados finales

### ⚡ **Filtrado Inteligente**
- **Umbral de Tamaño**: Establece un tamaño mínimo de archivo para filtrar elementos pequeños
- **Límites de Resultados**: Controla la cantidad de resultados mostrados
- **Protección contra Tiempos de Espera**: Evita escaneos prolongados con tiempos de espera configurables
- **Control de Profundidad**: Limitación automática de profundidad para la protección del sistema

### 🛡️ **Funciones de Seguridad**
- **Protección de Directorios del Sistema**: Bloquea automáticamente la eliminación de directorios críticos del sistema macOS (`/system`, `/library`, `/usr`, etc.)
- **Diálogos de Confirmación**: Todas las eliminaciones requieren confirmación explícita del usuario
- **Validación de Rutas**: El backend valida todas las rutas de archivos antes de las operaciones
- **Manejo de Errores**: Informes de errores exhaustivos con mensajes amigables para el usuario

### 💻 **UI/UX Moderna**
- **Interfaz Limpia**: Hermosa interfaz de React + Tailwind CSS
- **Listas de Altura Fija**: Tablas de resultados desplazables con encabezados fijos
- **Información de Tipo**: Se muestran tipos de archivo y fechas de modificación
- **Controles de Acción**: Botones de eliminación rápida con retroalimentación visual
- **Estadísticas de Escaneo Claras**: Separa el tamaño total escaneado, la cantidad de elementos coincidentes y la cantidad de resultados mostrados

## 📐 Contrato de Datos

El contrato de resultados del escaneo utiliza campos de tamaño explícitos en Rust y TypeScript:

- `sizeLogical`: tamaño lógico del contenido del archivo desde `metadata.len()`
- `sizeDisk`: uso en disco desde `metadata.blocks() * 512`, con fallback al tamaño lógico cuando los datos de bloques no están disponibles
- `totalSizeLogical` / `totalSizeDisk`: bytes totales escaneados para la raíz solicitada
- `filesFound` / `directoriesFound`: elementos coincidentes antes de la truncación de visualización
- `resultCount`: número de elementos devueltos al frontend para su visualización

## 🛠️ Stack Tecnológico

### **Frontend**
- **React 18** con TypeScript
- **Vite** para desarrollo y compilación rápidos
- **Tailwind CSS** para estilos
- **Lucide React** para iconos

### **Backend**
- **Rust** para rendimiento nativo
- **Tauri 2.0** como framework de escritorio
- **Walkdir** para recorrido de directorios
- **Lru** para almacenamiento en caché
- **Tokio** para operaciones asíncronas

### **Desarrollo**
- **pnpm** para gestión de paquetes
- **TypeScript** para seguridad de tipos
- **ES Modules** para JavaScript moderno

## 📊 Características de Rendimiento

El escáner incluye optimizaciones de rendimiento sofisticadas:

1. **Recorrido por Transmisión**: Procesa cada entrada de `WalkDir` una vez en lugar de almacenar en búfer todo el árbol antes de calcular los tamaños
2. **Retención Acotada de Archivos**: Cuando se establece `limit`, solo se conservan en memoria los archivos coincidentes actuales del top-K
3. **Lectura Eficiente de Metadatos**: Una sola lectura de metadatos por archivo, evitando llamadas duplicadas
4. **Agregación Incremental de Directorios**: Los tamaños de los directorios padres se acumulan durante el recorrido
5. **Registro de Progreso**: Los registros de depuración y eventos de progreso rastrean el recorrido y la generación de resultados finales
6. **Métricas de Rendimiento**: Tiempos detallados para lecturas de metadatos, agregación y ordenamiento

## 🚀 Desarrollo

### **Configuración**
```bash
pnpm install
```

### **Modo de Desarrollo**
```bash
pnpm tauri dev
```

### **Compilación**
```bash
pnpm tauri build
```

## 📁 Estructura del Proyecto

```
mac_disk/
├── src/                    # Frontend de React
│   ├── App.tsx            # Aplicación principal
│   ├── components/        # Componentes de React
│   │   ├── Scanner.tsx    # Interfaz de escaneo
│   │   ├── FileList.tsx   # Visualización de resultados
│   │   └── ConfirmDialog.tsx # Confirmación de eliminación
│   └── types.ts          # Definiciones de TypeScript
├── src-tauri/             # Backend de Rust
│   ├── src/
│   │   ├── lib.rs        # Configuración de Tauri
│   │   ├── commands.rs   # Manejadores de comandos
│   │   └── scanner.rs    # Lógica central de escaneo
│   └── Cargo.toml        # Dependencias de Rust
```

## 🎯 Casos de Uso

- **Limpieza de Disco**: Identifica los archivos más grandes que ocupan espacio
- **Mantenimiento del Sistema**: Monitorea los patrones de uso del disco
- **Desarrollo**: Encuentra archivos temporales y artefactos de compilación
- **Planificación de Backups**: Comprende la distribución de datos antes de realizar copias de seguridad
- **Solución de Problemas**: Diagnostica problemas de espacio en disco

## 🔒 Seguridad

- **Validación de Rutas**: Todas las rutas se validan antes de las operaciones con archivos
- **Protección del Sistema**: Los directorios críticos de macOS están protegidos
- **Confirmación del Usuario**: Las eliminaciones requieren aprobación explícita
- **Manejo de Errores**: Fallos controlados con mensajes informativos

## 💡 Mejoras Futuras

- Visualización en tiempo real del porcentaje de progreso
- Funcionalidad de cancelación para escaneos prolongados
- Visualización incremental de resultados durante el escaneo
- Mecanismo de caché para directorios de acceso frecuente
- Exportación de resultados a CSV/JSON
- Estadísticas y gráficos por tipo de archivo
- Capacidades de ordenamiento y filtrado

## 📝 Licencia

Licencia MIT - siéntete libre de usarla y modificarla para tus proyectos.

---

**Desarrollado con ❤️ usando Tauri, Rust y React para macOS**

Esta descripción proporciona una visión general completa que destaca las características principales, el stack tecnológico, las consideraciones de seguridad y los aspectos de desarrollo del proyecto mac-disk-scanner. Es adecuada para su uso como descripción de un repositorio de GitHub, archivo README o introducción a la documentación del proyecto.
