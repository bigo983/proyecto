const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const OpenAI = require('openai');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sequelize, User, Log, Schedule, Config, Company, PlatformAdmin } = require('./database/models');
const { Op } = require('sequelize');

const app = express();
const PORT = 3000;

// Hardening básico
app.disable('x-powered-by');

// Headers de seguridad básicos (HSTS solo en producción)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Importante: en localhost el multi-tenant usa Referer para detectar ?company=
  // (las llamadas fetch no llevan query param). Con no-referrer se rompe el login.
  // same-origin mantiene privacidad sin romper el flujo en el mismo origen.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

function startHttpsServer() {
  // Configuración HTTPS
  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
  };

  const server = https.createServer(sslOptions, app);

  server.on('error', (err) => {
    console.error('Error arrancando servidor HTTPS:', err);
  });

  // Escuchar en IPv6 (dual-stack en la mayoría de sistemas) para evitar que
  // localhost resuelva a ::1 y termine hablando con un servidor HTTP distinto.
  server.listen(PORT, '::', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIP = 'localhost';

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
    }

    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║  🚀 Servidor HTTPS ejecutándose en puerto ${PORT}      ║`);
    console.log(`║  📱 Local: https://localhost:${PORT}                 ║`);
    console.log(`║  🌐 Red:   https://${localIP}:${PORT}          ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
    console.log(`\n✅ La geolocalización funcionará correctamente`);
    console.log(`⚠️  IMPORTANTE: Debes aceptar el certificado en el navegador:\n`);
    console.log(`   1. Abre https://localhost:${PORT}`);
    console.log(`   2. Click en "Avanzado" o "Advanced"`);
    console.log(`   3. Click en "Continuar a localhost" o "Proceed to localhost"\n`);
    console.log(`   📱 En móvil/tablet: Haz lo mismo con https://${localIP}:${PORT}\n`);
  });
}

// Sincronizar base de datos y arrancar servidor (solo HTTPS)
// Nota: En SQLite, el modo alter puede requerir recrear tablas y chocar con FKs.
(async () => {
  try {
    const isSqlite = sequelize.getDialect && sequelize.getDialect() === 'sqlite';
    if (isSqlite) {
      await sequelize.query('PRAGMA foreign_keys = OFF;');

      // Si hubo un sync alter fallido antes, Sequelize puede dejar tablas *_backup
      // que rompen el siguiente intento (UNIQUE constraint). Las limpiamos.
      const [backupTables] = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup';"
      );
      if (Array.isArray(backupTables) && backupTables.length) {
        for (const row of backupTables) {
          if (row && row.name) {
            await sequelize.query(`DROP TABLE IF EXISTS \`${row.name}\`;`);
          }
        }
      }
    }

    await sequelize.sync({ alter: true });

    if (isSqlite) {
      await sequelize.query('PRAGMA foreign_keys = ON;');
    }

    await seedPlatformSuperAdmin();
    startHttpsServer();
  } catch (err) {
    try {
      const isSqlite = sequelize.getDialect && sequelize.getDialect() === 'sqlite';
      if (isSqlite) {
        await sequelize.query('PRAGMA foreign_keys = ON;');
      }
    } catch (_) {
      // noop
    }
    console.error('Error al conectar con la base de datos:', err);
  }
})();

// Secret key para JWT (en producción SIEMPRE por variable de entorno)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-insecure-jwt-secret-change-me') {
  console.warn('⚠️ JWT_SECRET no configurado. Define JWT_SECRET en el entorno.');
}

// --- Platform Super Admin Seeder (NO pertenece a empresas) ---
async function seedPlatformSuperAdmin() {
  try {
    let admin = await PlatformAdmin.findOne({ where: { username: 'superadmin' } });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      admin = await PlatformAdmin.create({
        nombre: 'Super Admin',
        username: 'superadmin',
        password: hashedPassword
      });
      console.log('✅ Platform Super Admin created: superadmin / admin123');
    }

    // Reset opcional de contraseña (solo bajo flag) para recuperar acceso en dev
    const resetFlag = String(process.env.RESET_SUPERADMIN_PASSWORD || '').toLowerCase();
    const shouldReset = resetFlag === '1' || resetFlag === 'true' || resetFlag === 'yes';
    if (shouldReset) {
      admin.password = await bcrypt.hash('admin123', 10);
      await admin.save();
      console.log('🔐 Platform Super Admin password reset: superadmin / admin123');
    }
  } catch (err) {
    console.error('Error seeding Platform Super Admin:', err);
  }
}

// Configurar multer para subir archivos
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.use(cors());
app.use(bodyParser.json());

