const fs = require('fs');
const path = require('path');

async function run() {
  const configPath = path.join(process.env.HOME, '.railway/config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Railway CLI config file not found at:', configPath);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = config?.user?.token;
  if (!token) {
    console.error('No token found in Railway CLI config');
    process.exit(1);
  }

  const serviceId = "43203e87-dd14-4be6-9177-792a51a7740b";
  const environmentId = "09054681-27b0-4674-9652-c82b78becb68";

  const query = `
    query serviceInstance($serviceId: String!, $environmentId: String!) {
      serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
        startCommand
        source {
          image
        }
      }
    }
  `;

  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      variables: { serviceId, environmentId }
    })
  });

  const result = await response.json();
  console.log('Response:', JSON.stringify(result, null, 2));
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
