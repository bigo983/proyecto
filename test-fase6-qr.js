const https = require('https');

// Configuración para ignorar certificados auto-firmados
const agent = new https.Agent({
  rejectUnauthorized: false
});

function fetchWithAgent(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: async () => JSON.parse(data)
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

console.log('🧪 FASE 6: PRUEBAS DE SISTEMA QR CON PIN CONFIGURABLE\n');
console.log('═'.repeat(60));

let testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function test(name, result, details = '') {
  testResults.total++;
  if (result) {
    testResults.passed++;
    console.log(`✅ ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}`);
  }
  if (details) console.log(`   ${details}`);
}

async function runTests() {
  try {
    // Test 1: Verificar que config incluye qr_pin
    console.log('\n📋 Test 1: Configuración con PIN');
    const configRes = await fetchWithAgent('https://localhost:3000/api/config');
    const config = await configRes.json();
    
    test('Config tiene campo qr_pin', config.hasOwnProperty('qr_pin'), 
      `PIN actual: ${config.qr_pin || 'no definido'}`);
    test('PIN por defecto es 1234', config.qr_pin === '1234',
      `Valor: ${config.qr_pin}`);

    // Test 2: Actualizar PIN a un valor personalizado
    console.log('\n📋 Test 2: Actualizar PIN personalizado');
    const newPin = '5678';
    const updateRes = await fetchWithAgent('https://localhost:3000/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: config.lat,
        lon: config.lon,
        maxDistance: config.maxDistance,
        address: config.address,
        metodo_fichaje: config.metodo_fichaje,
        qr_duracion: config.qr_duracion,
        qr_pin: newPin
      })
    });
    const updateData = await updateRes.json();
    
    test('POST config actualiza PIN', updateRes.ok,
      `Status: ${updateRes.status}`);
    test('Config devuelve nuevo PIN', updateData.config?.qr_pin === newPin,
      `PIN: ${updateData.config?.qr_pin}`);

    // Test 3: Verificar que el PIN se guardó
    console.log('\n📋 Test 3: Verificar persistencia del PIN');
    const verifyRes = await fetchWithAgent('https://localhost:3000/api/config');
    const verifyConfig = await verifyRes.json();
    
    test('GET config devuelve PIN actualizado', verifyConfig.qr_pin === newPin,
      `PIN guardado: ${verifyConfig.qr_pin}`);

    // Test 4: Generar QR con configuración actual
    console.log('\n📋 Test 4: Generación de QR con PIN configurado');
    const qrRes = await fetchWithAgent('https://localhost:3000/api/qr/current');
    const qrData = await qrRes.json();
    
    test('QR se genera correctamente', qrRes.ok && qrData.qrDataURL,
      `QR generado: ${qrData.qrDataURL ? 'Sí' : 'No'}`);
    test('QR tiene token JWT', qrData.token && qrData.token.length > 0,
      `Token length: ${qrData.token?.length || 0}`);
    test('QR tiene duración configurada', qrData.expiraEn > 0,
      `Expira en: ${qrData.expiraEn}s`);

    // Test 5: Validar fichaje con QR
    console.log('\n📋 Test 5: Validación de fichaje con QR');
    const validateRes = await fetchWithAgent('https://localhost:3000/api/qr/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: qrData.token,
        userId: 3,
        tipo: 'ENTRADA'
      })
    });
    const validateData = await validateRes.json();
    
    test('Validación de QR exitosa', validateRes.ok,
      `Status: ${validateRes.status}`);
    test('Fichaje registrado con tipo correcto', validateData.tipo === 'ENTRADA',
      `Tipo: ${validateData.tipo}`);
    test('Fichaje indica método QR', validateData.metodo === 'QR',
      `Método: ${validateData.metodo}`);

    // Test 6: Verificar validación de entrada/salida
    console.log('\n📋 Test 6: Validación de secuencia entrada/salida');
    const validateRes2 = await fetchWithAgent('https://localhost:3000/api/qr/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: qrData.token,
        userId: 3,
        tipo: 'ENTRADA'
      })
    });
    const validateData2 = await validateRes2.json();
    
    test('Bloquea ENTRADA duplicada', !validateRes2.ok && validateData2.error,
      `Error: ${validateData2.error?.substring(0, 50)}...`);
    test('Mensaje sugiere SALIDA', validateData2.requiredType === 'SALIDA',
      `Required: ${validateData2.requiredType}`);

    // Test 7: Permitir SALIDA después de ENTRADA
    console.log('\n📋 Test 7: Permitir SALIDA después de ENTRADA');
    // Generar nuevo QR para evitar token expirado
    const qrRes2 = await fetchWithAgent('https://localhost:3000/api/qr/current');
    const qrData2 = await qrRes2.json();
    
    const salidaRes = await fetchWithAgent('https://localhost:3000/api/qr/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: qrData2.token,
        userId: 3,
        tipo: 'SALIDA'
      })
    });
    const salidaData = await salidaRes.json();
    
    test('Permite SALIDA después de ENTRADA', salidaRes.ok,
      `Status: ${salidaRes.status}`);
    test('Fichaje SALIDA registrado', salidaData.tipo === 'SALIDA',
      `Tipo: ${salidaData.tipo}`);

    // Test 8: Endpoint de último fichaje
    console.log('\n📋 Test 8: Endpoint de último fichaje');
    const lastLogRes = await fetchWithAgent('https://localhost:3000/api/last-log/3');
    const lastLog = await lastLogRes.json();
    
    test('Endpoint last-log responde', lastLogRes.ok,
      `Status: ${lastLogRes.status}`);
    test('Devuelve último fichaje', lastLog && lastLog.tipo,
      `Último: ${lastLog?.tipo} - ${lastLog?.fecha}`);
    test('Último fichaje es SALIDA', lastLog.tipo === 'SALIDA',
      `Tipo: ${lastLog.tipo}`);

    // Test 9: Restaurar PIN a 1234
    console.log('\n📋 Test 9: Restaurar PIN por defecto');
    const restoreRes = await fetchWithAgent('https://localhost:3000/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: config.lat,
        lon: config.lon,
        maxDistance: config.maxDistance,
        address: config.address,
        metodo_fichaje: config.metodo_fichaje,
        qr_duracion: config.qr_duracion,
        qr_pin: '1234'
      })
    });
    const restoreData = await restoreRes.json();
    
    test('PIN restaurado a 1234', restoreData.config?.qr_pin === '1234',
      `PIN: ${restoreData.config?.qr_pin}`);

    // Resumen final
    console.log('\n' + '═'.repeat(60));
    console.log('📊 RESUMEN DE PRUEBAS:');
    console.log(`   Total: ${testResults.total}`);
    console.log(`   ✅ Pasadas: ${testResults.passed}`);
    console.log(`   ❌ Fallidas: ${testResults.failed}`);
    
    const percentage = Math.round((testResults.passed / testResults.total) * 100);
    console.log(`   📈 Éxito: ${percentage}%`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 ¡TODAS LAS PRUEBAS PASARON! Sistema QR con PIN configurable funcionando correctamente.');
    } else {
      console.log('\n⚠️  Algunas pruebas fallaron. Revisar implementación.');
    }
    
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('\n❌ Error ejecutando pruebas:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   💡 Asegúrate de que el servidor esté corriendo en https://localhost:3000');
    }
  }
}

// Ejecutar pruebas con delay para que el servidor inicie
setTimeout(() => {
  runTests().then(() => {
    console.log('\n✓ Pruebas completadas\n');
    process.exit(0);
  });
}, 2000);
