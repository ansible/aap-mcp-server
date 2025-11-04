#!/usr/bin/env tsx

import OASNormalize from "oas-normalize";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Script to fetch and convert the AWX Controller schema from Swagger2 to OpenAPI format
 *
 * This script:
 * 1. Fetches the schema from the AWX public CI files
 * 2. Uses oas-normalize to convert from Swagger2 to OpenAPI 3.x format
 * 3. Saves the converted schema to data/controller-schema.json
 */

const CONTROLLER_SCHEMA_URL =
  "https://s3.amazonaws.com/awx-public-ci-files/devel/schema.json";
const OUTPUT_PATH = join(process.cwd(), "data", "controller-schema.json");

async function updateControllerSchema(): Promise<void> {
  try {
    console.log("🔄 Fetching Controller schema from:", CONTROLLER_SCHEMA_URL);

    // Fetch the Swagger2 schema
    const response = await fetch(CONTROLLER_SCHEMA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const swagger2Schema = await response.json();
    console.log("✅ Successfully fetched Swagger2 schema");
    console.log(
      `📊 Schema info: ${swagger2Schema.info?.title || "Unknown"} v${swagger2Schema.info?.version || "Unknown"}`,
    );

    // Normalize/convert to OpenAPI format
    console.log("🔄 Converting Swagger2 to OpenAPI format...");
    const oas = new OASNormalize(swagger2Schema, {
      enablePaths: true,
      colorizeErrors: true,
    });
    const openApiSchema = await oas.convert().bundle();

    console.log("✅ Successfully converted to OpenAPI format");
    console.log(`📝 OpenAPI version: ${openApiSchema.openapi || "Unknown"}`);

    // Write to output file
    console.log("💾 Writing converted schema to:", OUTPUT_PATH);
    writeFileSync(OUTPUT_PATH, JSON.stringify(openApiSchema, null, 2), "utf8");

    console.log("✅ Controller schema update completed successfully!");
    console.log(`📁 Output file: ${OUTPUT_PATH}`);

    // Display some stats
    const pathCount = Object.keys(openApiSchema.paths || {}).length;
    const componentCount = Object.keys(
      openApiSchema.components?.schemas || {},
    ).length;
    console.log(`📈 Statistics:`);
    console.log(`   - API Paths: ${pathCount}`);
    console.log(`   - Schema Components: ${componentCount}`);
  } catch (error) {
    console.error("❌ Error updating Controller schema:", error);

    if (error instanceof Error) {
      console.error("Error message:", error.message);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
    }

    process.exit(1);
  }
}

console.log("a");
await updateControllerSchema();