// === MIDDLEWARE MULTI-TENANCY ===
app.use(async (req, res, next) => {
  // Ignorar assets estáticos y endpoints globales
  if (
    req.path.startsWith('/api/register-company') ||
    req.path.startsWith('/api/superadmin') ||
    req.path.match(/\.(js|css|png|jpg|ico)$/)
  ) {
    return next();
  }

  let subdomain = null;
  const host = req.headers.host;

  // Prioridad 1: Header (útil para testing)
  if (req.headers['x-company-subdomain']) {
    subdomain = req.headers['x-company-subdomain'];
  }
  // Prioridad 1.5: Query Param (muy útil para testing en navegador)
  else if (req.query.company) {
    subdomain = req.query.company;
  }
  // Prioridad 1.8: Referer (para que el frontend funcione sin modificar fetchs en localhost)
  else if (req.headers.referer && req.headers.referer.includes('company=')) {
    const url = new URL(req.headers.referer);
    subdomain = url.searchParams.get('company');
  }
  // Prioridad 2: Subdominio real
  else if (host.includes('.')) {
    const parts = host.split('.');
    if (parts.length > 1 && parts[0] !== 'www' && parts[0] !== 'localhost') {
      subdomain = parts[0];
    }
  }

  // Fallback para localhost (Solo Desarrollo): Usar 'demo' o la primera empresa
  if (!subdomain && (host.includes('localhost') || host.includes('127.0.0.1'))) {
    subdomain = 'demo'; // Asumimos 'demo' para localhost por defecto
  }

  if (subdomain) {
    req.company = await Company.findOne({ where: { subdomain } });
  }

  // Si la empresa está desactivada, bloquea la API (mantén el frontend accesible)
  if (req.company && req.company.active === false && req.path.startsWith('/api/')) {
    // Permitir un mínimo de endpoints para que el frontend pueda reaccionar (ocultar opciones, etc.)
    if (req.path === '/api/company/status') {
      return next();
    }
    return res.status(403).json({ error: 'Empresa desactivada. Contacta con soporte.' });
  }

  // Si no se encuentra empresa y estamos intentando acceder a la API (excepto registro), error
  // Nota: Para servir el frontend (que es estático) permitimos pasar sin req.company,
  // pero los endpoints de API fallarán si no hay company.
  next();
});

// Estado de empresa (según tenancy) para que el frontend pueda ocultar opciones.
app.get('/api/company/status', async (req, res) => {
  try {
    if (!req.company) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json({
      id: req.company.id,
      name: req.company.name,
      subdomain: req.company.subdomain,
      active: req.company.active
    });
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo estado de empresa' });
  }
});

// Bloquear el registro público: solo el SuperAdmin crea empresas.
// Esto sobreescribe el archivo estático public/register.html.
app.get('/register.html', (req, res) => {
  res.status(404).send('Not found');
});

app.use(express.static(path.join(__dirname, 'public')));

// Evitar ruido en consola si no hay favicon.ico (no es crítico para la app).
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// OpenAI key por variable de entorno (no se debe hardcodear)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Rate-limit simple in-memory para endpoints de login (dev-friendly)
const loginAttempts = new Map();
function rateLimitLogin(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString();
  const now = Date.now();
  const windowMs = 60_000;
  const max = 20;

  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count += 1;
  loginAttempts.set(ip, entry);

  if (entry.count > max) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto e inténtalo de nuevo.' });
  }
  next();
}

