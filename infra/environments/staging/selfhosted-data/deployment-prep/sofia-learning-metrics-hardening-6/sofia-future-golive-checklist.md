# Checklist futuro de go-live Sofia

No ejecutar go-live mientras la rotacion externa siga pendiente o mientras QR/DeepSeek/envio real no hayan pasado pruebas internas controladas.

## Seguridad
- [ ] Rotacion externa completada.
- [ ] `.env` local actualizado fuera del repositorio.
- [ ] Secretos antiguos revocados en proveedores.
- [ ] No hay secretos en frontend.
- [ ] No hay secretos en reportes/logs.
- [ ] Session storage QR ignorado por git.

## QR WhatsApp
- [ ] QR fisico CONNECTED.
- [ ] Inbound real allowlist probado.
- [ ] Deduplicacion inbound real validada.
- [ ] Test send bloqueado antes de habilitar envio.
- [ ] Envio real probado solo con numero interno.
- [ ] Kill-switch probado durante sesion conectada.

## DeepSeek
- [ ] API key nueva configurada solo por env.
- [ ] DeepSeek backend-only.
- [ ] Fallback a reglas probado.
- [ ] Prompt maestro activo validado.
- [ ] SafetyGuard bloquea invenciones.

## Auto Safe
- [ ] Auto Safe PASS para casos seguros.
- [ ] HUMAN_REQUIRED para baja confianza.
- [ ] BLOCKED para PAID/invenciones/Maxi Family incorrecto.
- [ ] Auto Safe production solo habilitado con aprobacion explicita.
- [ ] Envio automatico probado primero con numero interno.

## Pagos
- [ ] WhatsApp no puede marcar PAID.
- [ ] Nequi manual sigue verificacion humana/POS/Domicilios.
- [ ] Links `/pagos/[token]` siguen funcionando.
- [ ] Pagos online/webhooks regression PASS.

## Operacion
- [ ] POS regression PASS.
- [ ] Domicilios regression PASS.
- [ ] Checkout/Caja regression PASS.
- [ ] Stock protegido.
- [ ] Pedidos no se operan desde `/sofia`.

## Datos y observabilidad
- [ ] Retention dry-run revisado.
- [ ] Backup sanitizado dry-run revisado.
- [ ] Alertas visibles y ack probado.
- [ ] Metricas operativas disponibles.
- [ ] Feedback humano disponible.
- [ ] Exports sanitizados revisados.

## Responsabilidad y rollback
- [ ] Responsable humano definido.
- [ ] Horario piloto definido.
- [ ] Allowlist inicial definida fuera del repo.
- [ ] Rollback documentado.
- [ ] Pausa global probada.
- [ ] Desconexion QR probada.

## Decision
- [ ] Go-live aprobado por responsable tecnico.
- [ ] Go-live aprobado por responsable operativo.
- [ ] Go-live aprobado por seguridad.
