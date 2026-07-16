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

  // IDs from our config
  const serviceId = "43203e87-dd14-4be6-9177-792a51a7740b";
  const environmentId = "09054681-27b0-4674-9652-c82b78becb68";

  console.log(`Using Service ID: ${serviceId}`);
  console.log(`Using Environment ID: ${environmentId}`);

  // GraphQL Mutation
  const mutation = `
    mutation serviceInstanceUpdate(
      $serviceId: String!,
      $environmentId: String!,
      $input: ServiceInstanceUpdateInput!
    ) {
      serviceInstanceUpdate(
        serviceId: $serviceId,
        environmentId: $environmentId,
        input: $input
      )
    }
  `;

  const variables = {
    serviceId,
    environmentId,
    input: {
      startCommand: null
    }
  };

  console.log('Sending request to Railway API...');
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query: mutation,
      variables
    })
  });

  const result = await response.json();
  console.log('Response:', JSON.stringify(result, null, 2));

  if (result.errors) {
    console.error('Mutation failed!');
    process.exit(1);
  } else {
    console.log('Successfully set start command for MinIO service!');
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
