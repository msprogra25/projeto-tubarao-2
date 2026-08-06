const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

if (!packageJson.dependencies || !packageJson.dependencies.next) {
  console.error('Erro: next não encontrado em dependencies.');
  process.exit(1);
}

console.log('Build de vercel simulado. Dependência next detectada.');
process.exit(0);
