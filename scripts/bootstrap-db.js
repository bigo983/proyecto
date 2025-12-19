// One-shot bootstrap for PostgreSQL/Sequelize.
// Usage:
//   DATABASE_URL=postgres://user:pass@localhost:5432/fichadb node scripts/bootstrap-db.js
// Optional:
//   RESET_SUPERADMIN_PASSWORD=1  (forces superadmin password reset)
//   DEMO_SUBDOMAIN=demo
//   DEMO_COMPANY_NAME=DemoEmpresa
//   DEMO_ADMIN_USERNAME=admin
//   DEMO_ADMIN_PASSWORD=123456
//
// NOTE: This script is meant to be run manually once.

const bcrypt = require('bcrypt');
const { sequelize, Company, User, Config, PlatformAdmin } = require('../database/models');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está definido. Ejemplo: postgres://user:pass@localhost:5432/fichadb');
  }

  await sequelize.authenticate();
  await sequelize.sync({ alter: true });

  // 1) Platform superadmin
  const superUsername = 'superadmin';
  const superPassword = '123456';
  const resetFlag = String(process.env.RESET_SUPERADMIN_PASSWORD || '').toLowerCase();
  const shouldReset = resetFlag === '1' || resetFlag === 'true' || resetFlag === 'yes';

  let platformAdmin = await PlatformAdmin.findOne({ where: { username: superUsername } });
  if (!platformAdmin) {
    platformAdmin = await PlatformAdmin.create({
      username: superUsername,
      password: await bcrypt.hash(superPassword, 10),
      nombre: 'Super Admin'
    });
    console.log('✅ Platform superadmin creado: superadmin / 123456');
  } else if (shouldReset) {
    platformAdmin.password = await bcrypt.hash(superPassword, 10);
    await platformAdmin.save();
    console.log('🔐 Platform superadmin reseteado: superadmin / 123456');
  } else {
    console.log('ℹ️ Platform superadmin ya existe (no se resetea)');
  }

  // 2) Demo company
  const demoSubdomain = String(process.env.DEMO_SUBDOMAIN || 'demo').toLowerCase().trim();
  const demoCompanyName = String(process.env.DEMO_COMPANY_NAME || 'DemoEmpresa').trim();

  let company = await Company.findOne({ where: { subdomain: demoSubdomain } });
  if (!company) {
    company = await Company.create({ name: demoCompanyName, subdomain: demoSubdomain });
    console.log(`✅ Empresa creada: ${demoCompanyName} (${demoSubdomain}) [id=${company.id}]`);
  } else {
    console.log(`ℹ️ Empresa ya existe: ${company.name} (${company.subdomain}) [id=${company.id}]`);
  }

  // 3) Demo admin user for that company
  const demoAdminUsername = String(process.env.DEMO_ADMIN_USERNAME || 'admin').trim();
  const demoAdminPassword = String(process.env.DEMO_ADMIN_PASSWORD || '123456');

  let adminUser = await User.findOne({ where: { company_id: company.id, username: demoAdminUsername } });
  if (!adminUser) {
    adminUser = await User.create({
      company_id: company.id,
      nombre: 'Admin',
      username: demoAdminUsername,
      email: `${demoAdminUsername}@${demoSubdomain}.local`,
      password: await bcrypt.hash(demoAdminPassword, 10),
      rol: 'admin'
    });
    console.log(`✅ Admin de empresa creado: ${demoAdminUsername} / ${demoAdminPassword} (company_id=${company.id})`);
  } else {
    console.log(`ℹ️ Admin de empresa ya existe: ${demoAdminUsername} (company_id=${company.id})`);
  }

  // 4) Config row for company
  const cfg = await Config.findOne({ where: { company_id: company.id } });
  if (!cfg) {
    await Config.create({ company_id: company.id });
    console.log('✅ Config creada para la empresa demo');
  } else {
    console.log('ℹ️ Config ya existe para la empresa demo');
  }

  console.log('\nListo. Ahora puedes:');
  console.log('- Superadmin: /superadmin.html (superadmin / 123456)');
  console.log(`- App empresa: https://agendaloya.es/?company=${demoSubdomain} (admin / 123456)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Bootstrap falló:', err);
    process.exit(1);
  });
