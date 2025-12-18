const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

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
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT,
      password TEXT,
      rol TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
      lat REAL,
      lon REAL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS horarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      dia_semana TEXT NOT NULL,
      hora_inicio TEXT NOT NULL,
      hora_fin TEXT NOT NULL,
      fecha_desde DATE,
      fecha_hasta DATE,
      es_recurrente INTEGER DEFAULT 0,
      frecuencia_recurrencia TEXT DEFAULT 'semanal',
      notas TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Migración: agregar columna es_recurrente si no existe
  db.run(`ALTER TABLE horarios ADD COLUMN es_recurrente INTEGER DEFAULT 0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar error si ya existe
    }
  });

  // Migración: agregar columna frecuencia_recurrencia si no existe
  db.run(`ALTER TABLE horarios ADD COLUMN frecuencia_recurrencia TEXT DEFAULT 'semanal'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar error si ya existe
    }
  });

  // Migración: agregar email y password a usuarios existentes
  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {
    if (!err) console.log('✅ Columna email añadida a users');
  });

  db.run(`ALTER TABLE users ADD COLUMN password TEXT`, (err) => {
    if (!err) {
      console.log('✅ Columna password añadida a users');
      // Establecer contraseña por defecto '123456' hasheada para usuarios existentes
      const defaultHash = bcrypt.hashSync('123456', 10);
      db.run(`UPDATE users SET password = ? WHERE password IS NULL`, [defaultHash], (err) => {
        if (!err) console.log('🔐 Contraseñas por defecto asignadas a usuarios existentes');
      });
    }
  });

  // Migración: agregar username
  db.run(`ALTER TABLE users ADD COLUMN username TEXT`, (err) => {
    if (!err) {
      console.log('✅ Columna username añadida a users');
      // Generar usernames por defecto basados en el nombre
      db.all("SELECT id, nombre, email FROM users WHERE username IS NULL", (err, rows) => {
        if (!err && rows) {
          rows.forEach(user => {
            // Intentar usar la parte local del email, o generar desde el nombre
            let username = '';
            if (user.email && user.email.includes('@')) {
              username = user.email.split('@')[0];
            } else {
              username = user.nombre.toLowerCase().replace(/[^a-z0-9]/g, '.');
            }

            // Fix específico para Admin
            if (user.nombre === 'Admin') username = 'admin';

            db.run("UPDATE users SET username = ? WHERE id = ?", [username, user.id]);
          });
          if (rows.length > 0) console.log('👤 Usernames por defecto asignados');
        }
      });
    }
  });

  // Tabla de configuración extendida
  db.run(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL DEFAULT 40.4168,
      lon REAL DEFAULT -3.7038,
      maxDistance INTEGER DEFAULT 50,
      address TEXT DEFAULT '',
      metodo_fichaje TEXT DEFAULT 'gps',
      qr_duracion INTEGER DEFAULT 60,
      qr_pin TEXT DEFAULT '1234'
    )
  `, () => {
    // Insertar config por defecto si no existe
    db.get("SELECT COUNT(*) as count FROM config", (err, row) => {
      if (row && row.count === 0) {
        db.run(`INSERT INTO config (lat, lon, maxDistance, address, metodo_fichaje, qr_duracion, qr_pin) 
                VALUES (40.4168, -3.7038, 50, '', 'gps', 60, '1234')`, (err) => {
          if (!err) console.log('✓ Configuración inicial creada');
        });
      } else {
        // Actualizar tabla existente añadiendo nuevas columnas si no existen
        db.run(`ALTER TABLE config ADD COLUMN metodo_fichaje TEXT DEFAULT 'gps'`, () => { });
        db.run(`ALTER TABLE config ADD COLUMN qr_duracion INTEGER DEFAULT 60`, () => { });
        db.run(`ALTER TABLE config ADD COLUMN qr_pin TEXT DEFAULT '1234'`, () => { });
      }
    });
  });

  db.serialize(() => {
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
      if (row && row.count === 0) {
        const hash = bcrypt.hashSync('123456', 10);

        db.run("INSERT INTO users (nombre, username, email, password, rol) VALUES (?, ?, ?, ?, ?)",
          ['Admin', 'admin', 'admin@fichaapp.com', hash, 'admin'], (err) => {
            if (!err) console.log('✓ Usuario Admin insertado');
          });

        db.run("INSERT INTO users (nombre, username, email, password, rol) VALUES (?, ?, ?, ?, ?)",
          ['Carlos Camarero', 'carlos', 'carlos@fichaapp.com', hash, 'camarero'], (err) => {
            if (!err) console.log('✓ Usuario Camarero 1 insertado');
          });

        db.run("INSERT INTO users (nombre, username, email, password, rol) VALUES (?, ?, ?, ?, ?)",
          ['María Camarera', 'maria', 'maria@fichaapp.com', hash, 'camarero'], (err) => {
            if (!err) console.log('✓ Usuario Camarero 2 insertado');
          });
      }
    });
  });
}

module.exports = db;
