# Database restore

- Severidad: CRITICAL.
- Precondicion: aprobacion owner, destino vacio y aislado, backup cifrado con checksum valido.
- Diagnostico: confirmar schema compatibility y release manifest.
- Accion: descifrar fuera del repo, validar SHA-256, ejecutar `pg_restore --exit-on-error` sin owner/privileges.
- Reconciliar: schema, conteos, sumas financieras, stock y checksums logicos.
- Arranque: API/web con el artifact identificado; ejecutar health, login y smokes read-only.
- Rollback: conservar destino anterior; no sobrescribir hasta aprobacion.
- Cierre: registrar RPO/RTO y destruir material temporal.

