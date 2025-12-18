const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

// Generar certificado autofirmado
const pki = forge.pki;
const keys = pki.rsa.generateKeyPair(2048);
const cert = pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [{
  name: 'commonName',
  value: 'localhost'
}, {
  name: 'countryName',
  value: 'ES'
}, {
  shortName: 'ST',
  value: 'Madrid'
}, {
  name: 'localityName',
  value: 'Madrid'
}, {
  name: 'organizationName',
  value: 'FichaApp'
}, {
  shortName: 'OU',
  value: 'Development'
}];

cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([{
  name: 'basicConstraints',
  cA: true
}, {
  name: 'keyUsage',
  keyCertSign: true,
  digitalSignature: true,
  nonRepudiation: true,
  keyEncipherment: true,
  dataEncipherment: true
}, {
  name: 'extKeyUsage',
  serverAuth: true,
  clientAuth: true,
  codeSigning: true,
  emailProtection: true,
  timeStamping: true
}, {
  name: 'nsCertType',
  server: true,
  client: true,
  email: true,
  objsign: true,
  sslCA: true,
  emailCA: true,
  objCA: true
}, {
  name: 'subjectAltName',
  altNames: [{
    type: 2,
    value: 'localhost'
  }, {
    type: 7,
    ip: '127.0.0.1'
  }, {
    type: 7,
    ip: '10.77.167.16'
  }]
}]);

cert.sign(keys.privateKey, forge.md.sha256.create());

const pemCert = pki.certificateToPem(cert);
const pemKey = pki.privateKeyToPem(keys.privateKey);

// Guardar certificados
const certDir = path.join(__dirname, 'ssl');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir);
}

fs.writeFileSync(path.join(certDir, 'cert.pem'), pemCert);
fs.writeFileSync(path.join(certDir, 'key.pem'), pemKey);

console.log('✓ Certificados SSL generados en ./ssl/');
