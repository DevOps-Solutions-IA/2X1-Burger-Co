# Production runtime map

| Service | Runtime | Health | Phase 0 action |
| --- | --- | --- | --- |
| PostgreSQL | Docker Compose `postgres` | healthy | Three owner-authorized migrations applied; no restart |
| API | Docker Compose `api`, published port 4300 | HTTP 200 and healthy | No application deployment or restart |
| Web | Docker Compose `web`, published port 3301 | HTTP 200 and healthy | No application deployment or restart |
| Nginx | Docker Compose `nginx`, ports 80/443 | HTTP 200 and healthy | No reload or restart |

Restart counters after migration validation were API 2, web 0, nginx 0, PostgreSQL 0, unchanged from the pre-deploy snapshot. The authorized runtime configuration keeps real sending and SOFIA production disabled, but the principal image was built before the new compile/runtime isolation controls.

