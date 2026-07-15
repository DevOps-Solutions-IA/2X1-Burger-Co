# Phase 2.4 - Auditoria de recovery

## Resultado inicial

Los scripts historicos permiten `pg_dump` y restore manual, pero no constituyen evidencia de recovery: el cifrado era opcional, no habia reconciliacion logica, RTO/RPO observado, arranque sobre restore ni teardown aislado. Phase 2.4 introduce un drill separado y fail-closed; no sustituye todavia un servicio offsite.

| Activo | Criticidad | Backup previo | Restore previo | RPO | RTO | Riesgo | Accion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL | CRITICAL | Script manual | Validacion manual destructiva con gate | No definido | No medido | Recuperacion no demostrada | Drill cifrado en dos DB efimeras |
| Ventas/pagos/caja | CRITICAL | Incluido en dump | No reconciliado | No definido | No medido | Riesgo financiero | Sumas y checksums logicos |
| Ordenes/Delivery | CRITICAL | Incluido en dump | No reconciliado | No definido | No medido | Cuenta vigente inconsistente | Conteos, total y checksum |
| Stock | CRITICAL | Incluido en dump | No reconciliado | No definido | No medido | Stock incorrecto | Total y checksum de movimientos |
| Usuarios/RBAC | HIGH | Incluido en dump | No verificado | No definido | No medido | Acceso bloqueado o excesivo | Login y rutas read-only post-restore |
| Auditoria | HIGH | Incluido en dump | No verificado | No definido | No medido | Perdida de trazabilidad | Conteo y checksum logico |
| Sofia interna | HIGH | Incluido en dump | No verificado | No definido | No medido | Mezcla de estados | Conteos y status read-only |
| Sesion WhatsApp | HIGH | Persistencia separada | Sin drill | No definido | No medido | Secreto operativo | Excluida; custodia owner requerida |
| PDFs | REGENERABLE | No formal | Renderer deterministico | N/A | N/A | Reimpresion | Regenerar desde datos persistidos |
| Build/API/web | REGENERABLE | Imagen local por digest | Rollback Phase 2.1 | N/A | Medido en 2.1 | Registry externo ausente | Artifact trazable; owner gate remoto |
| Configuracion | HIGH | Fuera del dump | No automatizada | No definido | No medido | Config drift | Secret store y manifest owner gate |

## Clasificacion

- CRITICAL: PostgreSQL, ventas, pagos, caja, ordenes y stock.
- HIGH: usuarios/RBAC, auditoria, configuracion y custodia de sesion.
- MEDIUM: evidencia y reportes sanitizados.
- REGENERABLE: PDFs, builds y SBOM desde source/manifest.
- EPHEMERAL: redes, contenedores, puertos, claves sinteticas y DB del drill.