let RESTAURANT_LAT = 40.4168;
let RESTAURANT_LON = -3.7038;
let MAX_DISTANCE = 50;
let RESTAURANT_ADDRESS = '';

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// === REGISTRO DE EMPRESA (SAAS) ===
// ⚠️ Cerrado al público: solo SuperAdmin (plataforma)
app.post('/api/register-company', requireSuperAdmin, async (req, res) => {
  const { companyName, subdomain, adminName, adminUsername, adminPassword } = req.body;

  if (!companyName || !subdomain || !adminUsername || !adminPassword) {
    return res.status(400).json({ error: 'Faltan datos requeridos (Empresa, Subdominio, Admin Usuario/Pass)' });
  }

  const reservedSubdomains = new Set(['admin', 'www']);
  const normalizedSubdomain = String(subdomain).toLowerCase().trim();
  if (reservedSubdomains.has(normalizedSubdomain)) {
    return res.status(400).json({ error: `El subdominio "${normalizedSubdomain}" está reservado` });
  }

  const t = await sequelize.transaction();

  try {
    // 1. Crear Empresa
    const company = await Company.create({
      name: companyName,
      subdomain: normalizedSubdomain
    }, { transaction: t });

    // 2. Crear Usuario Admin vinculado
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const adminUser = await User.create({
      company_id: company.id,
      nombre: adminName || 'Administrador',
      username: adminUsername,
      password: hashedPassword,
      rol: 'admin'
    }, { transaction: t });

    // 3. Crear Configuración Inicial
    await Config.create({
      company_id: company.id,
      lat: 40.4168,
      lon: -3.7038,
      maxDistance: 50,
      address: 'Ubicación por defecto'
    }, { transaction: t });

    await t.commit();
    res.json({ success: true, message: 'Empresa registrada exitosamente', companyId: company.id });

  } catch (err) {
    await t.rollback();
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'El subdominio ya existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/superadmin/companies - Crear empresa (solo superadmin)
app.post('/api/superadmin/companies', requireSuperAdmin, async (req, res) => {
  const { companyName, subdomain, adminName, adminUsername, adminPassword } = req.body;

  if (!companyName || !subdomain || !adminUsername || !adminPassword) {
    return res.status(400).json({ error: 'Faltan datos requeridos (Empresa, Subdominio, Admin Usuario/Pass)' });
  }

  const reservedSubdomains = new Set(['admin', 'www']);
  const normalizedSubdomain = String(subdomain).toLowerCase().trim();
  if (reservedSubdomains.has(normalizedSubdomain)) {
    return res.status(400).json({ error: `El subdominio "${normalizedSubdomain}" está reservado` });
  }

  const t = await sequelize.transaction();
  try {
    const company = await Company.create({
      name: companyName,
      subdomain: normalizedSubdomain
    }, { transaction: t });

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await User.create({
      company_id: company.id,
      nombre: adminName || 'Administrador',
      username: adminUsername,
      password: hashedPassword,
      rol: 'admin'
    }, { transaction: t });

    await Config.create({
      company_id: company.id,
      lat: 40.4168,
      lon: -3.7038,
      maxDistance: 50,
      address: 'Ubicación por defecto'
    }, { transaction: t });

    await t.commit();
    res.json({ success: true, message: 'Empresa creada', companyId: company.id });
  } catch (err) {
    await t.rollback();
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'El subdominio ya existe' });
    }
    res.status(500).json({ error: err.message });
  }
});


// --- Middleware Platform Super Admin (no empresa) ---
async function requireSuperAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.platform !== true || decoded.rol !== 'superadmin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    req.platformAdmin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// === AUTH SUPERADMIN (PLATAFORMA) ===
app.post('/api/superadmin/login', rateLimitLogin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const admin = await PlatformAdmin.findOne({ where: { username } });
    if (!admin) return res.status(401).json({ error: 'Credenciales inválidas' });

    const passwordMatch = await bcrypt.compare(password, admin.password);
    if (!passwordMatch) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        rol: 'superadmin',
        nombre: admin.nombre,
        platform: true
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ success: true, token, admin: { id: admin.id, username: admin.username, nombre: admin.nombre } });
  } catch (error) {
    res.status(500).json({ error: 'Error de servidor' });
  }
});

// --- API ROUTES SUPER ADMIN ---

// GET /api/superadmin/companies - List all companies
app.get('/api/superadmin/companies', requireSuperAdmin, async (req, res) => {
  try {
    const companies = await Company.findAll({
      // No mostrar entradas reservadas/legacy del antiguo superadmin-por-empresa
      where: { subdomain: { [Op.ne]: 'admin' } },
      order: [['createdAt', 'DESC']]
    });
    // Add User count for each company
    const companiesWithStats = await Promise.all(companies.map(async (c) => {
      const userCount = await User.count({ where: { company_id: c.id } });
      return { ...c.get({ plain: true }), userCount };
    }));
    res.json(companiesWithStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener empresas: ' + error.message });
  }
});

// DELETE /api/superadmin/companies/:id - Delete company
app.delete('/api/superadmin/companies/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const company = await Company.findByPk(id);
    if (!company) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // Cascade delete manually (safety)
    await User.destroy({ where: { company_id: id } });
    await Log.destroy({ where: { company_id: id } });
    await Schedule.destroy({ where: { company_id: id } });
    await Config.destroy({ where: { company_id: id } });
    await company.destroy();

    res.json({ success: true, message: 'Empresa eliminada' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar empresa' });
  }
});

// PUT /api/superadmin/companies/:id - Update name/active
app.put('/api/superadmin/companies/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, active } = req.body;

    const company = await Company.findByPk(id);
    if (!company) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (name) company.name = name;
    if (typeof active === 'boolean') company.active = active;

    await company.save();
    res.json({ success: true, message: 'Empresa actualizada', company });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});


