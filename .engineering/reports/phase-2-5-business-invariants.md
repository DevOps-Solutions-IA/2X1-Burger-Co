# Phase 2.5 - Invariantes operativas

Fecha: 2026-07-14

## Principio de validacion

Cada mutacion critica se considera valida solo cuando concuerdan respuesta API, persistencia, auditoria, caja, stock, totales y documento aplicable. La UI aporta evidencia del trigger y del estado; no reemplaza la reconciliacion de datos.

## Caja

| ID | Invariante | Evidencia medible | Fallo critico |
| --- | --- | --- | --- |
| CASH-01 | Existe como maximo una caja `OPEN`. | Conteo DB antes/despues y respuesta de segundo open. | Dos cajas abiertas. |
| CASH-02 | Cierre conserva `expectedAmount`, `closingAmount` y diferencia consistentes con el resumen. | API summary + fila `cash_sessions` + movimientos. | Arqueo distinto a los movimientos. |
| CASH-03 | Reopen crea una nueva sesion enlazada a la cerrada y deja auditoria. | `reopenedFromSessionId`, actor, motivo y audit log. | Mutacion silenciosa o reapertura doble. |
| CASH-04 | Retry de close/reopen no duplica movimientos ni sesiones. | Fingerprint y conteos antes/despues del retry. | Doble ingreso o doble reapertura. |
| CASH-05 | Roles no autorizados reciben 403 y no hay cambios DB. | Respuesta API y fingerprint. | Bypass RBAC. |

## POS / ventas

| ID | Invariante | Evidencia medible | Fallo critico |
| --- | --- | --- | --- |
| POS-01 | Una venta aceptada crea una venta, sus items/pagos y un efecto de stock/caja coherente. | Transaccion API + reconciliacion de tablas y sumas. | Side effect parcial. |
| POS-02 | El total deriva de precios persistidos y descuentos autorizados; input arbitrario no redefine precios. | Payload, fila de venta, items y catalogo. | Total manipulable. |
| POS-03 | El receipt corresponde a la venta y leer/reimprimir no cambia venta, caja ni stock. | Hash PDF, texto extraido y fingerprint DB. | Reprint mutante o documento incorrecto. |
| POS-04 | Convertir una venta pagada revierte exactamente una vez caja/stock y crea una comanda. | Venta cancelada, conversion unica, movimientos compensatorios y orden. | Doble reversa o perdida de datos. |
| POS-05 | Reabrir la comanda restaura exactamente una vez la composicion comercial. | Estados, stock, caja, auditoria y retry rechazado. | Doble aplicacion. |
| POS-06 | Stock insuficiente revierte toda la operacion. | Error API y fingerprint sin diferencias. | Venta parcial o stock negativo. |

## Delivery

| ID | Invariante | Evidencia medible | Fallo critico |
| --- | --- | --- | --- |
| DEL-01 | `deliveryFee` se persiste y forma parte del total vigente. | Orden, items y PDF. | Total ambiguo o fee perdido. |
| DEL-02 | Cada cambio comercial real incrementa revision/version una sola vez. | `revision`, receipt status/history y auditoria. | Version duplicada o stale write aceptado. |
| DEL-03 | Cambiar productos conserva el fee persistido salvo cambio explicito autorizado. | Snapshot antes/despues. | Repricing accidental. |
| DEL-04 | Ubicacion es logistics-only: no cambia fee, subtotal, breakdown ni revision comercial. | Snapshot exacto y audit event. | Repricing o receipt nuevo. |
| DEL-05 | La cuenta vigente muestra version, estado, subtotal productos, tarifa y total. | PDF del endpoint real, texto y PNG. | Receipt POS o total no explicado. |
| DEL-06 | `expectedRevision` evita lost updates concurrentes. | Una actualizacion aceptada y una stale rechazada. | Dos versiones para la misma revision. |
| DEL-07 | Maxy/Maxi Family se valida contra la regla persistida sin modificar catalogo. | Producto/regla encontrada y resultado existente. | Regla inventada o alterada. |

## Inventario

| ID | Invariante | Evidencia medible | Fallo critico |
| --- | --- | --- | --- |
| INV-01 | Compra recibida incrementa stock y crea movimiento con origen. | Compra, item, movimiento y saldo. | Stock sin trazabilidad. |
| INV-02 | Venta consume producto directo o receta segun configuracion. | Stock/ingredientes y movimientos. | Consumo incorrecto. |
| INV-03 | Ajuste/conteo fija saldo coherente y registra actor/motivo. | Fila stock, movimiento y stock count. | Ajuste silencioso. |
| INV-04 | Operacion fallida no deja stock ni movimientos parciales. | Fingerprint antes/despues. | Side effect parcial. |
| INV-05 | Mutaciones concurrentes preservan saldo y no producen stock negativo no autorizado. | Respuestas, locks y reconciliacion. | Lost update o saldo invalido. |

## Auditoria, seguridad y trazabilidad

| ID | Invariante | Evidencia medible | Estado inicial |
| --- | --- | --- | --- |
| AUD-01 | Operaciones sensibles registran actor, modulo, entidad, before/after o contexto equivalente y resultado. | `audit_logs` y logs estructurados. | Requiere prueba. |
| AUD-02 | No se registran secretos ni PII completa en evidencia. | Secret/PII scan sanitizado. | Obligatorio. |
| AUD-03 | `requestId`/`correlationId` se propagan en HTTP/logs. | Headers y logs. | Disponible en observabilidad Phase 2.4; DB audit no lo modela universalmente. |
| AUD-04 | Idempotencia persistente existe donde el contrato la promete. | Unique key/revision/registro persistido. | Parcial; debe medirse por flujo. |

## Criterio de decision

No se marcara GO global si hay doble caja, doble ingreso, stock negativo no autorizado, recovery no reversible, version Delivery duplicada, RBAC bypass, PDF incorrecto o contaminacion de DB. Las capacidades no existentes se reportaran como bloqueadores, no se simularan.

