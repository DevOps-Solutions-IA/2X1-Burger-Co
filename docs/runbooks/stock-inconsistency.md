# Stock inconsistency

- Severidad: CRITICAL.
- Sintomas: stock agregado o movimientos no reconcilian.
- Diagnostico: congelar ajustes automaticos; comparar movimientos, ventas y recetas read-only.
- Prohibido: corregir valores directamente sin auditoria y owner approval.
- Recovery: restaurar o aplicar ajuste autorizado, idempotente y auditado.
- Validacion: invariantes, checksums y reporte de diferencias.
- Escalamiento: Inventory owner, Finance y Database owner.
- Evidencia: IDs en repositorio privado, nunca datos personales.
