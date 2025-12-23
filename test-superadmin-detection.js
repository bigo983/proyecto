// Test rápido para verificar detección de superadmin
const testCases = [
  { host: 'superadmin.agendaloya.es', expected: true },
  { host: 'demo.agendaloya.es', expected: false },
  { host: 'agendaloya.es', expected: false },
  { host: 'localhost', query: '?superadmin=1', expected: true },
  { host: 'localhost', query: '', expected: false }
];

function isSuperAdminSubdomain(host, query = '') {
  const hostWithoutPort = host.split(':')[0].toLowerCase();
  const parts = hostWithoutPort.split('.');
  const isCustomDomain = parts.length >= 2 && (parts[parts.length-2] + '.' + parts[parts.length-1]) === 'agendaloya.es';
  const firstPart = parts.length > 0 ? parts[0] : '';
  
  const hasSuperadminQuery = query.includes('superadmin=1');
  return (isCustomDomain && firstPart === 'superadmin') || (hostWithoutPort === 'localhost' && hasSuperadminQuery);
}

console.log('\n🧪 Testing superadmin detection:\n');
testCases.forEach(test => {
  const result = isSuperAdminSubdomain(test.host, test.query || '');
  const status = result === test.expected ? '✅' : '❌';
  console.log(`${status} ${test.host}${test.query || ''} => ${result} (expected: ${test.expected})`);
});
console.log('');
