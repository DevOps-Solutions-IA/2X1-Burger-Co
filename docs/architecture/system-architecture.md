# Arquitectura general del sistema

## Stack recomendado

### Frontend
- Next.js 15
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- React Hook Form + Zod

### Backend
- NestJS
- TypeScript
- Prisma ORM
- REST API modular
- Validación fuerte con DTOs y Zod donde aplique

### Base de datos
- PostgreSQL

### Autenticación
- JWT con refresh tokens
- Roles y permisos por módulo

### Infraestructura
- VPS Linux Ubuntu
- Docker
- Docker Compose
- Nginx como reverse proxy
- SSL con Let’s Encrypt
- CI/CD con GitHub Actions

### Reportes
- Generación de PDF para cierre diario imprimible
- Exportación CSV/Excel para reportes administrativos

### Observabilidad
- Logs estructurados
- Manejo de errores centralizado
- Health checks
- Monitoreo básico de aplicación y base de datos

### Testing
- Unit tests
- Integration tests
- E2E tests para flujos críticos

## Por qué este stack

Esta combinación resuelve muy bien lo que necesita el producto:
- Web app responsiva, usable en PC, tablet y celular
- Escalable para más productos, más usuarios y más sedes
- Mantenible porque frontend y backend quedan bien separados
- Segura por control de roles, auditoría y validaciones
- Desplegable en VPS con URL pública
- Lista para crecer hacia domicilios, multi-sede, facturación, promociones y dashboard

## Arquitectura general del sistema

### 1. Capa de presentación
Interfaz moderna para:
- Caja / ventas rápidas
- Inventario
- Compras
- Gastos
- Cierre diario
- Reportes
- Administración

### 2. Capa de API
Servicios de negocio para:
- autenticación
- usuarios
- productos
- insumos
- inventario
- ventas
- compras
- gastos
- caja
- reportes
- auditoría

### 3. Capa de persistencia
PostgreSQL con:
- tablas normalizadas
- índices
- trazabilidad
- historial de movimientos

### 4. Capa de infraestructura
- Docker para app y base de datos
- Nginx para dominio y HTTPS
- backups programados
- variables de entorno
- pipeline de despliegue

## Enfoque funcional del producto

El sistema debe manejar dos grandes tipos de inventario:

### A. Productos de venta directa
Ejemplos:
- Hamburguesa 2x1
- Gaseosa
- Agua
- Papas
- Combos

### B. Insumos / materia prima
Ejemplos:
- Pan
- Carne
- Queso
- Lechuga
- Tomate
- Salsas
- Empaques
- Servilletas
- Bolsas
- Gas

Las hamburguesas se manejan con recetas.
Las gaseosas y aguas se manejan como producto terminado con stock directo.

## Módulos completos del sistema

### 1. Autenticación y usuarios
Debe incluir:
- login
- logout
- recuperación de acceso
- gestión de usuarios
- roles
- permisos por módulo
- sesión segura

Roles iniciales:
- administrador
- cajero
- inventario
- supervisor

### 2. Configuración del negocio
Debe permitir definir:
- nombre del negocio
- logo
- teléfono
- dirección
- moneda
- formato de impresión
- métodos de pago
- parámetros de cierre
- stock mínimo por defecto

### 3. Categorías
Para organizar:
- hamburguesas
- bebidas
- aguas
- combos
- insumos
- empaques
- adiciones

### 4. Productos
Debe permitir:
- crear
- editar
- activar/desactivar
- clasificar
- definir precio
- definir costo
- indicar si maneja inventario
- indicar si es producto terminado o insumo
- subir imagen opcional

Campos clave:
- código
- nombre
- categoría
- precio de venta
- costo base
- tipo
- stock actual
- stock mínimo
- unidad de medida
- estado

### 5. Insumos
Debe permitir cargar y administrar:
- pan
- carne
- queso
- verduras
- salsas
- empaques
- servilletas
- bolsas
- gas

