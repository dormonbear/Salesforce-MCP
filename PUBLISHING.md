# Publishing Guide

## Package Overview

This project publishes 3 npm packages in the `@dormon` scope:

| Package | Path | Description |
|---------|------|-------------|
| `@dormon/mcp-provider-api` | `packages/mcp-provider-api` | Provider API definitions and interfaces |
| `@dormon/mcp-provider-dx-core` | `packages/mcp-provider-dx-core` | Core Salesforce DX tools provider |
| `@dormon/salesforce-mcp` | `packages/mcp` | MCP server entry point (CLI binary) |

**CLI Binaries**: `dormon-salesforce-mcp`, `salesforce-mcp`, `sf-mcp-server-enhanced`

## Installation

### npx (recommended for MCP clients)

```bash
# Use -p flag to specify the package, then the bin name separately
npx -y -p @dormon/salesforce-mcp dormon-salesforce-mcp --orgs YOUR_ORG --toolsets all
```

> **Why `-p` flag?** npx doesn't auto-resolve bin names for scoped packages (`@dormon/...`).
> And `salesforce-mcp` conflicts with an existing npm package. Use `dormon-salesforce-mcp` as the bin name.

### Global install

```bash
npm install -g @dormon/salesforce-mcp
dormon-salesforce-mcp --orgs YOUR_ORG --toolsets all
```

### Claude Code CLI

```bash
claude mcp add salesforce-dx -- npx -y -p @dormon/salesforce-mcp dormon-salesforce-mcp --orgs YOUR_ORG --toolsets all --allow-non-ga-tools
```

## Prerequisites

1. npm account with `@dormon` scope ownership
2. Node.js >= 20.0.0
3. Salesforce CLI (`sf`) installed for E2E testing
4. GitHub secret `NPM_TOKEN` set to an **Automation** type npm token (bypasses 2FA)

```bash
# Login to npm
npm login

# Verify scope access
npm whoami
npm access list packages @dormon
```

## Publishing (Automated via CI)

Push a version tag to trigger the publish workflow:

```bash
git tag v0.0.5
git push origin v0.0.5
```

The `.github/workflows/publish-dormon.yml` workflow will:
1. Bump all package versions to match the tag
2. Build all packages with `tsconfig.publish.json`
3. Publish in dependency order: api → dx-core → mcp
4. Commit version bump back to main
5. Create a GitHub Release

### Manual Publishing

Packages must be published in dependency order:

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
# Test npx invocation
npx -y -p @dormon/salesforce-mcp dormon-salesforce-mcp --help

# Test with a real org
npx -y -p @dormon/salesforce-mcp dormon-salesforce-mcp --orgs DEFAULT_TARGET_ORG --toolsets all
```

## MCP Client Configurations

### Claude Code

Add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp",
               "dormon-salesforce-mcp",
               "--orgs", "YOUR_ORG",
               "--toolsets", "all",
               "--allow-non-ga-tools"]
    }
  }
}
```

### VS Code (Copilot)

Create or update `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp",
               "dormon-salesforce-mcp",
               "--orgs", "YOUR_ORG",
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
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp",
               "dormon-salesforce-mcp",
               "--orgs", "YOUR_ORG",
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
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp@latest",
               "dormon-salesforce-mcp",
               "--orgs", "YOUR_ORG",
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
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp@latest",
               "dormon-salesforce-mcp",
               "--orgs", "YOUR_ORG",
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
    "salesforce-dx": {
      "command": "npx",
      "args": ["-y", "-p", "@dormon/salesforce-mcp",
               "dormon-salesforce-mcp",
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

## Troubleshooting

### `npx @dormon/salesforce-mcp` shows "npm run-script" help

npx can't auto-resolve bin names for scoped packages. Use the `-p` flag:
```bash
npx -y -p @dormon/salesforce-mcp dormon-salesforce-mcp --help
```

### `npx salesforce-mcp` runs a different package

There's an unrelated `salesforce-mcp` package on npm. Use `dormon-salesforce-mcp` as the bin name.

### eslint errors on fresh install

Some `@salesforce/mcp-provider-*` packages bundle eslint as a transitive dependency. This is expected and doesn't affect functionality.

## License

Apache-2.0. Original copyright Salesforce, Inc. Fork modifications copyright Dormon Zhou. See [LICENSE.txt](/LICENSE.txt).
