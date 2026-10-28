# Official A2UI v1.0 Specification Schemas and Fixtures

## Provenance
- **Upstream Repository:** `https://github.com/a2ui-project/a2ui`
- **Specification Commit:** `059b8d34874f96c0395dbfe23e6cc8b41cdb0f87`
- **Retrieved:** October 2026
- **License:** Apache License 2.0 (as licensed in upstream repository)

## Contained Files
1. `catalog_definition.json`
   - Source: `specification/v1_0/json/catalog_definition.json`
   - Role: Normative meta-schema for validating A2UI v1.0 catalog definitions (`catalog.json`).
   - JSON Schema Dialect: JSON Schema Draft 2020-12 (`https://json-schema.org/draft/2020-12/schema`).
   - Identifiers: `$id: "https://a2ui.org/specification/v1_0/catalog_definition.json"`

2. `common_types.json`
   - Source: `specification/v1_0/json/common_types.json`
   - Role: Canonical shared types including `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DataBinding`, `FunctionCall`, `Action`, `Checkable`.
   - Identifiers: `$id: "https://a2ui.org/specification/v1_0/common_types.json"`

3. `agent_to_renderer.json`
   - Source: `specification/v1_0/json/agent_to_renderer.json`
   - Role: Normative message envelope schema for Agent-to-Renderer protocol messages.

4. `renderer_to_agent.json`
   - Source: `specification/v1_0/json/renderer_to_agent.json`
   - Role: Normative message envelope schema for Renderer-to-Agent protocol messages.

5. `basic_catalog.json`
   - Source: `catalogs/basic/v1/catalog.json`
   - Role: Reference catalog implementation validating against `catalog_definition.json`.
