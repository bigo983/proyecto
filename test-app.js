/**
 * Script de Testing para PWA Control de Horarios
 * Ejecutar con: node test-app.js
 */

const https = require('https');
const fs = require('fs');

// Configuración
const BASE_URL = 'https://localhost:3000';
const agent = new https.Agent({
  rejectUnauthorized: false // Aceptar certificados auto-firmados
});

// Colores para consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

// Función para hacer peticiones
function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      agent,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null
          });
        } catch {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Función para registrar tests
function logTest(name, passed, details = '') {
  const symbol = passed ? '✓' : '✗';
  const color = passed ? colors.green : colors.red;
  console.log(`  ${color}${symbol} ${name}${colors.reset}${details ? ` - ${details}` : ''}`);
  
  testResults.push({ name, passed, details });
  if (passed) testsPassed++;
  else testsFailed++;
}

// Tests
async function runTests() {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}    🧪 TESTING PWA CONTROL DE HORARIOS${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════${colors.reset}\n`);

  // Test 1: Servidor respondiendo
  console.log(`${colors.blue}📡 Test 1: Conexión al Servidor${colors.reset}`);
  try {
    const res = await request('/');
    logTest('Servidor HTTPS activo', res.status === 200);
  } catch (error) {
    logTest('Servidor HTTPS activo', false, error.message);
  }

  // Test 2: Base de datos
  console.log(`\n${colors.blue}💾 Test 2: Base de Datos${colors.reset}`);
  try {
    const dbExists = fs.existsSync('./database/horarios.db');
    logTest('Archivo de base de datos existe', dbExists);
    
    const schemaExists = fs.existsSync('./database/db.js');
    logTest('Archivo de esquema existe', schemaExists);
  } catch (error) {
    logTest('Base de datos accesible', false, error.message);
  }

  // Test 3: API de Usuarios
  console.log(`\n${colors.blue}👥 Test 3: API de Usuarios${colors.reset}`);
  try {
    const res = await request('/api/users');
    logTest('GET /api/users responde', res.status === 200);
    logTest('Retorna array de usuarios', Array.isArray(res.data));
    logTest('Usuarios tienen estructura correcta', 
      res.data.length > 0 && res.data[0].hasOwnProperty('nombre') && res.data[0].hasOwnProperty('rol'));
    
    const adminExists = res.data.some(u => u.rol === 'admin');
    logTest('Existe al menos 1 admin', adminExists);
    
    const employeeExists = res.data.some(u => u.rol === 'camarero');
    logTest('Existe al menos 1 empleado', employeeExists);
  } catch (error) {
    logTest('API de usuarios funcional', false, error.message);
  }

  // Test 4: API de Horarios
  console.log(`\n${colors.blue}📅 Test 4: API de Horarios${colors.reset}`);
  try {
    const res = await request('/api/horarios');
    logTest('GET /api/horarios responde', res.status === 200);
    logTest('Retorna array de horarios', Array.isArray(res.data));
    
    if (res.data.length > 0) {
      const horario = res.data[0];
      logTest('Horarios tienen estructura correcta',
        horario.hasOwnProperty('dia_semana') && 
        horario.hasOwnProperty('hora_inicio') && 
        horario.hasOwnProperty('hora_fin'));
    }
  } catch (error) {
    logTest('API de horarios funcional', false, error.message);
  }

  // Test 5: Crear horario (doble turno)
  console.log(`\n${colors.blue}🔄 Test 5: Funcionalidad Doble Turno${colors.reset}`);
  try {
    // Obtener primer empleado
    const usersRes = await request('/api/users');
    const employee = usersRes.data.find(u => u.rol === 'camarero');
    
    if (employee) {
      // Crear turno 1
      const turno1 = await request('/api/horarios', 'POST', {
        user_id: employee.id,
        dia_semana: 'Lunes',
        hora_inicio: '09:00',
        hora_fin: '13:00',
        notas: 'Test Turno 1'
      });
      logTest('Crear primer turno', turno1.status === 200 || turno1.status === 201);
      
      // Crear turno 2 (mismo día)
      const turno2 = await request('/api/horarios', 'POST', {
        user_id: employee.id,
        dia_semana: 'Lunes',
        hora_inicio: '17:00',
        hora_fin: '21:00',
        notas: 'Test Turno 2'
      });
      logTest('Crear segundo turno (doble turno)', turno2.status === 200 || turno2.status === 201);
      
      // Verificar que existen ambos turnos
      const horariosRes = await request(`/api/horarios?userId=${employee.id}`);
      const lunesHorarios = horariosRes.data.filter(h => h.dia_semana === 'Lunes');
      logTest('Sistema soporta múltiples turnos por día', lunesHorarios.length >= 2);
      
      // Limpiar: eliminar turnos de prueba
      if (turno1.data && turno1.data.id) {
        await request(`/api/horarios/${turno1.data.id}`, 'DELETE');
      }
      if (turno2.data && turno2.data.id) {
        await request(`/api/horarios/${turno2.data.id}`, 'DELETE');
      }
    } else {
      logTest('Empleado disponible para test', false, 'No hay empleados');
    }
  } catch (error) {
    logTest('Funcionalidad doble turno', false, error.message);
  }

  // Test 6: API de Configuración
  console.log(`\n${colors.blue}⚙️ Test 6: API de Configuración${colors.reset}`);
  try {
    const res = await request('/api/config');
    logTest('GET /api/config responde', res.status === 200);
    logTest('Configuración tiene estructura correcta',
      res.data && 
      res.data.hasOwnProperty('location_lat') && 
      res.data.hasOwnProperty('location_lon') &&
      res.data.hasOwnProperty('radius'));
  } catch (error) {
    logTest('API de configuración funcional', false, error.message);
  }

  // Test 7: API de Estadísticas
  console.log(`\n${colors.blue}📊 Test 7: API de Estadísticas${colors.reset}`);
  try {
    const res = await request('/api/stats');
    logTest('GET /api/stats responde', res.status === 200);
    logTest('Estadísticas tienen estructura correcta',
      res.data && 
      res.data.hasOwnProperty('totalUsuarios') && 
      res.data.hasOwnProperty('totalEmpleados') &&
      res.data.hasOwnProperty('totalHorarios'));
  } catch (error) {
    logTest('API de estadísticas funcional', false, error.message);
  }

  // Test 8: API de Logs
  console.log(`\n${colors.blue}📝 Test 8: API de Logs${colors.reset}`);
  try {
    const res = await request('/api/logs');
    logTest('GET /api/logs responde', res.status === 200);
    logTest('Retorna array de logs', Array.isArray(res.data));
  } catch (error) {
    logTest('API de logs funcional', false, error.message);
  }

  // Test 9: Archivos estáticos
  console.log(`\n${colors.blue}📁 Test 9: Archivos Estáticos${colors.reset}`);
  try {
    const indexExists = fs.existsSync('./public/index.html');
    logTest('index.html existe', indexExists);
    
    const manifestExists = fs.existsSync('./public/manifest.json');
    logTest('manifest.json existe', manifestExists);
    
    const swExists = fs.existsSync('./public/service-worker.js');
    logTest('service-worker.js existe', swExists);
    
    const sslCertExists = fs.existsSync('./ssl/cert.pem');
    logTest('Certificado SSL existe', sslCertExists);
    
    const sslKeyExists = fs.existsSync('./ssl/key.pem');
    logTest('Llave SSL existe', sslKeyExists);
  } catch (error) {
    logTest('Archivos estáticos', false, error.message);
  }

  // Test 10: Validación de estructura HTML
  console.log(`\n${colors.blue}🌐 Test 10: Estructura HTML${colors.reset}`);
  try {
    const html = fs.readFileSync('./public/index.html', 'utf8');
    logTest('HTML contiene función renderLogin', html.includes('function renderLogin'));
    logTest('HTML contiene función renderEmployee', html.includes('function renderEmployee'));
    logTest('HTML contiene función renderAdmin', html.includes('function renderAdmin'));
    logTest('HTML contiene función showHorarios', html.includes('function showHorarios'));
    logTest('HTML contiene función editEmployeeSchedule', html.includes('function editEmployeeSchedule'));
    logTest('HTML contiene función toggleTurn2', html.includes('function toggleTurn2'));
    logTest('HTML contiene función toggleEditTurn2', html.includes('function toggleEditTurn2'));
    logTest('HTML contiene checkboxes de doble turno', html.includes('enable-turn2-'));
  } catch (error) {
    logTest('Estructura HTML', false, error.message);
  }

  // Resumen final
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}                RESUMEN DE TESTS${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  
  const total = testsPassed + testsFailed;
  const percentage = ((testsPassed / total) * 100).toFixed(1);
  
  console.log(`\n  Total de tests: ${total}`);
  console.log(`  ${colors.green}✓ Pasados: ${testsPassed}${colors.reset}`);
  console.log(`  ${colors.red}✗ Fallados: ${testsFailed}${colors.reset}`);
  console.log(`  ${colors.yellow}Porcentaje de éxito: ${percentage}%${colors.reset}\n`);
  
  if (testsFailed === 0) {
    console.log(`${colors.green}  🎉 ¡TODOS LOS TESTS PASARON EXITOSAMENTE!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}  ⚠️  Algunos tests fallaron. Revisa los detalles arriba.${colors.reset}\n`);
  }

  // Guardar reporte
  const report = {
    fecha: new Date().toISOString(),
    total,
    pasados: testsPassed,
    fallados: testsFailed,
    porcentaje: parseFloat(percentage),
    resultados: testResults
  };

  fs.writeFileSync('./test-report.json', JSON.stringify(report, null, 2));
  console.log(`  📄 Reporte guardado en: test-report.json\n`);
}

// Ejecutar tests
runTests().catch(console.error);