// === AUTH LOGIN ===
app.post('/api/login', rateLimitLogin, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    if (!req.company) return res.status(404).json({ error: 'Empresa no encontrada (Subdominio inválido)' });

    const user = await User.findOne({
      where: {
        company_id: req.company.id, // SCOPED QUERY
        [Op.or]: [ // Sequelize Operator for OR
          { username: username },
          { email: username }
        ]
      }
    });

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    // El Super Admin va separado del sistema de empresas
    if (user.rol === 'superadmin') {
      return res.status(403).json({ error: 'Acceso superadmin por separado. Usa /superadmin.html' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar token
    const token = jwt.sign(
      { id: user.id, username: user.username, rol: user.rol, nombre: user.nombre },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        username: user.username,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    if (!req.company) return res.status(401).json({ error: 'Empresa no identificada' });
    const logs = await Log.findAll({
      where: { company_id: req.company.id }, // SCOPED
      include: [{ model: User, attributes: ['nombre'] }],
      order: [['fecha', 'DESC']]
    });

    // Aplanar respuesta para mantener compatibilidad con frontend
    const flatLogs = logs.map(log => ({
      id: log.id,
      nombre: log.User ? log.User.nombre : 'Desconocido',
      tipo: log.tipo,
      fecha: log.fecha,
      lat: log.lat,
      lon: log.lon
    }));

    res.json(flatLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener último fichaje de un usuario
app.get('/api/last-log/:userId', async (req, res) => {
  const userId = req.params.userId;
  try {
    const log = await Log.findOne({
      where: { user_id: userId, company_id: req.company.id }, // SCOPED
      order: [['fecha', 'DESC']],
      attributes: ['tipo', 'fecha']
    });
    res.json(log || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para eliminar TODOS los logs
app.delete('/api/logs', async (req, res) => {
  try {
    const deleted = await Log.destroy({ where: { company_id: req.company.id }, truncate: false }); // SCOPED
    res.json({
      success: true,
      message: 'Todos los registros han sido eliminados',
      deletedRows: deleted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para eliminar logs por empleado
// Endpoint para eliminar logs por empleado
app.delete('/api/logs/employee/:employeeName', async (req, res) => {
  const employeeName = req.params.employeeName;
  try {
    // Buscar usuario por nombre dentro de la empresa
    const user = await User.findOne({ where: { nombre: employeeName, company_id: req.company.id } }); // SCOPED
    if (!user) return res.status(404).json({ error: 'Empleado no encontrado' });

    const deleted = await Log.destroy({ where: { user_id: user.id, company_id: req.company.id } });

    res.json({
      success: true,
      message: `Registros de ${employeeName} eliminados`,
      deletedRows: deleted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    if (!req.company) return res.json([]);
    const users = await User.findAll({
      where: { company_id: req.company.id }, // SCOPED
      attributes: ['id', 'nombre', 'username', 'email', 'rol']
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint GET /api/config
app.get('/api/config', async (req, res) => {
  try {
    if (!req.company) return res.status(404).json({ error: 'Empresa no encontrada' });

    let config = await Config.findOne({ where: { company_id: req.company.id } }); // SCOPED
    if (!config) {
      // Crear config por defecto
      config = await Config.create({
        company_id: req.company.id,
        lat: RESTAURANT_LAT,
        lon: RESTAURANT_LON,
        maxDistance: MAX_DISTANCE,
        address: RESTAURANT_ADDRESS
      });
    }

    // Actualizar variables globales
    RESTAURANT_LAT = config.lat;
    RESTAURANT_LON = config.lon;
    MAX_DISTANCE = config.maxDistance;
    RESTAURANT_ADDRESS = config.address;

    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint POST /api/config
app.post('/api/config', async (req, res) => {
  const { lat, lon, maxDistance, address, metodo_fichaje, qr_duracion, qr_pin } = req.body;

  try {
    let config = await Config.findOne({ where: { company_id: req.company.id } }); // SCOPED
    if (config) {
      await config.update({
        lat: lat !== undefined ? lat : config.lat,
        lon: lon !== undefined ? lon : config.lon,
        maxDistance: maxDistance !== undefined ? maxDistance : config.maxDistance,
        address: address !== undefined ? address : config.address,
        metodo_fichaje: metodo_fichaje !== undefined ? metodo_fichaje : config.metodo_fichaje,
        qr_duracion: qr_duracion !== undefined ? qr_duracion : config.qr_duracion,
        qr_pin: qr_pin !== undefined ? qr_pin : config.qr_pin
      });
    } else {
      config = await Config.create({
        company_id: req.company.id,
        lat, lon, maxDistance, address, metodo_fichaje, qr_duracion, qr_pin
      });
    }

    // Actualizar globales
    RESTAURANT_LAT = config.lat;
    RESTAURANT_LON = config.lon;
    MAX_DISTANCE = config.maxDistance;
    RESTAURANT_ADDRESS = config.address || '';

    res.json({
      success: true,
      message: 'Configuración actualizada',
      config
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const total = await Log.count({ where: { company_id: req.company.id } });
    const totalEntradas = await Log.count({ where: { tipo: 'ENTRADA', company_id: req.company.id } });
    const totalSalidas = await Log.count({ where: { tipo: 'SALIDA', company_id: req.company.id } });
    // aggregate count distinct user_id with where clause
    // Sequelize aggregate syntax verify: Model.aggregate(field, func, options)
    const totalEmpleados = await Log.count({
      distinct: true,
      col: 'user_id',
      where: { company_id: req.company.id }
    });

    const topLogs = await Log.findAll({
      where: { company_id: req.company.id }, // SCOPED
      attributes: ['user_id', [sequelize.fn('COUNT', sequelize.col('id')), 'fichajes']],
      include: [{ model: User, attributes: ['nombre'] }],
      group: ['user_id', 'User.id', 'User.nombre'],
      order: [[sequelize.literal('fichajes'), 'DESC']],
      limit: 5
    });

    const topEmpleados = topLogs.map(t => ({
      nombre: t.User ? t.User.nombre : 'Unknown',
      fichajes: t.get('fichajes')
    }));

    res.json({
      total,
      totalEntradas,
      totalSalidas,
      totalEmpleados,
      topEmpleados
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ENDPOINTS DE GESTIÓN DE USUARIOS ===
// Crear usuario
app.post('/api/users', async (req, res) => {
  const { nombre, username, email, password, rol } = req.body;

  if (!nombre || !username || !rol || !password) {
    return res.status(400).json({ error: 'Nombre, usuario, password y rol son requeridos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      company_id: req.company.id, // SCOPED
      nombre, username, email, password: hashedPassword, rol
    });

    res.json({
      success: true,
      message: 'Usuario creado',
      user
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'El usuario o email ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});


// Actualizar usuario
app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, username, email, password, rol } = req.body;

  try {
    const user = await User.findOne({ where: { id, company_id: req.company.id } }); // SCOPED
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = { nombre, username, email, rol };
    if (password) {
      updates.password = await bcrypt.hash(password, 10);
    }

    await user.update(updates);
    res.json({ success: true, message: 'Usuario actualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno: ' + error.message });
  }
});


// Eliminar usuario
app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await User.destroy({ where: { id, company_id: req.company.id } }); // SCOPED
    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === FUNCIONES AUXILIARES PARA HORARIOS ===
function expandirHorariosRecurrentes(horarios) {
  const expandidos = [];
  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  horarios.forEach(horario => {
    if (!horario.es_recurrente || !horario.fecha_desde || !horario.fecha_hasta) {
      // Horario no recurrente, incluir tal cual
      expandidos.push(horario);
      return;
    }

    // Usar T00:00:00 para evitar problemas de zona horaria
    const fechaInicio = new Date(horario.fecha_desde + 'T00:00:00');
    const fechaFin = new Date(horario.fecha_hasta + 'T00:00:00');
    const frecuencia = horario.frecuencia_recurrencia || 'semanal';

    console.log(`🔄 Expandiendo horario recurrente ${frecuencia}: ${horario.dia_semana} de ${horario.fecha_desde} a ${horario.fecha_hasta}`);

    let fechaActual = new Date(fechaInicio);

    // Mapear nombre del día a número (0-6)
    const diaObjetivo = diasSemana.indexOf(horario.dia_semana);
    if (diaObjetivo === -1) {
      console.log(`⚠️ Día no reconocido: ${horario.dia_semana}`);
      expandidos.push(horario);
      return;
    }

    // Encontrar la primera ocurrencia del día objetivo
    while (fechaActual.getDay() !== diaObjetivo && fechaActual <= fechaFin) {
      fechaActual.setDate(fechaActual.getDate() + 1);
    }

    let contador = 0;
    const maxIteraciones = 1000; // Seguridad para evitar loops infinitos

    // Generar todas las ocurrencias según la frecuencia
    while (fechaActual <= fechaFin && contador < maxIteraciones) {
      contador++;

      const horarioExpandido = {
        ...horario,
        fecha_especifica: fechaActual.toISOString().split('T')[0],
        id_original: horario.id
      };
      expandidos.push(horarioExpandido);

      // Avanzar según la frecuencia
      switch (frecuencia) {
        case 'semanal':
          fechaActual.setDate(fechaActual.getDate() + 7);
          break;

        case 'quincenal':
          fechaActual.setDate(fechaActual.getDate() + 14);
          break;

        case 'mensual': {
          // Guardar el día de la semana y la semana del mes actual
          const diaActual = fechaActual.getDate();
          const semanaDelMes = Math.ceil(diaActual / 7);

          // Avanzar al siguiente mes
          fechaActual.setMonth(fechaActual.getMonth() + 1);
          fechaActual.setDate(1);

          // Buscar la misma semana y día de la semana en el nuevo mes
          let ocurrenciasEncontradas = 0;
          while (ocurrenciasEncontradas < semanaDelMes && fechaActual.getMonth() === ((horarioExpandido.fecha_especifica.split('-')[1] - 1 + 1) % 12)) {
            if (fechaActual.getDay() === diaObjetivo) {
              ocurrenciasEncontradas++;
              if (ocurrenciasEncontradas === semanaDelMes) {
                break;
              }
            }
            fechaActual.setDate(fechaActual.getDate() + 1);
          }

          // Si no encontramos la semana exacta, buscar la primera ocurrencia del mes
          if (ocurrenciasEncontradas < semanaDelMes) {
            fechaActual.setDate(1);
            while (fechaActual.getDay() !== diaObjetivo) {
              fechaActual.setDate(fechaActual.getDate() + 1);
            }
          }
          break;
        }

        case 'trimestral':
          fechaActual.setMonth(fechaActual.getMonth() + 3);
          // Buscar el mismo día de la semana
          while (fechaActual.getDay() !== diaObjetivo && contador < maxIteraciones) {
            fechaActual.setDate(fechaActual.getDate() + 1);
            contador++;
          }
          break;

        case 'anual':
          fechaActual.setFullYear(fechaActual.getFullYear() + 1);
          // Ajustar día de la semana si es necesario (por años bisiestos)
          while (fechaActual.getDay() !== diaObjetivo && contador < maxIteraciones) {
            fechaActual.setDate(fechaActual.getDate() + 1);
            contador++;
          }
          break;

        default:
          console.log(`⚠️ Frecuencia no reconocida: ${frecuencia}, usando semanal por defecto`);
          fechaActual.setDate(fechaActual.getDate() + 7);
      }
    }

    if (contador >= maxIteraciones) {
      console.log(`⚠️ Se alcanzó el límite de iteraciones expandiendo horario ID ${horario.id}`);
    } else {
      console.log(`✅ Horario ID ${horario.id} expandido en ${contador} ocurrencias`);
    }
  });

  return expandidos;
}

// === ENDPOINTS DE HORARIOS ===
// Obtener horarios
// === ENDPOINTS DE HORARIOS ===
// Obtener horarios
app.get('/api/horarios', async (req, res) => {
  const { userId, expandir } = req.query;

  try {
    const whereClause = userId ? { user_id: userId, company_id: req.company.id } : { company_id: req.company.id }; // SCOPED
    const schedules = await Schedule.findAll({
      where: whereClause,
      include: [{ model: User, attributes: ['nombre'] }],
      order: [['dia_semana', 'ASC'], ['hora_inicio', 'ASC']]
    });

    // Mapear para estructura esperada por frontend
    const plainSchedules = schedules.map(s => {
      const plain = s.get({ plain: true });
      plain.nombre = plain.User ? plain.User.nombre : 'Unknown';
      return plain;
    });

    if (expandir === 'true') {
      const expandidos = expandirHorariosRecurrentes(plainSchedules);
      res.json(expandidos);
    } else {
      res.json(plainSchedules);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear horario
app.post('/api/horarios', async (req, res) => {
  const { user_id, dia_semana, hora_inicio, hora_fin, fecha_desde, fecha_hasta, es_recurrente, frecuencia_recurrencia, notas } = req.body;

  if (!user_id || !dia_semana || !hora_inicio || !hora_fin) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const schedule = await Schedule.create({
      company_id: req.company.id, // SCOPED
      user_id, dia_semana, hora_inicio, hora_fin, fecha_desde, fecha_hasta,
      es_recurrente: es_recurrente ? true : false,
      frecuencia_recurrencia, notas
    });
    res.json({
      success: true,
      message: 'Horario creado',
      id: schedule.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar horario
app.delete('/api/horarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await Schedule.destroy({ where: { id, company_id: req.company.id } }); // SCOPED
    res.json({ success: true, message: 'Horario eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar todos los horarios de un usuario
app.delete('/api/horarios/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const deleted = await Schedule.destroy({ where: { user_id: userId, company_id: req.company.id } }); // SCOPED
    res.json({ success: true, message: `Eliminados ${deleted} horarios`, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Procesar imagen con ChatGPT Vision
app.post('/api/horarios/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ninguna imagen' });
    }

    // Usar la API Key configurada en el servidor
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: 'API Key no configurada',
        details: 'Configura OPENAI_API_KEY en variables de entorno del servidor'
      });
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Leer la imagen
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');

    // Llamar a ChatGPT Vision
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analiza esta imagen de horario de trabajo y extrae la información.
              
MUY IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional antes o después.
              
El JSON debe tener esta estructura exacta:
              {
                "horarios": [
                  {
                    "empleado": "Nombre del empleado",
                    "dia_semana": "Lunes",
                    "hora_inicio": "09:00",
                    "hora_fin": "17:00",
                    "notas": "Turno de mañana"
                  }
                ]
              }
              
Notas:
              - dia_semana debe ser uno de: Lunes, Martes, Miércoles, Jueves, Viernes, Sábado, Domingo
              - hora_inicio y hora_fin en formato HH:MM (24 horas)
              - Si no hay notas, usa una cadena vacía
              - NO incluyas comas al final del último elemento
              - NO incluyas comentarios en el JSON`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 4000,
      temperature: 0.1
    });

    const content = response.choices[0].message.content;
    console.log('\n=== RESPUESTA DE OPENAI ===');
    console.log('Content completo:', content);
    console.log('Longitud:', content.length, 'caracteres');
    console.log('=========================\n');

    // Intentar encontrar un JSON completo
    let jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.error('ERROR: No se pudo extraer JSON de la respuesta');
      throw new Error('No se pudo extraer JSON de la respuesta');
    }

    let jsonString = jsonMatch[0];

    // Validar que el JSON esté completo (debe terminar con }})
    if (!jsonString.trim().endsWith('}}')) {
      console.warn('ADVERTENCIA: JSON parece estar incompleto, intentando reparar...');

      // Intentar reparar JSON incompleto
      // Buscar el último objeto completo
      const lastCompleteObject = jsonString.lastIndexOf('},');
      if (lastCompleteObject > -1) {
        // Cortar hasta el último objeto completo y cerrar el array
        jsonString = jsonString.substring(0, lastCompleteObject + 1) + '\n  ]\n}';
        console.log('JSON reparado hasta el último objeto completo');
      } else {
        throw new Error('JSON incompleto y no se pudo reparar');
      }
    }

    console.log('\n=== JSON EXTRAIDO ===');
    console.log(jsonString.substring(0, 500) + '...');
    console.log('Longitud JSON:', jsonString.length);
    console.log('=====================\n');

    let horarios;
    try {
      horarios = JSON.parse(jsonString);
      console.log('\n=== JSON PARSEADO EXITOSAMENTE ===');
      console.log('Total horarios detectados:', horarios.horarios?.length || 0);
      console.log('==================================\n');
    } catch (parseError) {
      console.error('\n=== ERROR PARSEANDO JSON ===');
      console.error('Error:', parseError.message);
      console.error('Posición del error:', parseError.message.match(/position (\d+)/)?.[1] || 'desconocida');
      console.error('============================\n');
      throw new Error(`Error parseando JSON: ${parseError.message}`);
    }

    // Eliminar el archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      horarios: horarios.horarios || []
    });

  } catch (error) {
    // Eliminar archivo si hay error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: 'Error procesando la imagen',
      details: error.message
    });
  }
});

app.post('/api/check-in', async (req, res) => {
  const { userId, lat, lon, tipo } = req.body;

  if (!userId || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const tipoFichaje = tipo || 'ENTRADA';

  try {
    // Primero verificar el último fichaje
    const lastLog = await Log.findOne({
      where: { user_id: userId, company_id: req.company.id }, // SCOPED
      order: [['fecha', 'DESC']]
    });

    // Validar el tipo según el último fichaje
    if (lastLog) {
      if (lastLog.tipo === 'ENTRADA' && tipoFichaje === 'ENTRADA') {
        return res.status(400).json({
          error: 'Ya has fichado la entrada. Debes fichar la salida.',
          requiredType: 'SALIDA'
        });
      }
      if (lastLog.tipo === 'SALIDA' && tipoFichaje === 'SALIDA') {
        return res.status(400).json({
          error: 'Ya has fichado la salida. Debes fichar la entrada.',
          requiredType: 'ENTRADA'
        });
      }
    } else if (tipoFichaje === 'SALIDA') {
      // Si no hay logs previos, no puede fichar salida
      return res.status(400).json({
        error: 'No tienes registro de entrada. Debes fichar la entrada primero.',
        requiredType: 'ENTRADA'
      });
    }

    // Validar ubicación (Geocerca)
    const distance = haversineDistance(lat, lon, RESTAURANT_LAT, RESTAURANT_LON);

    if (distance > MAX_DISTANCE) {
      return res.status(400).json({
        error: `Estás fuera del rango permitido (${Math.round(distance)}m > ${MAX_DISTANCE}m)`,
        distance: Math.round(distance)
      });
    }

    // Registrar fichaje
    const log = await Log.create({
      company_id: req.company.id, // SCOPED
      user_id: userId,
      tipo: tipoFichaje,
      lat,
      lon
    });

    // Obtener info del usuario para respuesta
    const user = await User.findByPk(userId); // Nota: Al ser PK no es estrictamente necesario filtrar por company_id para lectura, pero sí para seguridad.
    // Mejora seguridad:
    if (user.company_id !== req.company.id) {
      throw new Error("Usuario no pertenece a esta empresa");
    }

    res.json({
      success: true,
      message: `${tipoFichaje === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada correctamente`,
      data: {
        user: user.nombre,
        tipo: tipoFichaje,
        fecha: log.fecha,
        distancia: Math.round(distance)
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ENDPOINTS PARA QR ===
// Generar QR dinámico con token temporal
app.get('/api/qr/current', async (req, res) => {
  try {
    if (!req.company) return res.status(401).json({ error: 'Empresa no identificada' });

    const config = await Config.findOne({ where: { company_id: req.company.id } });
    const duracion = config?.qr_duracion || 60; // segundos
    const timestamp = Math.floor(Date.now() / 1000);

    // Crear token JWT que expira según configuración y amarrado a la empresa
    const token = jwt.sign(
      {
        type: 'fichaje',
        timestamp,
        company_id: req.company.id,
        subdomain: req.company.subdomain
      },
      JWT_SECRET,
      { expiresIn: duracion }
    );

    const qrDataURL = await QRCode.toDataURL(token, {
      width: 400,
      margin: 2,
      color: {
        dark: '#0891b2',
        light: '#ffffff'
      }
    });

    res.json({
      qrDataURL,
      token,
      expiraEn: duracion,
      timestamp
    });
  } catch (err) {
    res.status(500).json({ error: 'Error generando QR', details: err.message });
  }
});

// Validar QR y fichar
app.post('/api/qr/validate', async (req, res) => {
  const { token, userId, tipo } = req.body;

  if (!token || !userId || !tipo) {
    return res.status(400).json({ error: 'Token, userId y tipo son requeridos' });
  }

  try {
    if (!req.company) return res.status(401).json({ error: 'Empresa no identificada' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || decoded.type !== 'fichaje') {
      return res.status(400).json({ error: 'Token inválido' });
    }

    // El token debe pertenecer a la empresa actual
    if (decoded.company_id && decoded.company_id !== req.company.id) {
      return res.status(403).json({ error: 'QR no pertenece a esta empresa' });
    }

    const user = await User.findByPk(userId);
    if (!user || user.company_id !== req.company.id) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const lastLog = await Log.findOne({
      where: { user_id: userId, company_id: req.company.id },
      order: [['fecha', 'DESC']]
    });

    if (lastLog) {
      if (lastLog.tipo === 'ENTRADA' && tipo === 'ENTRADA') {
        return res.status(400).json({
          error: 'Ya has fichado la entrada. Debes escanear para la salida.',
          requiredType: 'SALIDA'
        });
      }
      if (lastLog.tipo === 'SALIDA' && tipo === 'SALIDA') {
        return res.status(400).json({
          error: 'Ya has fichado la salida. Debes escanear para la entrada.',
          requiredType: 'ENTRADA'
        });
      }
    }

    const log = await Log.create({
      company_id: req.company.id,
      user_id: userId,
      tipo,
      lat: 0,
      lon: 0
    });

    res.json({
      success: true,
      message: `${tipo} registrada correctamente por QR`,
      logId: log.id
    });
  } catch (error) {
    if (error && error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'QR expirado. Por favor escanea el nuevo código.' });
    }
    res.status(400).json({ error: 'Token inválido' });
  }
});

