# Prompt maestro para Codex / IA de desarrollo

Actúa como un equipo multidisciplinario senior de ingeniería de software con experiencia combinada de 10 a 15+ años en arquitectura de software, producto, UX/UI, backend, frontend, DevOps, QA, seguridad y sistemas de inventario para negocios de alimentos.

Tu tarea es diseñar, documentar, desarrollar y dejar listo para despliegue un software web completo, moderno, intuitivo, escalable y seguro para control operativo de un negocio de comidas rápidas. El sistema debe quedar preparado para desplegarse en una VPS Linux y ser accesible por URL desde cualquier dispositivo con navegador.

## Objetivo del producto
Construir un sistema web de inventario, ventas, compras, gastos, caja y reportes para un negocio que vende principalmente:
- Hamburguesa 2x1 por 20.000 COP
- Gaseosas
- Aguas
- Más adelante otros productos como pinchos, chuzos, combos y adicionales

## Reglas fundamentales del negocio
1. Toda venta debe afectar inventario y caja automáticamente.
2. Toda compra debe aumentar inventario.
3. Todo gasto debe afectar el cierre diario.
4. No se puede vender un producto sin stock suficiente.
5. Los productos fabricados como hamburguesas deben manejar receta de insumos.
6. Las gaseosas y aguas deben manejarse como productos terminados con stock directo.
7. Debe existir apertura y cierre diario de caja.
8. El cierre diario debe generar un reporte imprimible en PDF.
9. Debe existir trazabilidad, auditoría y control por roles.
10. Carbón NO se usa en este negocio y debe excluirse del sistema.

## Alcance funcional obligatorio
El sistema debe incluir como mínimo los siguientes módulos:

### 1. Autenticación y usuarios
- login
- logout
- refresh token
- roles
- permisos
- sesiones seguras

### 2. Configuración del negocio
- nombre del negocio
- logo
- teléfono
- dirección
- moneda COP
- métodos de pago
- parámetros generales

### 3. Categorías
- hamburguesas
- bebidas
- aguas
- combos
- insumos
- empaques
- adiciones

### 4. Productos
Debe permitir crear y administrar productos de venta como:
- Hamburguesa 2x1
- Gaseosas
- Aguas
- Papas
- Combos

Cada producto debe tener:
- código
- nombre
- categoría
- precio de venta
- costo
- stock actual
- stock mínimo
- unidad de medida
- estado
- tipo de producto

### 5. Insumos
Debe permitir crear y administrar insumos como:
- pan
- carne
- queso
- verduras
- salsas
- empaques
- servilletas
- bolsas
- gas

### 6. Recetas
Debe permitir asociar insumos a productos fabricados.
Ejemplo para Hamburguesa 2x1:
- 2 panes
- 2 carnes
- 2 quesos
- verduras
- salsas
- 1 empaque

### 7. Inventario
Debe soportar:
- stock inicial
- entradas
- salidas
- ajustes
- mermas
- daños
- historial de movimientos tipo kardex

### 8. Proveedores
CRUD completo.

### 9. Compras
Registro de compras con actualización automática de inventario.

### 10. Ventas / POS
- venta rápida
- múltiples productos
- múltiples métodos de pago
- descuento de inventario
- comprobante

### 11. Caja
- apertura
- caja inicial
- ingresos
- egresos
- arqueo
- cierre
- diferencia entre caja esperada y real

### 12. Gastos
Registrar gastos operativos como gas, transporte, bolsas, servilletas, arriendo, nómina, servicios y mantenimiento.

### 13. Ingresos y egresos adicionales
Registrar otros movimientos administrativos.

### 14. Apertura diaria
Registro formal de inicio de jornada.

### 15. Cierre diario
Calcular automáticamente:
- ventas totales
- ventas por producto
- ventas por método de pago
- compras del día
- gastos del día
- otros ingresos
- otros egresos
- costo de ventas
- utilidad bruta
- utilidad neta
- caja final esperada
- caja final real
- diferencia
- inventario final

