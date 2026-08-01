# Web internal healthcheck remediation

## Root cause

The web and API run in separate containers. The prior web healthcheck attempted `localhost:3001`, which addressed the web container itself rather than the API dependency. Docker Compose defines the API service as `api`, listening internally on port `3000`.

## Control

- Required runtime variable: `INTERNAL_API_URL`
- Production value: `http://api:3000`
- Startup rejects missing, malformed, credential-bearing, path-bearing, or loopback URLs.
- Healthcheck requests `/health/ready` with a three-second timeout and fails closed on API outage.
- External Nginx routing is unchanged.

## Evidence

The isolated canary and production candidate both used the API image digest `sha256:6170f65e9a0a1ebe7bd18ba418f7dbe07b68d0cfdbefd2b2da651c47f43f218c` and web image digest `sha256:d5c0348fa23715ee4d37ae6e2bcdc12a5f218ff609a09ffd729c2444e56e510a`.

In both environments API, web, and database became healthy. Production web resolved `api:3000`, remained healthy over multiple health cycles, recorded no failed health entries, and retained `restart=0`.
