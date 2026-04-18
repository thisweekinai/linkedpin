const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
const templatePath = path.resolve(__dirname, '../extension/manifest.template.json');
const outputPath = path.resolve(__dirname, '../extension/manifest.json');

// Read .env.local
let env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) {
      env[key.trim()] = value.trim();
    }
  });
} else {
  console.error('.env.local not found! Please create one based on .env.example');
  process.exit(1);
}

// Read template
let template = fs.readFileSync(templatePath, 'utf8');

// Replace placeholders
const clientId = env.GOOGLE_CLIENT_ID;
if (!clientId) {
  console.error('GOOGLE_CLIENT_ID not found in .env.local');
  process.exit(1);
}

const result = template.replace('__GOOGLE_CLIENT_ID__', clientId);

// Write result
fs.writeFileSync(outputPath, result);
console.log('Successfully generated extension/manifest.json');
