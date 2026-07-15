# Secret exposure

- Severidad: CRITICAL.
- Accion inmediata: limitar acceso, preservar hash/ruta sanitizada y revocar/rotar.
- Diagnostico: identificar alcance sin volver a imprimir el valor.
- Recovery: eliminar artefacto contaminado, invalidar sesiones y reconstruir artifact limpio.
- Validacion: secret scan, history review y prueba de credencial anterior revocada.
- Escalamiento: Security owner y proveedor afectado.
- Evidencia: tipo, hash parcial, ruta sanitizada, acciones y tiempos.
