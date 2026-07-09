# Runbook operativo Sofia F6

## 1. Estado actual del sistema
Sofia esta en modo enterprise controlado. El cerebro comercial, Auto Safe, governance, QR receive_only simulado, metricas, feedback, privacidad, retencion, alertas y backup sanitizado dry-run estan disponibles para operacion interna.

Produccion permanece bloqueada porque la rotacion externa de secretos sigue pendiente y no hay validacion fisica QR completa con envio real interno.

## 2. Que esta permitido
- Usar `/sofia` para monitoreo, readiness, metricas, alertas y hardening.
- Usar `/sofia/sandbox` para pruebas simuladas.
- Usar `/sofia/conversations` para revisar conversaciones, reason codes y registrar feedback humano.
- Usar `/sofia/whatsapp-qr` en receive_only/test-inbound.
- Ejecutar exports sanitizados, retention dry-run, alert check y backup sanitizado dry-run.

## 3. Que esta bloqueado
- DeepSeek real.
- Envio real de WhatsApp.
- Auto Safe productivo con clientes.
- Produccion.
- WhatsApp PAID.
- Pagos reales desde WhatsApp.
- Operacion de pedidos desde `/sofia`.
- Cambios automaticos de prompt/catalogo por feedback.

## 4. Como revisar `/sofia`
Entrar a `/sofia` y validar:
- Produccion BLOCKED.
- DeepSeek real disabled.
- Real send false.
- WhatsApp PAID false.
- Metricas, insights, privacy, retention, alerts, backups y hardening visibles.

## 5. Como revisar QR receive_only
Entrar a `/sofia/whatsapp-qr` o usar:
- `GET /admin/sofia/whatsapp/qr/status`
- `POST /admin/sofia/whatsapp/qr/test-inbound`
- `POST /admin/sofia/whatsapp/qr/test-send`

`test-send` debe devolver bloqueo de envio real.

## 6. Como revisar conversations
Entrar a `/sofia/conversations` y validar:
- Mensajes inbound.
- Estado humano/Sofia.
- Reason codes Auto Safe.
- Panel de feedback humano.
- Ningun envio real desde la pantalla.

## 7. Como registrar feedback
Desde `/sofia/conversations`, usar los botones de feedback o llamar:
`POST /admin/sofia/learning/feedback`.

El feedback sirve para insights y revision humana. No modifica prompt, catalogo ni modelo automaticamente.

## 8. Como revisar alertas
Usar:
- `POST /admin/sofia/alerts/check`
- `GET /admin/sofia/alerts`
- `POST /admin/sofia/alerts/:id/ack`

Las alertas son internas. No envian correo, WhatsApp ni notificaciones externas en F6.

## 9. Como hacer export sanitizado
Usar:
`GET /admin/sofia/metrics/export-sanitized?range=today`

Debe devolver datos agregados/sanitizados, sin telefonos completos, secretos, payloads crudos ni mensajes completos.

## 10. Como ejecutar retention dry-run
Usar:
`POST /admin/sofia/retention/dry-run`

Esto calcula candidatos por politica sin borrar datos.

## 11. Como ejecutar backup sanitizado dry-run
Usar:
`POST /admin/sofia/backups/dry-run`

El backup sanitizado excluye `.env`, sesiones QR, secretos, tokens y credenciales de pago.

## 12. Que hacer si QR se desconecta
1. Revisar `/sofia/whatsapp-qr`.
2. Confirmar que real send sigue false.
3. Revisar alertas.
4. Reconectar solo en modo receive_only.
5. No activar auto_safe productivo ni envio real.

## 13. Que hacer si alguien intenta enviar real
1. Verificar alerta `BLOCKED_REAL_SEND_DISABLED`.
2. Confirmar que `realSendingEnabled=false`.
3. Revisar outbox para confirmar que no hay `SENT` real.
4. Mantener produccion BLOCKED.

## 14. Que hacer si llega "ya pague"
1. Confirmar que Auto Safe marque `PAYMENT_SENSITIVE` o equivalente.
2. No marcar PAID desde WhatsApp.
3. Pasar a humano/POS/Domicilios para verificacion.
4. Mantener auditabilidad del caso.

## 15. Que hacer si cliente se queja
1. Confirmar `HUMAN_REQUIRED`.
2. Registrar feedback si la respuesta sugerida fue insuficiente.
3. No responder automaticamente.
4. Operar el caso desde el flujo humano correspondiente.

## 16. Que hacer antes de go-live
Completar la rotacion externa de secretos, validar QR fisico, probar inbound real allowlist, ejecutar regression POS/Domicilios/Pagos/Caja/Stock/Checkout y probar kill-switch.

## 17. Checklist para rotacion externa
- JWT secret.
- Google Maps/OpenRoute si aplica.
- DeepSeek API key si se usara.
- Hermes/WhatsApp legacy si aplica.
- Bold/Nequi/SMTP si aplica.
- Database/Redis si aplica.

## 18. Checklist para F5B futura
- QR fisico CONNECTED.
- Inbound real allowlist recibido.
- Envio real probado solo con numero interno y flag explicito.
- Auto Safe production todavia bloqueado hasta prueba interna.
- PAID sigue bloqueado desde WhatsApp.

## 19. Rollback basico
1. Activar pausa global de Sofia.
2. Desconectar QR.
3. Confirmar real send false.
4. Volver a modo sandbox/receive_only.
5. Revisar alertas y eventos de auditoria.

## 20. Contactos/responsables
- Responsable tecnico: pendiente.
- Responsable operativo: pendiente.
- Responsable seguridad/rotacion: pendiente.
- Responsable go-live: pendiente.