### 16. Reporte imprimible
Generar PDF del cierre diario.

### 17. Reportes
- diario
- semanal
- mensual
- rango de fechas
- ventas
- compras
- gastos
- inventario
- utilidad
- productos más vendidos

### 18. Alertas
- stock bajo
- diferencias de caja
- inventario crítico

### 19. Auditoría
Registrar quién hizo qué, cuándo y desde qué módulo.

## Stack técnico obligatorio
Usa esta arquitectura, salvo que identifiques una mejora técnica bien justificada:
- Frontend: Next.js + React + TypeScript + Tailwind + shadcn/ui
- Backend: NestJS + TypeScript
- ORM: Prisma
- Base de datos: PostgreSQL
- Auth: JWT + refresh tokens + RBAC
- Infraestructura: Docker, Docker Compose, Nginx, VPS Ubuntu
- Reportes: PDF para cierre diario
- Testing: unit, integration y E2E
- CI/CD: GitHub Actions

## Requisitos de UX/UI
La UI debe ser:
- moderna
- intuitiva
- rápida
- profesional
- responsive
- fácil de usar para personal operativo no técnico

Crea:
- dashboard administrativo
- módulo de venta rápida con experiencia tipo POS
- formularios claros
- tabla de inventario usable
- cierre diario muy entendible
- modo impresión limpio

## Requisitos de arquitectura
1. Implementa arquitectura modular y limpia.
2. Mantén frontend y backend desacoplados.
3. Usa validaciones estrictas.
4. Maneja errores de forma centralizada.
5. Agrega logs y auditoría.
6. Prepara el sistema para escalar a múltiples sedes en el futuro.
7. Diseña el modelo para soportar más productos y promociones.
8. Usa convenciones consistentes y código mantenible.

## Requisitos de seguridad
- hash seguro de contraseñas
- autorización por roles
- validación de inputs
- rate limit en login
- rutas protegidas
- HTTPS ready
- auditoría
- manejo seguro de secretos

## Entregables esperados
Debes producir, en este orden:

1. Arquitectura técnica completa
2. Estructura de carpetas del proyecto
3. Modelo de datos y esquema Prisma
4. Definición de módulos y casos de uso
5. Endpoints backend
6. Diseño de frontend y navegación
7. Plan de implementación por fases
8. Código completo del proyecto
9. Seed de datos iniciales
10. Dockerización
11. Configuración de Nginx
12. Scripts de despliegue en VPS
13. Tests mínimos para flujos críticos
14. Documentación de instalación y operación
15. Archivo AGENTS.md para guiar futuras iteraciones del repositorio

## Datos iniciales obligatorios
Crear datos semilla con:
- rol administrador
- usuario admin inicial
- categorías base
- producto “Hamburguesa 2x1” con precio 20.000 COP
- bebidas base
- insumos base
- métodos de pago base

## Comportamiento esperado
No entregues una respuesta superficial.
Trabaja como si fueras a construir el producto real para producción.
Toma decisiones coherentes de arquitectura.
Documenta supuestos.
Genera código listo para ejecutar.
Prioriza claridad, escalabilidad, mantenibilidad y experiencia de uso.

## Flujo de trabajo
1. Primero genera la arquitectura y estructura.
2. Luego el esquema de base de datos.
3. Luego backend.
4. Luego frontend.
5. Luego reportes.
6. Luego infraestructura y despliegue.
7. Luego tests y documentación.

## Restricciones
- No usar carbón ni lógica relacionada con carbón.
- El negocio inicia con una sola sede, pero el diseño debe permitir crecer.
- La moneda es COP.
- La app debe funcionar bien en móvil y escritorio.
- Debe ser accesible por URL pública una vez desplegada en VPS.

## Criterios de calidad
El resultado final debe sentirse como un SaaS administrativo profesional para un negocio de alimentos.
No hagas un prototipo incompleto.
Construye una base sólida, limpia y extensible.
