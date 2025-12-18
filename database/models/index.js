const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// Configuración de la conexión
// Si hay DATABASE_URL usa PostgreSQL (Producción), si no, usa SQLite local.
const sequelize = process.env.DATABASE_URL
    ? new Sequelize(process.env.DATABASE_URL, {
        dialect: 'postgres',
        logging: false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
    })
    : new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, '../fichajes.db'), // Usa el mismo archivo DB
        logging: false
    });

// === MODELOS ===

const Company = sequelize.define('Company', {
    name: { type: DataTypes.STRING, allowNull: false },
    subdomain: { type: DataTypes.STRING, unique: true, allowNull: false },
    plan: { type: DataTypes.STRING, defaultValue: 'free' }, // free, basic, pro
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, {
    tableName: 'companies',
    tableName: 'companies',
    timestamps: true
});

const User = sequelize.define('User', {
    company_id: { type: DataTypes.INTEGER, allowNull: false },
    nombre: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING }, // Unique per company logic needs to be handled
    email: { type: DataTypes.STRING }, // Mantenemos email por si acaso, aunque sea opcional
    password: { type: DataTypes.STRING },
    rol: { type: DataTypes.STRING, allowNull: false, defaultValue: 'camarero' }
}, {
    tableName: 'users', // Mantiene compatibilidad con la tabla existente
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false // No tenemos columna updated_at
});

const Log = sequelize.define('Log', {
    company_id: { type: DataTypes.INTEGER, allowNull: false },
    tipo: { type: DataTypes.STRING, allowNull: false }, // ENTRADA o SALIDA
    fecha: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    lat: { type: DataTypes.FLOAT },
    lon: { type: DataTypes.FLOAT }
}, {
    tableName: 'logs',
    timestamps: false // La tabla original no tenía updatedAt
});

const Schedule = sequelize.define('Schedule', {
    company_id: { type: DataTypes.INTEGER, allowNull: false },
    dia_semana: { type: DataTypes.STRING, allowNull: false },
    hora_inicio: { type: DataTypes.STRING, allowNull: false },
    hora_fin: { type: DataTypes.STRING, allowNull: false },
    fecha_desde: { type: DataTypes.DATEONLY },
    fecha_hasta: { type: DataTypes.DATEONLY },
    es_recurrente: { type: DataTypes.BOOLEAN, defaultValue: false },
    frecuencia_recurrencia: { type: DataTypes.STRING, defaultValue: 'semanal' },
    notas: { type: DataTypes.TEXT }
}, {
    tableName: 'horarios',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

const Config = sequelize.define('Config', {
    company_id: { type: DataTypes.INTEGER, allowNull: false },
    lat: { type: DataTypes.FLOAT, defaultValue: 40.4168 },
    lon: { type: DataTypes.FLOAT, defaultValue: -3.7038 },
    maxDistance: { type: DataTypes.INTEGER, defaultValue: 50 },
    address: { type: DataTypes.STRING, defaultValue: '' },
    metodo_fichaje: { type: DataTypes.STRING, defaultValue: 'gps' },
    qr_duracion: { type: DataTypes.INTEGER, defaultValue: 60 },
    qr_pin: { type: DataTypes.STRING, defaultValue: '1234' }
}, {
    tableName: 'config',
    timestamps: false
});

// Admin de plataforma (NO pertenece a ninguna empresa)
const PlatformAdmin = sequelize.define('PlatformAdmin', {
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    nombre: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Super Admin' }
}, {
    tableName: 'platform_admins',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
});

// === RELACIONES ===
// Company Associations
Company.hasMany(User, { foreignKey: 'company_id' });
User.belongsTo(Company, { foreignKey: 'company_id' });

Company.hasMany(Log, { foreignKey: 'company_id' });
Log.belongsTo(Company, { foreignKey: 'company_id' });

Company.hasMany(Schedule, { foreignKey: 'company_id' });
Schedule.belongsTo(Company, { foreignKey: 'company_id' });

Company.hasMany(Config, { foreignKey: 'company_id' });
Config.belongsTo(Company, { foreignKey: 'company_id' });

// Existing Associations
User.hasMany(Log, { foreignKey: 'user_id' });
Log.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(Schedule, { foreignKey: 'user_id' });
Schedule.belongsTo(User, { foreignKey: 'user_id' });

// === EXPORTAR ===
module.exports = {
    sequelize,
    Company,
    User,
    Log,
    Schedule,
    Config,
    PlatformAdmin
};
