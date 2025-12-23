
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
});

const User = sequelize.define('User', {
  nombre: { type: DataTypes.STRING, allowNull: false },
  username: { type: DataTypes.STRING, unique: true },
  email: { type: DataTypes.STRING },
  password: { type: DataTypes.STRING },
  rol: { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'users',
  timestamps: false
});

const Log = sequelize.define('Log', {
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  tipo: { type: DataTypes.STRING, allowNull: false },
  fecha: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  lat: { type: DataTypes.FLOAT },
  lon: { type: DataTypes.FLOAT }
}, {
  tableName: 'logs',
  timestamps: false
});

const Horario = sequelize.define('Horario', {
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  dia_semana: { type: DataTypes.STRING, allowNull: false },
  hora_inicio: { type: DataTypes.STRING, allowNull: false },
  hora_fin: { type: DataTypes.STRING, allowNull: false },
  fecha_desde: { type: DataTypes.DATE },
  fecha_hasta: { type: DataTypes.DATE },
  es_recurrente: { type: DataTypes.BOOLEAN, defaultValue: false },
  frecuencia_recurrencia: { type: DataTypes.STRING, defaultValue: 'semanal' },
  notas: { type: DataTypes.TEXT },
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'horarios',
  timestamps: false
});

const Config = sequelize.define('Config', {
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

User.hasMany(Log, { foreignKey: 'user_id' });
Log.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(Horario, { foreignKey: 'user_id' });
Horario.belongsTo(User, { foreignKey: 'user_id' });

async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync();

  // Usuario admin por defecto si no existe
  const admin = await User.findOne({ where: { username: 'admin' } });
  if (!admin) {
    const hash = await bcrypt.hash('123456', 10);
    await User.create({
      nombre: 'Admin',
      username: 'admin',
      email: 'admin@agendaloya.es',
      password: hash,
      rol: 'admin'
    });
  }

  // Config por defecto si no existe
  const config = await Config.findOne();
  if (!config) {
    await Config.create({});
  }
}

module.exports = {
  sequelize,
  User,
  Log,
  Horario,
  Config,
  initDb
};
