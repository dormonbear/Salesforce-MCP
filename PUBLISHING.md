# Publishing Guide

## Package Overview

This project publishes 3 npm packages in the `@dormon` scope:

| Package | Path | Description |
|---------|------|-------------|
| `@dormon/mcp-provider-api` | `packages/mcp-provider-api` | Provider API definitions and interfaces |
| `@dormon/mcp-provider-dx-core` | `packages/mcp-provider-dx-core` | Core Salesforce DX tools provider |
| `@dormon/salesforce-mcp` | `packages/mcp` | MCP server entry point (CLI binary) |

**MCP Server Name**: `sf-mcp-server-enhanced`
**CLI Binary**: `sf-mcp-server-enhanced`
**Current Version**: `0.0.1` (all packages)

## Prerequisites

1. npm account with `@dormon` scope ownership
2. Node.js >= 20.0.0
3. Salesforce CLI (`sf`) installed for E2E testing

```bash
# Login to npm
npm login

# Verify scope access
npm whoami
npm access list packages @dormon
```

## Publishing Steps

Packages must be published in dependency order:

### Step 1: Publish `@dormon/mcp-provider-api`

```bash
cd packages/mcp-provider-api
yarn build
npm publish --access public
```

### Step 2: Publish `@dormon/mcp-provider-dx-core`

```bash
cd packages/mcp-provider-dx-core
yarn build
npm publish --access public
```

### Step 3: Publish `@dormon/salesforce-mcp`

```bash
cd packages/mcp
yarn build
npm publish --access public
```

### Quick Publish (all packages)

```bash
# From repo root
for pkg in mcp-provider-api mcp-provider-dx-core mcp; do
  echo "Publishing packages/$pkg..."
  (cd "packages/$pkg" && yarn build && npm publish --access public)
done
```

## Version Bump

When releasing a new version, update all 3 packages in sync:

```bash
# Example: bump to 1.1.0
for pkg in mcp-provider-api mcp-provider-dx-core mcp; do
  (cd "packages/$pkg" && npm version 1.1.0 --no-git-tag-version)
done

# Also update internal dependency versions
# packages/mcp-provider-dx-core/package.json -> @dormon/mcp-provider-api
# packages/mcp/package.json -> @dormon/mcp-provider-api, @dormon/mcp-provider-dx-core
```

## Verify After Publishing

```bash
# Test install
npx @dormon/salesforce-mcp --version

# Test with a real org
npx @dormon/salesforce-mcp --orgs DEFAULT_TARGET_ORG --toolsets all
```

## MCP Client Configurations

### VS Code (Copilot)

Create or update `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp",
              "--orgs", "DEFAULT_TARGET_ORG",
              "--toolsets", "orgs,metadata,data,users",
              "--tools", "run_apex_test",
              "--allow-non-ga-tools"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp",
               "--orgs", "DEFAULT_TARGET_ORG",
               "--toolsets", "orgs,metadata,data,users",
               "--tools", "run_apex_test",
               "--allow-non-ga-tools"]
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp",
               "--orgs", "DEFAULT_TARGET_ORG",
               "--toolsets", "orgs,metadata,data,users",
               "--allow-non-ga-tools"]
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp@latest",
              "--orgs", "DEFAULT_TARGET_ORG",
              "--toolsets", "orgs,metadata,data,users",
              "--allow-non-ga-tools"]
    }
  }
}
```

### Cline

Edit `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp@latest",
              "--orgs", "DEFAULT_TARGET_ORG",
              "--toolsets", "orgs,metadata,data,users",
              "--allow-non-ga-tools"]
    }
  }
}
```

## Multi-Org Permissions (Environment Variable)

Set per-org permission levels via `ORG_PERMISSIONS` environment variable:

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@dormon/salesforce-mcp",
               "--orgs", "prod-org@example.com,dev-org@example.com",
               "--toolsets", "all"],
      "env": {
        "ORG_PERMISSIONS": "prod-org@example.com=read-only,dev-org@example.com=full-access"
      }
    }
  }
}
```

Permission levels:
- `read-only` — Only read operations allowed (queries, describe, list)
- `full-access` — All operations allowed
- `approval-required` — Destructive operations require confirmation

## MCP Registry (Optional)

After npm publishing, optionally register on the MCP ecosystem:

### mcp-publisher CLI

```bash
npx @anthropic-ai/mcp-publisher validate
npx @anthropic-ai/mcp-publisher publish
```

### Smithery.ai

Visit https://smithery.ai and submit the npm package for listing.

## Dependencies Note

The published packages depend on official `@salesforce/*` npm packages (code-analyzer, devops, mobile-web, lwc-experts, aura-experts, scale-products, metadata-enrichment). These are pulled from npm at install time — no code from those packages is modified or bundled.

The two `@dormon/*` provider packages (`mcp-provider-api` and `mcp-provider-dx-core`) contain the fork's modifications and must be published first.

## License

Apache-2.0. Original copyright Salesforce, Inc. Fork modifications copyright Dormon Zhou. See [LICENSE.txt](/LICENSE.txt).