Campos:
- código
- nombre
- unidad
- costo
- stock
- stock mínimo
- proveedor
- observaciones

### 6. Recetas
Para productos fabricados, como hamburguesas.

Ejemplo:
Hamburguesa 2x1:
- 2 panes
- 2 carnes
- 2 quesos
- verduras
- salsas
- 1 empaque

El sistema debe:
- descontar inventario al vender
- calcular costo estimado del producto
- impedir venta si faltan insumos críticos

### 7. Inventario
Debe soportar:
- inventario inicial
- entradas
- salidas
- ajustes
- mermas
- daños
- consumo por ventas
- historial tipo kardex

Tipos de movimiento:
- compra
- venta
- ajuste manual
- merma
- daño
- devolución
- uso interno

### 8. Compras
Debe registrar:
- proveedor
- fecha
- ítems comprados
- cantidades
- costo unitario
- total
- método de pago
- soporte o factura opcional

Debe actualizar inventario automáticamente.

### 9. Proveedores
Debe guardar:
- nombre
- teléfono
- dirección
- productos suministrados
- observaciones
- estado

### 10. Ventas / POS
Debe permitir:
- venta rápida
- carrito
- múltiples productos en una venta
- cantidades
- observaciones
- método de pago
- descuento si más adelante aplica
- comprobante
- actualización automática de caja e inventario

Métodos de pago:
- efectivo
- Nequi
- Daviplata
- transferencia
- tarjeta

### 11. Caja
Debe soportar:
- apertura de caja
- caja inicial
- ingresos
- egresos
- arqueo
- cierre
- diferencia entre caja esperada y real

### 12. Gastos
Debe registrar gastos operativos como:
- gas
- transporte
- arriendo
- nómina
- bolsas
- servilletas
- mantenimiento
- servicios
- caja menor

Carbón queda excluido del sistema.

### 13. Ingresos y egresos
Para registrar movimientos no cubiertos por ventas o compras estándar:
- otros ingresos
- retiros de caja
- ajustes administrativos
- devoluciones

### 14. Apertura diaria
Debe guardar:
- fecha
- responsable
- caja inicial
- observaciones

### 15. Cierre diario
Debe calcular:
- ventas totales
- ventas por producto
- ventas por método de pago
- compras del día
- gastos del día
- ingresos y egresos adicionales
- costo de ventas
- utilidad bruta
- utilidad neta
- caja esperada
- caja real
- diferencia
- inventario final

### 16. Reporte imprimible
Debe generar PDF con:
- datos del negocio
- fecha
- responsable
- resumen de ventas
- resumen de gastos
- resumen de compras
- resumen de caja
- utilidad
- firma

### 17. Reportes administrativos
Debe incluir:
- diario
- semanal
- mensual
- por rango de fechas
- ventas
- inventario
- compras
- gastos
- utilidad
- productos más vendidos
- movimientos de caja

### 18. Alertas
Debe alertar:
- stock bajo
- diferencias de caja
- productos por agotarse
- inconsistencias de inventario

### 19. Auditoría
Debe registrar:
- quién creó, editó o eliminó
- fecha y hora
- cambios críticos
- cierres y reaperturas
- ajustes de inventario
- reversos

## Reglas de negocio obligatorias
- Toda venta afecta inventario y caja.
- Toda compra afecta inventario.
- Todo gasto afecta el cierre diario.
- No se puede vender sin stock suficiente.
- Las hamburguesas descuentan receta.
- Las gaseosas y aguas descuentan stock directo.
- El cierre diario debe quedar bloqueado luego de confirmar, salvo permiso de administrador.
- Debe existir historial por fecha, usuario y movimiento.
- Debe haber reporte imprimible del cierre.
- Todo valor monetario debe manejarse en COP.
- Debe existir trazabilidad de ajustes manuales.
- El sistema debe ser responsive.
- Debe permitir operar desde navegador mediante URL pública.
