const fs = require("fs");
const path = require("path");

function detectProvider(url) {
  if (!url) return "postgresql"; // default fallback
  if (url.startsWith("file:") || url.startsWith("sqlite:") || url.includes("dev.db")) {
    return "sqlite";
  }
  if (url.startsWith("mysql://")) {
    return "mysql";
  }
  return "postgresql";
}

function main() {
  console.log("[db-prep] Checking database provider configuration...");
  
  // Load .env if present
  let databaseUrl = process.env.DATABASE_URL;
  const envPath = path.join(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const match = envContent.match(/^DATABASE_URL\s*=\s*["']?([^"'\r\n]+)/m);
    if (match) {
      databaseUrl = match[1];
    }
  }

  const provider = detectProvider(databaseUrl);
  console.log(`[db-prep] Detected database provider: "${provider}"`);

  const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
  if (!fs.existsSync(schemaPath)) {
    console.error("[db-prep] schema.prisma not found.");
    process.exit(1);
  }

  let schema = fs.readFileSync(schemaPath, "utf-8");
  
  // Replace the provider in the datasource block
  const updatedSchema = schema.replace(
    /(datasource\s+db\s*\{\s*provider\s*=\s*")([^"]+)("\s*\})/g,
    `$1${provider}$3`
  );

  if (schema !== updatedSchema) {
    fs.writeFileSync(schemaPath, updatedSchema, "utf-8");
    console.log(`[db-prep] Updated prisma/schema.prisma to use provider "${provider}"`);
    
    // Regenerate Prisma Client to apply schema provider changes
    try {
      const { execSync } = require("child_process");
      console.log("[db-prep] Regenerating Prisma Client...");
      execSync("npx prisma generate", { stdio: "inherit" });
    } catch (e) {
      console.error("[db-prep] Failed to generate Prisma client:", e.message);
    }
  } else {
    console.log(`[db-prep] prisma/schema.prisma is already configured for provider "${provider}"`);
  }
}

main();
