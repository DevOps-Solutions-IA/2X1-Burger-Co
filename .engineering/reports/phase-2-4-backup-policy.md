# Politica de backup y restore

Estado: propuesta implementable localmente; adopcion productiva requiere aprobacion owner.

| Control | Politica propuesta | Implementacion local | Owner gate |
| --- | --- | --- | --- |
| Full | Diario | `pg_dump` custom/compression 9 | Scheduler productivo |
| Incremental/WAL | Continuo para RPO menor | No implementado | Storage y PostgreSQL WAL archive |
| Retencion local | 7 diarios | Drill elimina datos al terminar | Volumen privado |
| Retencion offsite | 30 diarios + 12 mensuales | No disponible | Proveedor y presupuesto |
| Cifrado | Obligatorio antes de custodia | AES-256-CBC PBKDF2 | KMS/secret store |
| Integridad | SHA-256 y `pg_restore --list` | Demostrado | Firma/attestation |
| Permisos | Owner-only `0600/0700` | Demostrado | Cuenta de servicio dedicada |
| Restore test | Mensual y tras cambio de schema | Automatizado local | Job remoto y calendario |
| Alertas | Backup/restore fallido | Evaluacion local | Canal real y owner on-call |
| Destruccion | Expiracion y borrado controlado | Material efimero eliminado | Politica legal/retencion |

## Procedimiento seguro

1. Verificar marcador, host, puerto y nombre de DB de test.
2. Crear dump custom sin ownership ni privilegios.
3. Validar catalogo, checksum y permisos.
4. Cifrar con clave fuera del archivo y del repositorio.
5. Restaurar siempre primero en DB vacia aislada.
6. Comparar schema, conteos, sumas e invariantes logicos.
7. Arrancar artifact identificado y ejecutar smoke read-only.
8. Conservar solo metadata sanitizada y destruir material efimero.

No se autoriza restore sobre una DB operativa desde este procedimiento.
