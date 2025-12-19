# Guia completa del proyecto

## 1. Resumen del producto
Aplicacion web de fichaje y gestion multi-tenant para empresas, con PWA y multi-dominio por subdominio. Backend en Node.js/Express, base de datos PostgreSQL via Sequelize, despliegue con PM2 y Caddy detras de Cloudflare. Incluye roles (superadmin, admin de empresa), configuracion de metodos de fichaje (QR/GPS), horarios, logs de fichajes y configuracion por empresa.

## 2. Arquitectura
- Frontend PWA estatico en `public/` servido por Express.
- Backend API REST en `server.js` con middlewares multi-tenant y seguridad basica.
- ORM: Sequelize (`database/models/index.js`) con modelos `Company`, `User`, `Log`, `Schedule` (`horarios`), `Config`, `PlatformAdmin`.
- DB: PostgreSQL (`fichadb`, usuario `fichauser`).
- Proxy y TLS: Cloudflare (proxied, Full strict) -> Caddy con certificado Origin -> Node en HTTPS interno (self-signed), proxy con `tls_insecure_skip_verify`.
- Ejecucion: PM2 (`agendaloya`) con `DATABASE_URL` en env y `ecosystem.config.js`.
- Puertos: Caddy 80/443; Node interno 3000 HTTPS (cert self-signed `CN=localhost`).
- IP publica actual: `84.235.227.69` (apuntada en registros A @ y * en Cloudflare).
- Dominio principal: `agendaloya.es` con wildcard `*.agendaloya.es`.
- Almacen local: `uploads/` para posibles ficheros; `ssl/` contiene cert self-signed usado por Node interno (no exponer).

## 3. Estructura de carpetas
- `server.js`: entrada del servidor, define Express, sync de modelos, seeds basicos y rutas API.
- `database/models/index.js`: conexion Sequelize, definicion de modelos y asociaciones.
- `database/db.js`: legado SQLite (no usar en prod; mantener por referencia).
- `public/`: frontend PWA y Service Worker (`sw.js`, `service-worker.js`), HTMLs (`index.html`, `register.html`, `superadmin.html`, `admin-functions.js`).
- `scripts/bootstrap-db.js` (si existe): semilla de datos demo (superadmin, empresa demo, admin demo, config).
- `uploads/`: carpeta de ficheros subidos (asegurar permisos y evitar listado).
- `ssl/`: certificados internos (self-signed) para Node local.
- `package.json`: dependencias (Express, Sequelize, pg); `sqlite3` como optional para dev.

## 4. Modelos y datos
- `Company`: id, name, subdomain, active.
- `User`: id, company_id, username, password hash, role (admin/user), indices unicos por empresa.
- `PlatformAdmin`: superadmins globales (gestion de empresas).
- `Config`: configuracion por empresa (metodo_fichaje, etc.).
- `Schedule` (`horarios`): horarios por empresa/usuario.
- `Log`: fichajes con timestamps, usuario y empresa.
Indices: unico `(company_id, username)` en users; filtrado siempre por `company_id` y subdomain.

## 5. Multi-tenant (subdominios y headers)
- Cada empresa se identifica por subdominio (`pepe.agendaloya.es`).
- El frontend (patch de fetch) envia header `x-company-subdomain` resuelto por host o query `?company=`; tambien persiste en cookie `company`.
- El backend valida empresa activa por subdominio/header antes de operar; rutas sensibles requieren empresa valida.

## 6. Seguridad basica
- TLS: Cloudflare proxied + Caddy con Origin Cert (Full strict). Caddy hace proxy a Node en HTTPS interno con `tls_insecure_skip_verify`.
- HSTS via Cloudflare. PWA usa Service Worker; limpiar cache en cambios.
- Headers en Express: `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` ya incluidos; se recomienda agregar `helmet`.
- Cookies `HttpOnly; Secure; SameSite=Lax` para `company`.
- Rate-limit y captcha no implementados: añadir en produccion para login/API.

## 7. Flujo de despliegue (desde cero)
1) **DNS Cloudflare**: Registros `A @` y `A *` a la IP publica `84.235.227.69`, proxied (naranja). SSL/TLS modo **Full (strict)**. Wildcard cubre todos los subdominios.
2) **Certificado Origin**: Crear en Cloudflare (agendaloya.es, *.agendaloya.es), guardar en servidor: `/etc/caddy/ssl/cloudflare-origin.pem` y `.key` (propietario caddy, 600/644).
3) **Caddyfile** `/etc/caddy/Caddyfile`:
   ```
   agendaloya.es, *.agendaloya.es {
       tls /etc/caddy/ssl/cloudflare-origin.pem /etc/caddy/ssl/cloudflare-origin.key
       reverse_proxy https://127.0.0.1:3000 {
           transport http {
               tls_insecure_skip_verify
           }
       }
   }
   ```
   Recargar: `sudo caddy reload --config /etc/caddy/Caddyfile`.
