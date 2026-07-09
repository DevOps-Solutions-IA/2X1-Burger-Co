# AUDIT-7B Rollback Plan

Fecha: [PHONE_REDACTED]

Este plan aplica para un cutover Blue/Green futuro. AUDIT-7B no hizo cutover ni cambio DNS.

## 1. Restaurar nginx V1

Ruta productiva:

```bash
cd /opt/2x1burger
cp infra/nginx/generated/default.conf.audit7c-before-cutover.bak infra/nginx/generated/default.conf
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Si el contenedor nginx no permite reload:

```bash
cd /opt/2x1burger
docker compose up -d --no-deps nginx
```

Validacion:

```bash
curl -k -I https://2x1burger.co/login
curl -k -I https://2x1burger.co/pos
curl -k -I https://2x1burger.co/cash
curl -k https://2x1burger.co/api/health
docker compose ps
```

## 2. Volver al upstream V1

Upstreams V1 esperados:

```nginx
proxy_pass http://api:3000/;
proxy_pass http://web:3001/;
```

Upstreams V2 propuestos para cutover futuro:

```nginx
proxy_pass http://api-v2:3000/;
proxy_pass http://web-v2:3001/;
```

Rollback de upstream:

```bash
cd /opt/2x1burger
sed -i 's/http:\\/\\/api-v2:3000/http:\\/\\/api:3000/g' infra/nginx/generated/default.conf
sed -i 's/http:\\/\\/web-v2:3001/http:\\/\\/web:3001/g' infra/nginx/generated/default.conf
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

## 3. Detener V2

Si V2 fue levantado con el compose propuesto:

```bash
cd /opt/2x1burger-v2
docker compose --env-file .env.production.v2 -f docker-compose.v2.yml stop web-v2 api-v2
```

No borrar volumenes durante rollback inmediato. Mantener `postgres_v2_data` para analisis post-incidente.

## 4. Restaurar DB desde backup V1

Backup V1 no cifrado de AUDIT-7A:

```bash
/opt/2x1burger/backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump
```

Backup cifrado de AUDIT-7B:

```bash
/opt/2x1burger/backups/backup-inventory_fastfood_system-[PHONE_REDACTED].dump.gpg
```

Copia local cifrada:

```bash
backups/audit7b-production-v1/backup-inventory_fastfood_system-[PHONE_REDACTED].dump.gpg
```

Restore desde backup no cifrado AUDIT-7A:

```bash
cd /opt/2x1burger
FORCE_RESTORE=true ./infra/scripts/restore.sh backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump
```

Restore manual desde backup cifrado AUDIT-7B:

```bash
# En una maquina con la clave privada GPG:
GNUPGHOME=/home/wundah/.gnupg-2x1burger-backup-audit7b \
  gpg --output /tmp/2x1burger-restore.dump --decrypt backup-inventory_fastfood_system-[PHONE_REDACTED].dump.gpg

# Copiar /tmp/2x1burger-restore.dump al servidor y restaurar:
cd /opt/2x1burger
docker compose cp /tmp/2x1burger-restore.dump postgres:/tmp/2x1burger-restore.dump
docker compose exec postgres pg_restore -U postgres -d inventory_fastfood_system \
  --clean --if-exists --no-owner --no-privileges /tmp/2x1burger-restore.dump
```

## 5. Tiempo estimado

- Rollback nginx/upstream: 1 a 3 minutos.
- Detener V2 sin borrar volumenes: menos de 1 minuto.
- Restore DB desde dump actual: 5 a 15 minutos, segun tamano real del backup al momento del corte.

## 6. Riesgos

- Si el cutover incluyo migraciones destructivas, el rollback requiere restore DB.
- Si WhatsApp auth cambia en V2, no borrar `whatsapp_auth` V1.
- No ejecutar `docker compose down -v`.
- No eliminar volumenes `2x1burger_postgres_data` ni `2x1burger_whatsapp_auth`.

## 7. Senales que activan rollback

- `/api/health` no responde 200.
- `/login`, `/pos`, `/cash` o `/waiter/login` no responden 200.
- Login admin falla con credenciales validas.
- Caja no carga operacion completa.
- POS no carga productos/comandas.
- Errores 5xx sostenidos en nginx o API.
- Diferencias de caja, ventas o inventario no explicadas.
