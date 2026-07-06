const { execSync } = require('child_process');

async function run() {
    console.log("==================================================================");
    console.log("📊 CollabPro GitHub Projects V2 Board Populator");
    console.log("==================================================================");

    // 1. Get the gh auth token
    let token;
    try {
        token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
        console.log("🔑 GitHub Token successfully retrieved.");
    } catch (err) {
        console.error("❌ Error: Could not retrieve GitHub token using 'gh auth token'.");
        console.error("Please run: gh auth login");
        process.exit(1);
    }

    const owner = "manish-9245";
    const repo = "collabpro";
    const projectNumber = 7;

    async function graphqlRequest(query, variables = {}) {
        const response = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "collabpro-setup"
            },
            body: JSON.stringify({ query, variables })
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`GraphQL HTTP Error: ${response.status} ${response.statusText} - ${text}`);
        }
        const json = await response.json();
        if (json.errors) {
            // Check for scope errors
            const hasScopeError = json.errors.some(e => e.type === "INSUFFICIENT_SCOPES" || e.message.includes("scope"));
            if (hasScopeError) {
                console.error("\n🔒 ERROR: INSUFFICIENT SCOPES detected on your GitHub CLI token.");
                console.error("GitHub Projects V2 API requires the 'project' scope (or 'read:project'/'write:project').");
                console.error("\n👉 HOW TO FIX THIS:");
                console.error("1. In your local terminal, run the following command to refresh your CLI scopes:");
                console.error("   gh auth refresh -s read:org,repo,workflow,project");
                console.error("\n2. Once authenticated, rerun this script:");
                console.error("   node scripts/populate_project_7.js");
                console.error("\nAlternatively, you can create a Personal Access Token (classic) with 'project' and 'repo' scopes, and run:");
                console.error("   GITHUB_TOKEN=your_pat_token node scripts/populate_project_7.js\n");
                process.exit(0); // Soft exit with guidance
            }
            throw new Error(`GraphQL API Error:\n${JSON.stringify(json.errors, null, 2)}`);
        }
        return json.data;
    }

    try {
        // 2. Fetch Project Metadata & Status Fields
        console.log(`🔍 Querying Project #${projectNumber} for user "${owner}"...`);
        const projectQuery = `
        query($login: String!, $number: Int!) {
          user(login: $login) {
            projectV2(number: $number) {
              id
              title
              fields(first: 50) {
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

        const projectData = await graphqlRequest(projectQuery, { login: owner, number: projectNumber });
        const project = projectData.user?.projectV2;
        if (!project) {
            throw new Error(`Project #${projectNumber} not found under user "${owner}". Make sure the project is created.`);
        }

        console.log(`✅ Connected to Project: "${project.title}" (ID: ${project.id})`);

        // Find the "Status" field and its options
        const statusField = project.fields.nodes.find(f => f.name === "Status");
        if (!statusField) {
            console.error("⚠️  Warning: 'Status' field not found in this project. Available fields are:");
            project.fields.nodes.forEach(f => console.log(`- ${f.name}`));
            process.exit(1);
        }

        console.log(`✅ Found Status Field (ID: ${statusField.id}). Options:`);
        const statusOptions = {};
        statusField.options.forEach(opt => {
            statusOptions[opt.name.toLowerCase()] = opt.id;
            console.log(`   - "${opt.name}" (ID: ${opt.id})`);
        });

        // Map status options to readable states
        const todoId = statusOptions["todo"] || statusOptions["to do"] || statusField.options[0]?.id;
        const inProgressId = statusOptions["in progress"] || statusOptions["doing"] || statusField.options[1]?.id;
        const doneId = statusOptions["done"] || statusField.options[2]?.id;
        const backlogId = statusOptions["backlog"] || todoId;

        // 3. Fetch all issues with their node IDs
        console.log(`\n🔍 Querying open issues for repo "${owner}/${repo}"...`);
        const issuesQuery = `
        query($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            issues(states: OPEN, first: 100) {
              nodes {
                id
                title
                milestone {
                  title
                }
              }
            }
          }
        }`;

        const repoData = await graphqlRequest(issuesQuery, { owner, name: repo });
        const issues = repoData.repository.issues.nodes;
        console.log(`✅ Retrieved ${issues.length} issues.`);

        // 4. Add issues to project board and set Status
        console.log("\n🚀 Adding items to the Project Board...");
        for (const issue of issues) {
            console.log(`- Processing issue: "${issue.title}"`);
            
            // Add issue to project
            const addMutation = `
            mutation($projectId: ID!, $contentId: ID!) {
              addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
                item {
                  id
                }
              }
            }`;

            const addResult = await graphqlRequest(addMutation, { projectId: project.id, contentId: issue.id });
            const itemId = addResult.addProjectV2ItemById.item.id;
            console.log(`  └ Added item to project. Item ID: ${itemId}`);

            // Map issue to a Status option based on milestone
            let targetStatusId = todoId;
            const milestoneTitle = issue.milestone?.title || "";
            if (milestoneTitle.includes("M1")) {
                // Milestone 1 issues can be In Progress
                targetStatusId = inProgressId;
            } else if (milestoneTitle.includes("M2")) {
                // Milestone 2 issues can be Todo
                targetStatusId = todoId;
            } else if (milestoneTitle.includes("M3") || milestoneTitle.includes("M4")) {
                // Milestones 3 & 4 can be in Backlog or Todo
                targetStatusId = backlogId;
            }

            if (targetStatusId) {
                // Update item status field value
                const updateFieldMutation = `
                mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
                  updateProjectV2ItemFieldValue(input: {
                    projectId: $projectId,
                    itemId: $itemId,
                    fieldId: $fieldId,
                    value: $value
                  }) {
                    projectV2Item {
                      id
                    }
                  }
                }`;

                await graphqlRequest(updateFieldMutation, {
                    projectId: project.id,
                    itemId,
                    fieldId: statusField.id,
                    value: { singleSelectOptionId: targetStatusId }
                });
                console.log(`  └ Status set successfully!`);
            }
        }

        console.log("\n==================================================================");
        console.log("🎉 SUCCESS! Project #7 has been fully populated with your issues!");
        console.log("==================================================================");

    } catch (err) {
        console.error("❌ Execution failed:", err.message);
    }
}

// Support manual token injection via environment variable
const envToken = process.env.GITHUB_TOKEN;
if (envToken) {
    // Override child_process exec
    global.execSync = () => envToken;
}

run();