4) **PostgreSQL**: crear DB y usuario
   ```
   sudo -u postgres psql -c "CREATE USER fichauser WITH PASSWORD 'TU_PASS';"
   sudo -u postgres psql -c "CREATE DATABASE fichadb OWNER fichauser;"
   ```
5) **Env y PM2**:
   - `export DATABASE_URL="postgres://fichauser:TU_PASS@localhost:5432/fichadb"`
   - `pm2 start server.js --name agendaloya --update-env`
   - `pm2 save`
   - En `ecosystem.config.js` definir `env.DATABASE_URL` igual para persistencia.
6) **Semilla** (si usas script): `node scripts/bootstrap-db.js` para crear superadmin, empresa demo, admin demo, config.
7) **Probar**:
   - `curl -vk "https://127.0.0.1:3000/api/company/status?company=demo"` -> 200 found:true.
   - `curl -I https://demo.agendaloya.es` (desde servidor y externo) -> 200/301 sin error.
8) **DNS local servidor**: asegurar `resolv.conf` usa 1.1.1.1/8.8.8.8 (netplan nameservers) para que resuelva wildcard.

## 8. Operacion diaria
- PM2: `pm2 logs agendaloya --lines 100`, `pm2 restart agendaloya --update-env`, `pm2 save`.
- Backups: `pg_dump -Fc fichadb > /backups/fichadb-$(date +%F).dump` (cifrar y rotar).
- Monitoreo: vigilar errores 5xx, espacio en disco, RAM/CPU, certificados.
- Limpieza SW/cache tras despliegues frontend: en navegador DevTools -> Application -> Service Workers -> Unregister + Clear storage.

## 9. Frontend (public/)
- `index.html`: login y panel; fetch global añade header `x-company-subdomain`; usa localStorage para company; gestiona errores en UI.
- `register.html`: alta de usuarios/empresas (segun rol).
- `superadmin.html`: gestion de empresas (crear, activar, asignar subdomain) y admins globales.
- `admin-functions.js`: funciones de UI/Admin; peticiones van a `/api/...` con header de empresa.
- `sw.js` y `service-worker.js`: cache de PWA; actualizar version tras cambios.

## 10. APIs clave (server.js)
- `GET /api/company/status?company=subdomain` verifica existencia/activo.
- `GET /api/config` y `POST /api/config` por empresa (metodo_fichaje, etc.).
- `POST /api/login` (rol admin/user dentro de empresa); `POST /api/superadmin/login`.
- `POST /api/users`, `POST /api/schedules`, `POST /api/log` etc., siempre filtrando por empresa.
- Middleware: parsea header `x-company-subdomain` o query `company`, setea cookie `company` y valida empresa activa.

## 11. Seguridad y compliance recomendada
- Añadir `helmet` y `cors` restringido a tus dominios.
- Rate limiting en login y rutas sensibles; bloqueo tras intentos.
- Politica de privacidad y TOS visibles en la app; banner de cookies si no son estrictamente necesarias.
- DPA con clientes; listar subencargados; plan de respuesta a incidentes; backups cifrados y testeados.
- Separar entornos (dev/stage/prod) y DBs; no mezclar datos reales en dev.

## 12. Como rehacer desde cero (paso rapido)
1) Clonar repo en servidor. `npm install`.
2) Crear DB y usuario en Postgres (ver seccion 7).
3) Definir `DATABASE_URL` y lanzar `pm2 start server.js --name agendaloya --update-env; pm2 save`.
4) Configurar Caddy + Origin cert (seccion 7) y DNS Cloudflare wildcard.
5) Sembrar datos demo (opcional) con `node scripts/bootstrap-db.js`.
6) Probar con curl local y via dominio.
7) Limpiar SW/cache en navegadores y probar login/admin/config en `https://demo.agendaloya.es/?company=demo`.

## 13. Notas de mantenimiento
- Si cambia la password de Postgres, actualizar `DATABASE_URL` y `pm2 restart --update-env; pm2 save`.
- Si se cambia a HTTP interno, ajustar `reverse_proxy http://127.0.0.1:3000` y Cloudflare a Full (no strict) o poner cert valido interno.
- Rotar certificados Origin antes de caducar; Cloudflare gestiona edge cert.
- Actualizar dependencias con cuidado; hacer backup previo y pruebas.

