const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = __dirname;

// Función auxiliar para crear carpetas
function createDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✓ Carpeta creada: ${dirPath}`);
  }
}

// Función auxiliar para escapar template literals
function escapeBackticks(str) {
  return str;
}

// 1. CREAR ESTRUCTURA DE CARPETAS
console.log('\n=== PASO 1: Creando estructura de carpetas ===\n');
createDirectory(path.join(baseDir, 'public'));
createDirectory(path.join(baseDir, 'database'));
createDirectory(path.join(baseDir, 'src'));

// 2. CREAR PACKAGE.JSON
console.log('\n=== PASO 2: Creando package.json ===\n');
const packageJson = {
  "name": "ficha-app-pwa",
  "version": "1.0.0",
  "description": "PWA Control de Horarios y Geolocalización en Restaurantes",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "keywords": ["PWA", "Geolocalización", "Restaurante"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2"
  }
};

fs.writeFileSync(
  path.join(baseDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);
console.log('✓ package.json creado');

// 3. INSTALAR DEPENDENCIAS
console.log('\n=== PASO 3: Instalando dependencias (npm install) ===\n');
try {
  execSync('npm install express sqlite3 cors body-parser', {
    cwd: baseDir,
    stdio: 'inherit'
  });
  console.log('\n✓ Dependencias instaladas correctamente');
} catch (error) {
  console.error('Error durante npm install:', error.message);
}

// 4. CREAR database/db.js
console.log('\n=== PASO 4: Creando database/db.js ===\n');
const dbCode = `const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'fichajes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('✓ Conectado a SQLite');
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Crear tabla de usuarios
  db.run(\`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  \`);

  // Crear tabla de logs
  db.run(\`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      lat REAL,
      lon REAL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  \`);

  // Insertar datos de prueba
  db.serialize(() => {
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row.count === 0) {
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['Admin', 'admin'], (err) => {
          if (!err) console.log('✓ Usuario Admin insertado');
        });
        
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['Carlos Camarero', 'camarero'], (err) => {
          if (!err) console.log('✓ Usuario Camarero 1 insertado');
        });
        
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['María Camarera', 'camarero'], (err) => {
          if (!err) console.log('✓ Usuario Camarero 2 insertado');
        });
      }
    });
  });
}

module.exports = db;
`;

fs.writeFileSync(
  path.join(baseDir, 'database', 'db.js'),
  dbCode
);
console.log('✓ database/db.js creado');

// 5. CREAR server.js
console.log('\n=== PASO 5: Creando server.js ===\n');
const serverCode = `const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./database/db');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Coordenadas del Restaurante (Hardcodeadas)
const RESTAURANT_LAT = 40.4168;
const RESTAURANT_LON = -3.7038;
const MAX_DISTANCE = 50; // metros

// Función Haversine para calcular distancia
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Endpoint GET /api/logs
app.get('/api/logs', (req, res) => {
  const query = \`
    SELECT l.id, u.nombre, l.tipo, l.fecha, l.lat, l.lon
    FROM logs l
    JOIN users u ON l.user_id = u.id
    ORDER BY l.fecha DESC
  \`;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Endpoint GET /api/users
app.get('/api/users', (req, res) => {
  db.all('SELECT id, nombre, rol FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Endpoint POST /api/check-in
app.post('/api/check-in', (req, res) => {
  const { userId, lat, lon } = req.body;

  if (!userId || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const distance = haversineDistance(RESTAURANT_LAT, RESTAURANT_LON, lat, lon);

  if (distance > MAX_DISTANCE) {
    return res.status(403).json({
      error: 'Está demasiado lejos del restaurante',
      distance: Math.round(distance),
      maxDistance: MAX_DISTANCE
    });
  }

  // Guardar en SQLite
  const insertQuery = 'INSERT INTO logs (user_id, tipo, lat, lon) VALUES (?, ?, ?, ?)';
  db.run(insertQuery, [userId, 'ENTRADA', lat, lon], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      message: 'Check-in registrado correctamente',
      distance: Math.round(distance)
    });
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(\`\\n╔════════════════════════════════════════╗\`);
  console.log(\`║  🚀 Servidor ejecutándose en puerto \${PORT}  ║\`);
  console.log(\`║  📱 Abre: http://localhost:\${PORT}        ║\`);
  console.log(\`╚════════════════════════════════════════╝\\n\`);
});
`;

fs.writeFileSync(
  path.join(baseDir, 'server.js'),
  serverCode
);
console.log('✓ server.js creado');

// 6. CREAR public/manifest.json
console.log('\n=== PASO 6: Creando public/manifest.json ===\n');
const manifest = {
  "name": "FichaApp - Control de Horarios",
  "short_name": "FichaApp",
  "description": "PWA para control de horarios y geolocalización en restaurantes",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#1F2937",
  "icons": [
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231F2937' width='192' height='192'/><text x='96' y='120' font-size='80' font-weight='bold' fill='white' text-anchor='middle'>F</text></svg>",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
};

fs.writeFileSync(
  path.join(baseDir, 'public', 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log('✓ public/manifest.json creado');

// 7. CREAR public/sw.js (Service Worker)
console.log('\n=== PASO 7: Creando public/sw.js ===\n');
const swCode = `const CACHE_NAME = 'ficha-app-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instalar el service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Cache abierto');
      return cache.addAll(urlsToCache);
    })
  );
});

// Activar el service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Interceptar solicitudes
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }).catch(() => {
      return caches.match('/index.html');
    })
  );
});
`;

fs.writeFileSync(
  path.join(baseDir, 'public', 'sw.js'),
  swCode
);
console.log('✓ public/sw.js creado');

// 8. CREAR public/index.html (Frontend PWA)
console.log('\n=== PASO 8: Creando public/index.html ===\n');
const htmlCode = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1F2937">
  <meta name="description" content="Control de horarios y geolocalización">
  <title>FichaApp - Control de Horarios</title>
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231F2937' width='192' height='192'/><text x='96' y='120' font-size='80' font-weight='bold' fill='white' text-anchor='middle'>F</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <style>
    .spinner {
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body class="bg-gray-100">
  <div id="app"></div>

  <script>
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('✓ Service Worker registrado'))
        .catch(err => console.error('Error al registrar Service Worker:', err));
    }

    // Estado de la aplicación
    let currentUser = null;
    let users = [];

    // Cargar usuarios al iniciar
    async function loadUsers() {
      try {
        const response = await fetch('/api/users');
        users = await response.json();
      } catch (error) {
        console.error('Error cargando usuarios:', error);
      }
    }

    // Vista Login
    function renderLogin() {
      const app = document.getElementById('app');
      app.innerHTML = \`
        <div class="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
          <div class="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
            <h1 class="text-3xl font-bold text-center text-gray-800 mb-2">FichaApp</h1>
            <p class="text-center text-gray-500 mb-8">Control de Horarios y Geolocalización</p>
            
            <div class="space-y-4">
              <label class="block text-gray-700 font-semibold mb-2">Selecciona tu usuario:</label>
              <select id="userSelect" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">-- Elige un usuario --</option>
                \${users.map(u => \`<option value="\${u.id}">\${u.nombre} (\${u.rol})</option>\`).join('')}
              </select>
              
              <button onclick="login()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition duration-200">
                Iniciar Sesión
              </button>
            </div>
          </div>
        </div>
      \`;
    }

    // Login
    function login() {
      const userSelect = document.getElementById('userSelect');
      const userId = userSelect.value;
      
      if (!userId) {
        alert('Por favor, selecciona un usuario');
        return;
      }

      currentUser = users.find(u => u.id === parseInt(userId));
      
      if (currentUser.rol === 'admin') {
        renderAdmin();
      } else {
        renderEmployee();
      }
    }

    // Vista Empleado
    function renderEmployee() {
      const app = document.getElementById('app');
      app.innerHTML = \`
        <div class="min-h-screen bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center p-4">
          <div class="w-full max-w-md">
            <div class="bg-white rounded-lg shadow-2xl p-8 text-center mb-4">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">Bienvenido</h1>
              <p class="text-2xl text-gray-600 font-semibold mb-8">\${currentUser.nombre}</p>
              
              <button onclick="checkIn()" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-6 text-3xl rounded-lg transition duration-200 mb-4">
                📍 FICHAR ENTRADA
              </button>
              
              <button onclick="logout()" class="w-full bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 rounded-lg transition duration-200">
                Cerrar Sesión
              </button>
            </div>
            <div id="status" class="text-white text-center text-sm"></div>
          </div>
        </div>
      \`;
    }

    // Check-in con Geolocalización
    async function checkIn() {
      const statusDiv = document.getElementById('status');
      statusDiv.innerHTML = '<div class="flex justify-center"><div class="spinner"></div></div>';

      if (!navigator.geolocation) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Tu navegador no soporta geolocalización'
        });
        statusDiv.innerHTML = '';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          try {
            const response = await fetch('/api/check-in', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: currentUser.id,
                lat: latitude,
                lon: longitude
              })
            });

            const data = await response.json();

            if (response.ok) {
              Swal.fire({
                icon: 'success',
                title: '¡Excelente!',
                text: \`Fichaje registrado. Distancia: \${data.distance}m\`,
                confirmButtonColor: '#16a34a'
              });
            } else {
              Swal.fire({
                icon: 'error',
                title: 'Demasiado lejos',
                text: \`Estás a \${data.distance}m. Máximo permitido: \${data.maxDistance}m\`,
                confirmButtonColor: '#dc2626'
              });
            }
          } catch (error) {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'No se pudo registrar el fichaje'
            });
          }

          statusDiv.innerHTML = '';
        },
        (error) => {
          Swal.fire({
            icon: 'error',
            title: 'Error de Geolocalización',
            text: error.message
          });
          statusDiv.innerHTML = '';
        }
      );
    }

    // Vista Admin
    async function renderAdmin() {
      const app = document.getElementById('app');
      
      try {
        const response = await fetch('/api/logs');
        const logs = await response.json();

        app.innerHTML = \`
          <div class="min-h-screen bg-gray-100 p-4">
            <div class="max-w-6xl mx-auto">
              <div class="bg-white rounded-lg shadow-lg p-6 mb-4">
                <h1 class="text-3xl font-bold text-gray-800 mb-2">Panel de Administración</h1>
                <p class="text-gray-600">Bienvenido, \${currentUser.nombre}</p>
              </div>

              <div class="bg-white rounded-lg shadow-lg p-6 mb-4">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Registro de Fichajes</h2>
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse">
                    <thead>
                      <tr class="bg-gray-200 border-b">
                        <th class="p-3 text-left font-semibold">ID</th>
                        <th class="p-3 text-left font-semibold">Empleado</th>
                        <th class="p-3 text-left font-semibold">Tipo</th>
                        <th class="p-3 text-left font-semibold">Fecha/Hora</th>
                        <th class="p-3 text-left font-semibold">Coords</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${logs.length === 0 ? '<tr><td colspan="5" class="p-3 text-center text-gray-500">No hay registros</td></tr>' : 
                        logs.map(log => \`
                          <tr class="border-b hover:bg-gray-50">
                            <td class="p-3">\${log.id}</td>
                            <td class="p-3">\${log.nombre}</td>
                            <td class="p-3"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">\${log.tipo}</span></td>
                            <td class="p-3">\${new Date(log.fecha).toLocaleString('es-ES')}</td>
                            <td class="p-3 text-sm text-gray-500">\${log.lat.toFixed(4)}, \${log.lon.toFixed(4)}</td>
                          </tr>
                        \`).join('')
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <button onclick="logout()" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
                Cerrar Sesión
              </button>
            </div>
          </div>
        \`;
      } catch (error) {
        console.error('Error cargando logs:', error);
        app.innerHTML = '<div class="p-4 text-red-600">Error al cargar los registros</div>';
      }
    }

    // Logout
    function logout() {
      currentUser = null;
      loadUsers().then(() => renderLogin());
    }

    // Iniciar aplicación
    loadUsers().then(() => renderLogin());
  </script>
</body>
</html>
`;

fs.writeFileSync(
  path.join(baseDir, 'public', 'index.html'),
  htmlCode
);
console.log('✓ public/index.html creado');

// 9. CREAR run.bat
console.log('\n=== PASO 9: Creando run.bat ===\n');
const batCode = `@echo off
title FichaApp - Control de Horarios
node server.js
pause
`;

fs.writeFileSync(
  path.join(baseDir, 'run.bat'),
  batCode
);
console.log('✓ run.bat creado');

// Mensaje final
console.log('\n╔═════════════════════════════════════════════════════╗');
console.log('║         ✓ PROYECTO CREADO CORRECTAMENTE              ║');
console.log('╚═════════════════════════════════════════════════════╝');
console.log('\n📁 Estructura generada:');
console.log('   ├── server.js');
console.log('   ├── database/');
console.log('   │   ├── db.js');
console.log('   │   └── fichajes.db (se crea al ejecutar)');
console.log('   ├── public/');
console.log('   │   ├── index.html');
console.log('   │   ├── manifest.json');
console.log('   │   └── sw.js');
console.log('   ├── package.json');
console.log('   ├── node_modules/');
console.log('   ├── run.bat');
console.log('   └── src/');
console.log('\n🚀 Para ejecutar la aplicación:');
console.log('   1. Doble clic en run.bat');
console.log('   2. O ejecuta: node server.js');
console.log('\n📱 Accede a: http://localhost:3000');
console.log('\n✅ ¡Listo para usar!\n');
`;

fs.writeFileSync(
  path.join(baseDir, 'setup.js'),
  `const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseDir = __dirname;

// Función auxiliar para crear carpetas
function createDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(\`✓ Carpeta creada: \${dirPath}\`);
  }
}

// 1. CREAR ESTRUCTURA DE CARPETAS
console.log('\\n=== PASO 1: Creando estructura de carpetas ===\\n');
createDirectory(path.join(baseDir, 'public'));
createDirectory(path.join(baseDir, 'database'));
createDirectory(path.join(baseDir, 'src'));

// 2. CREAR PACKAGE.JSON
console.log('\\n=== PASO 2: Creando package.json ===\\n');
const packageJson = {
  "name": "ficha-app-pwa",
  "version": "1.0.0",
  "description": "PWA Control de Horarios y Geolocalización en Restaurantes",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "keywords": ["PWA", "Geolocalización", "Restaurante"],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "sqlite3": "^5.1.6",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2"
  }
};

fs.writeFileSync(
  path.join(baseDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);
console.log('✓ package.json creado');

// 3. INSTALAR DEPENDENCIAS
console.log('\\n=== PASO 3: Instalando dependencias (npm install) ===\\n');
try {
  execSync('npm install express sqlite3 cors body-parser', {
    cwd: baseDir,
    stdio: 'inherit'
  });
  console.log('\\n✓ Dependencias instaladas correctamente');
} catch (error) {
  console.error('Error durante npm install:', error.message);
}

// 4. CREAR database/db.js
console.log('\\n=== PASO 4: Creando database/db.js ===\\n');
const dbCode = \`const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'fichajes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('✓ Conectado a SQLite');
    initializeDatabase();
  }
});

function initializeDatabase() {
  // Crear tabla de usuarios
  db.run(\\\`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  \\\`);

  // Crear tabla de logs
  db.run(\\\`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      lat REAL,
      lon REAL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  \\\`);

  // Insertar datos de prueba
  db.serialize(() => {
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row.count === 0) {
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['Admin', 'admin'], (err) => {
          if (!err) console.log('✓ Usuario Admin insertado');
        });
        
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['Carlos Camarero', 'camarero'], (err) => {
          if (!err) console.log('✓ Usuario Camarero 1 insertado');
        });
        
        db.run("INSERT INTO users (nombre, rol) VALUES (?, ?)", ['María Camarera', 'camarero'], (err) => {
          if (!err) console.log('✓ Usuario Camarero 2 insertado');
        });
      }
    });
  });
}

module.exports = db;
\`;

fs.writeFileSync(
  path.join(baseDir, 'database', 'db.js'),
  dbCode
);
console.log('✓ database/db.js creado');

// 5. CREAR server.js
console.log('\\n=== PASO 5: Creando server.js ===\\n');
const serverCode = \`const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./database/db');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Coordenadas del Restaurante (Hardcodeadas)
const RESTAURANT_LAT = 40.4168;
const RESTAURANT_LON = -3.7038;
const MAX_DISTANCE = 50; // metros

// Función Haversine para calcular distancia
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Endpoint GET /api/logs
app.get('/api/logs', (req, res) => {
  const query = \\\`
    SELECT l.id, u.nombre, l.tipo, l.fecha, l.lat, l.lon
    FROM logs l
    JOIN users u ON l.user_id = u.id
    ORDER BY l.fecha DESC
  \\\`;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Endpoint GET /api/users
app.get('/api/users', (req, res) => {
  db.all('SELECT id, nombre, rol FROM users', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Endpoint POST /api/check-in
app.post('/api/check-in', (req, res) => {
  const { userId, lat, lon } = req.body;

  if (!userId || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  const distance = haversineDistance(RESTAURANT_LAT, RESTAURANT_LON, lat, lon);

  if (distance > MAX_DISTANCE) {
    return res.status(403).json({
      error: 'Está demasiado lejos del restaurante',
      distance: Math.round(distance),
      maxDistance: MAX_DISTANCE
    });
  }

  // Guardar en SQLite
  const insertQuery = 'INSERT INTO logs (user_id, tipo, lat, lon) VALUES (?, ?, ?, ?)';
  db.run(insertQuery, [userId, 'ENTRADA', lat, lon], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      message: 'Check-in registrado correctamente',
      distance: Math.round(distance)
    });
  });
});

// Ruta raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(\\\`\\n╔════════════════════════════════════════╗\\\`);
  console.log(\\\`║  🚀 Servidor ejecutándose en puerto \${PORT}  ║\\\`);
  console.log(\\\`║  📱 Abre: http://localhost:\${PORT}        ║\\\`);
  console.log(\\\`╚════════════════════════════════════════╝\\n\\\`);
});
\`;

fs.writeFileSync(
  path.join(baseDir, 'server.js'),
  serverCode
);
console.log('✓ server.js creado');

// 6. CREAR public/manifest.json
console.log('\\n=== PASO 6: Creando public/manifest.json ===\\n');
const manifest = {
  "name": "FichaApp - Control de Horarios",
  "short_name": "FichaApp",
  "description": "PWA para control de horarios y geolocalización en restaurantes",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#1F2937",
  "icons": [
    {
      "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231F2937' width='192' height='192'/><text x='96' y='120' font-size='80' font-weight='bold' fill='white' text-anchor='middle'>F</text></svg>",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any"
    }
  ]
};

fs.writeFileSync(
  path.join(baseDir, 'public', 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log('✓ public/manifest.json creado');

// 7. CREAR public/sw.js (Service Worker)
console.log('\\n=== PASO 7: Creando public/sw.js ===\\n');
const swCode = \`const CACHE_NAME = 'ficha-app-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instalar el service worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Cache abierto');
      return cache.addAll(urlsToCache);
    })
  );
});

// Activar el service worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Interceptar solicitudes
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    }).catch(() => {
      return caches.match('/index.html');
    })
  );
});
\`;

fs.writeFileSync(
  path.join(baseDir, 'public', 'sw.js'),
  swCode
);
console.log('✓ public/sw.js creado');

// 8. CREAR public/index.html (Frontend PWA)
console.log('\\n=== PASO 8: Creando public/index.html ===\\n');
const htmlCode = \`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#1F2937">
  <meta name="description" content="Control de horarios y geolocalización">
  <title>FichaApp - Control de Horarios</title>
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'><rect fill='%231F2937' width='192' height='192'/><text x='96' y='120' font-size='80' font-weight='bold' fill='white' text-anchor='middle'>F</text></svg>">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"><\/script>
  <style>
    .spinner {
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  <\/style>
<\/head>
<body class="bg-gray-100">
  <div id="app"><\/div>

  <script>
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('✓ Service Worker registrado'))
        .catch(err => console.error('Error al registrar Service Worker:', err));
    }

    // Estado de la aplicación
    let currentUser = null;
    let users = [];

    // Cargar usuarios al iniciar
    async function loadUsers() {
      try {
        const response = await fetch('/api/users');
        users = await response.json();
      } catch (error) {
        console.error('Error cargando usuarios:', error);
      }
    }

    // Vista Login
    function renderLogin() {
      const app = document.getElementById('app');
      app.innerHTML = \\\`
        <div class="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
          <div class="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
            <h1 class="text-3xl font-bold text-center text-gray-800 mb-2">FichaApp<\/h1>
            <p class="text-center text-gray-500 mb-8">Control de Horarios y Geolocalización<\/p>
            
            <div class="space-y-4">
              <label class="block text-gray-700 font-semibold mb-2">Selecciona tu usuario:<\/label>
              <select id="userSelect" class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">-- Elige un usuario --<\/option>
                \${users.map(u => \\\`<option value="\\\${u.id}">\\\${u.nombre} (\\\${u.rol})<\/option>\\\`).join('')}
              <\/select>
              
              <button onclick="login()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition duration-200">
                Iniciar Sesión
              <\/button>
            <\/div>
          <\/div>
        <\/div>
      \\\`;
    }

    // Login
    function login() {
      const userSelect = document.getElementById('userSelect');
      const userId = userSelect.value;
      
      if (!userId) {
        alert('Por favor, selecciona un usuario');
        return;
      }

      currentUser = users.find(u => u.id === parseInt(userId));
      
      if (currentUser.rol === 'admin') {
        renderAdmin();
      } else {
        renderEmployee();
      }
    }

    // Vista Empleado
    function renderEmployee() {
      const app = document.getElementById('app');
      app.innerHTML = \\\`
        <div class="min-h-screen bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center p-4">
          <div class="w-full max-w-md">
            <div class="bg-white rounded-lg shadow-2xl p-8 text-center mb-4">
              <h1 class="text-3xl font-bold text-gray-800 mb-2">Bienvenido<\/h1>
              <p class="text-2xl text-gray-600 font-semibold mb-8">\${currentUser.nombre}<\/p>
              
              <button onclick="checkIn()" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-6 text-3xl rounded-lg transition duration-200 mb-4">
                📍 FICHAR ENTRADA
              <\/button>
              
              <button onclick="logout()" class="w-full bg-gray-400 hover:bg-gray-500 text-white font-bold py-2 rounded-lg transition duration-200">
                Cerrar Sesión
              <\/button>
            <\/div>
            <div id="status" class="text-white text-center text-sm"><\/div>
          <\/div>
        <\/div>
      \\\`;
    }

    // Check-in con Geolocalización
    async function checkIn() {
      const statusDiv = document.getElementById('status');
      statusDiv.innerHTML = '<div class="flex justify-center"><div class="spinner"><\/div><\/div>';

      if (!navigator.geolocation) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Tu navegador no soporta geolocalización'
        });
        statusDiv.innerHTML = '';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;

          try {
            const response = await fetch('/api/check-in', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: currentUser.id,
                lat: latitude,
                lon: longitude
              })
            });

            const data = await response.json();

            if (response.ok) {
              Swal.fire({
                icon: 'success',
                title: '¡Excelente!',
                text: \`Fichaje registrado. Distancia: \${data.distance}m\`,
                confirmButtonColor: '#16a34a'
              });
            } else {
              Swal.fire({
                icon: 'error',
                title: 'Demasiado lejos',
                text: \`Estás a \${data.distance}m. Máximo permitido: \${data.maxDistance}m\`,
                confirmButtonColor: '#dc2626'
              });
            }
          } catch (error) {
            Swal.fire({
              icon: 'error',
              title: 'Error',
              text: 'No se pudo registrar el fichaje'
            });
          }

          statusDiv.innerHTML = '';
        },
        (error) => {
          Swal.fire({
            icon: 'error',
            title: 'Error de Geolocalización',
            text: error.message
          });
          statusDiv.innerHTML = '';
        }
      );
    }

    // Vista Admin
    async function renderAdmin() {
      const app = document.getElementById('app');
      
      try {
        const response = await fetch('/api/logs');
        const logs = await response.json();

        app.innerHTML = \\\`
          <div class="min-h-screen bg-gray-100 p-4">
            <div class="max-w-6xl mx-auto">
              <div class="bg-white rounded-lg shadow-lg p-6 mb-4">
                <h1 class="text-3xl font-bold text-gray-800 mb-2">Panel de Administración<\/h1>
                <p class="text-gray-600">Bienvenido, \${currentUser.nombre}<\/p>
              <\/div>

              <div class="bg-white rounded-lg shadow-lg p-6 mb-4">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Registro de Fichajes<\/h2>
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse">
                    <thead>
                      <tr class="bg-gray-200 border-b">
                        <th class="p-3 text-left font-semibold">ID<\/th>
                        <th class="p-3 text-left font-semibold">Empleado<\/th>
                        <th class="p-3 text-left font-semibold">Tipo<\/th>
                        <th class="p-3 text-left font-semibold">Fecha/Hora<\/th>
                        <th class="p-3 text-left font-semibold">Coords<\/th>
                      <\/tr>
                    <\/thead>
                    <tbody>
                      \${logs.length === 0 ? '<tr><td colspan="5" class="p-3 text-center text-gray-500">No hay registros<\/td><\/tr>' : 
                        logs.map(log => \\\`
                          <tr class="border-b hover:bg-gray-50">
                            <td class="p-3">\${log.id}<\/td>
                            <td class="p-3">\${log.nombre}<\/td>
                            <td class="p-3"><span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">\${log.tipo}<\/span><\/td>
                            <td class="p-3">\${new Date(log.fecha).toLocaleString('es-ES')}<\/td>
                            <td class="p-3 text-sm text-gray-500">\${log.lat.toFixed(4)}, \${log.lon.toFixed(4)}<\/td>
                          <\/tr>
                        \\\`).join('')
                      }
                    <\/tbody>
                  <\/table>
                <\/div>
              <\/div>

              <button onclick="logout()" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition duration-200">
                Cerrar Sesión
              <\/button>
            <\/div>
          <\/div>
        \\\`;
      } catch (error) {
        console.error('Error cargando logs:', error);
        app.innerHTML = '<div class="p-4 text-red-600">Error al cargar los registros<\/div>';
      }
    }

    // Logout
    function logout() {
      currentUser = null;
      loadUsers().then(() => renderLogin());
    }

    // Iniciar aplicación
    loadUsers().then(() => renderLogin());
  <\/script>
<\/body>
<\/html>
\`;

fs.writeFileSync(
  path.join(baseDir, 'public', 'index.html'),
  htmlCode
);
console.log('✓ public/index.html creado');

// 9. CREAR run.bat
console.log('\\n=== PASO 9: Creando run.bat ===\\n');
const batCode = \`@echo off
title FichaApp - Control de Horarios
node server.js
pause
\`;

fs.writeFileSync(
  path.join(baseDir, 'run.bat'),
  batCode
);
console.log('✓ run.bat creado');

// Mensaje final
console.log('\\n╔═════════════════════════════════════════════════════╗');
console.log('║         ✓ PROYECTO CREADO CORRECTAMENTE              ║');
console.log('╚═════════════════════════════════════════════════════╝');
console.log('\\n📁 Estructura generada:');
console.log('   ├── server.js');
console.log('   ├── database/');
console.log('   │   ├── db.js');
console.log('   │   └── fichajes.db (se crea al ejecutar)');
console.log('   ├── public/');
console.log('   │   ├── index.html');
console.log('   │   ├── manifest.json');
console.log('   │   └── sw.js');
console.log('   ├── package.json');
console.log('   ├── node_modules/');
console.log('   ├── run.bat');
console.log('   └── src/');
console.log('\\n🚀 Para ejecutar la aplicación:');
console.log('   1. Doble clic en run.bat');
console.log('   2. O ejecuta: node server.js');
console.log('\\n📱 Accede a: http://localhost:3000');
console.log('\\n✅ ¡Listo para usar!\\n');
`
);

console.log('\n╔═════════════════════════════════════════════════════╗');
console.log('║         ✓ PROYECTO CREADO CORRECTAMENTE              ║');
console.log('╚═════════════════════════════════════════════════════╝');
console.log('\n📁 Estructura generada:');
console.log('   ├── server.js');
console.log('   ├── database/');
console.log('   │   ├── db.js');
console.log('   │   └── fichajes.db (se crea al ejecutar)');
console.log('   ├── public/');
console.log('   │   ├── index.html');
console.log('   │   ├── manifest.json');
console.log('   │   └── sw.js');
console.log('   ├── package.json');
console.log('   ├── node_modules/');
console.log('   ├── run.bat');
console.log('   └── src/');
console.log('\n🚀 Para ejecutar la aplicación:');
console.log('   1. Doble clic en run.bat');
console.log('   2. O ejecuta: node server.js');
console.log('\n📱 Accede a: http://localhost:3000');
console.log('\n✅ ¡Listo para usar!\n');
