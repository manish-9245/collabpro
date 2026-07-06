const { execSync } = require('child_process');

async function run() {
    try {
        const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
        
        const query = `
        query {
          user(login: "manish-9245") {
            projectV2(number: 7) {
              id
              title
              fields(first: 20) {
                nodes {
                  ... on ProjectV2Field {
                    id
                    name
                  }
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        }`;

        const response = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "node-fetch"
            },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${await response.text()}`);
        }

        const json = await response.json();
        console.log("PROJECT METADATA:");
        console.log(JSON.stringify(json, null, 2));

    } catch (err) {
        console.error("Failed to inspect Project #7:", err);
    }
}

run();