## 14. Contacto y soporte interno
- Superadmin por defecto (post-seed): usuario `superadmin`, pass `123456` (cambiar en produccion).
- Admin demo (post-seed): empresa `demo`, admin `admin` / `123456`.
- Documentar credenciales reales de clientes en un gestor seguro, nunca en texto plano.

## 15. Valores operativos actuales (documentar y rotar en prod)
- Dominio: `agendaloya.es` y wildcard `*.agendaloya.es` (Cloudflare proxied, Full strict).
- IP publica: `84.235.227.69` (registros A @ y * en naranja).
- DB Postgres: host `localhost`, puerto `5432`, base `fichadb`, usuario `fichauser`, password actual `bielemma` (cambiar en prod). URL en PM2: `postgres://fichauser:bielemma@localhost:5432/fichadb`.
- PM2: proceso `agendaloya`, `pm2 save` ya hecho; `ecosystem.config.js` debe tener `env.DATABASE_URL` con la URL anterior.
- Node interno: puerto 3000 HTTPS con cert self-signed en `ssl/` (CN=localhost). Caddy proxy con `tls_insecure_skip_verify`.
- Caddy Origin Cert (Cloudflare): rutas `/etc/caddy/ssl/cloudflare-origin.pem` y `/etc/caddy/ssl/cloudflare-origin.key`, propietario `caddy`, permisos 644/600.
- DNS del servidor: forzado a 1.1.1.1 y 8.8.8.8 en netplan/resolv.conf.
- Seeds conocidas: superadmin `superadmin/123456`; empresa demo `demo`; admin demo `admin/123456`; empresa `pepe` activa (`pepe.agendaloya.es`).
- Puertos abiertos: 80/443 (Caddy) expuestos; 3000 solo local; Postgres 5432 local.

### Cloudflare API (opcional para eliminar/crear registros DNS)
- Si en tu flujo creas registros individuales en Cloudflare (por ejemplo, no usas wildcard proxied), puedes automatizar la creación/eliminación con la API.
- Variables de entorno necesarias (añade en el entorno de PM2 / `ecosystem.config.js`):
   - `CF_API_TOKEN`: Token con permisos `Zone.DNS:Edit` para la zona.
   - `CF_ZONE_ID`: ID de la zona (puedes obtenerlo desde el panel -> Overview).
   - `CREATE_DNS=1` (opcional): activar creación automática al registrar empresa si lo implementas.
- El servidor ya incluye una función `deleteCloudflareDNSRecords(subdomain)` que se ejecuta al eliminar la empresa; solo funciona si `CF_API_TOKEN` y `CF_ZONE_ID` están definidos.

Nota: Si usas wildcard `*` en Cloudflare (apuntando a la IP), no hace falta crear/eliminar registros por empresa; la app usa el subdominio internamente y Caddy + Cloudflare resuelven el tráfico.

## 16. Referencias rapidas de archivos clave
- `/etc/caddy/Caddyfile`: proxy y TLS edge->origin.
- `/etc/caddy/ssl/cloudflare-origin.pem|key`: certificado de origen Cloudflare.
- `/etc/resolv.conf` y `/etc/netplan/50-cloud-init.yaml`: DNS (1.1.1.1, 8.8.8.8) para que resuelva wildcard.
- `ecosystem.config.js`: env `DATABASE_URL` y nombre del proceso PM2.
- `ssl/`: cert self-signed de Node (solo interno).
- `database/models/index.js`: conexion Sequelize y modelos.
- `public/index.html`: patch fetch con header `x-company-subdomain` y almacenamiento de `company`.
- `server.js`: rutas API, middleware multi-tenant, seeds iniciales.

## 17. Acciones de recuperacion rapidas
- Si aparece `28P01`: ajustar password en Postgres y en `DATABASE_URL`, luego `pm2 restart agendaloya --update-env; pm2 save`.
- Si un subdominio no resuelve: comprobar `nslookup sub.agendaloya.es 1.1.1.1`; si en server falla, revisar DNS en netplan/resolv.conf.
- Si Caddy falla: `journalctl -xeu caddy.service`; revisar permisos del origin cert y sintaxis del Caddyfile; recargar con `sudo caddy reload --config /etc/caddy/Caddyfile`.
- Si frontend cachea viejo: en navegador DevTools -> Application -> Service Workers -> Unregister + Clear storage; recargar forzado.
