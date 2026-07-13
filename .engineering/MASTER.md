# Engineering Master

## Proposito

Este framework gobierna la auditoria, priorizacion, implementacion y validacion tecnica del sistema. Su funcion es mantener una fuente documental comun para decisiones de ingenieria sin sustituir el codigo, las pruebas, el runtime ni la evidencia operacional.

## Auditoria

Cada modulo comienza en `UNKNOWN`. Una auditoria debe identificar su alcance real, contratos, dependencias, rutas, persistencia, seguridad y comportamiento en runtime. Todo hallazgo debe vincularse a evidencia reproducible antes de proponer una correccion.

## Loops

El trabajo se ejecuta mediante los loops definidos en `LOOPS.md`. Cada loop recibe evidencia del anterior, produce una salida verificable y se repite cuando sus criterios de exito no se cumplen. Ningun loop puede convertir una suposicion en evidencia.

## Reglas enterprise

- Mantener una unica fuente de verdad por contrato.
- Separar diagnostico, cambio y validacion.
- Proteger integridad, seguridad, auditabilidad y operacion.
- Exigir comportamiento determinista e idempotencia cuando aplique.
- Validar fuente, build, integracion, runtime y experiencia operativa segun el alcance.
- Documentar riesgos residuales y rollback antes de cualquier gate productivo.

## Orden de ejecucion

1. Leer `RULES.md` y `GLOBAL_STATUS.md`.
2. Seleccionar una fase de `ROADMAP.md`.
3. Ejecutar los loops en el orden de `LOOPS.md`.
4. Actualizar el archivo del modulo solo con evidencia.
5. Guardar evidencia, checkpoint y reporte.
6. Recalcular el estado global.

## Prioridades

Las prioridades se deciden por impacto operacional, severidad, alcance, probabilidad, exposicion de seguridad, integridad de datos y dependencia de otros modulos. Un riesgo de seguridad o integridad bloquea mejoras cosmeticas.

## Criterio de GO

Un modulo puede declararse GO solamente cuando su alcance esta auditado, sus bloqueadores estan cerrados, los contratos son coherentes, las validaciones aplicables pasan, el runtime coincide con la fuente esperada, existe evidencia y los riesgos residuales han sido aceptados explicitamente. Compilar por si solo no permite GO.
