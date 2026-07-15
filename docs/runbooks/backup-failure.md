# Backup failure

- Severidad: HIGH; CRITICAL al superar RPO aprobado.
- Diagnostico: revisar exit code, espacio, permisos, checksum y catalogo sin abrir dump.
- Accion: conservar ultimo backup valido; ejecutar nuevo backup en destino seguro.
- Prohibido: declarar exito solo por archivo existente.
- Validacion: checksum, `pg_restore --list` y restore drill.
- Escalamiento: Infrastructure y Database owner.
- Evidencia: metadata sanitizada, tamaño, hash, tiempo y causa.

