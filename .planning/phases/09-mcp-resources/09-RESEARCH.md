# Phase 9: MCP Resources - Research

**Researched:** 2026-04-11
**Domain:** MCP Resources protocol — org discoverability for LLM agents
**Confidence:** HIGH

## Summary

Phase 9 wires MCP Resources into the Salesforce MCP Server so LLM agents can discover authenticated orgs and their permission levels without calling tools. The infrastructure is already 80% in place: `McpResource` and `McpResourceTemplate` abstract base classes exist in `mcp-provider-api`, the `McpProvider.provideResources()` method is defined (returning empty arrays), and the server already declares `resources: {}` capability at startup. The missing pieces are: (1) a `registerResourcesFromProviders()` function in `registry-utils.ts` that calls `provideResources()` and wires results to `server.resource()` / `server.registerResource()`, and (2) concrete resource implementations in `mcp-provider-dx-core` that return org list and per-org permissions.

The SDK (v1.18.2) fully supports both static resources (`server.registerResource(name, uri, config, readCallback)`) and resource templates (`server.registerResource(name, resourceTemplate, config, readCallback)`). Critically, the SDK invokes the `readCallback` on every `resources/read` request -- it does NOT cache the result. This means Success Criterion 4 ("return current data on each read") is satisfied by default as long as the callback fetches live data from `OrgService` rather than caching at registration time.

**Primary recommendation:** Implement one static resource (`salesforce://orgs`) for the org list and one resource template (`salesforce://orgs/{orgName}/permissions`) for per-org permission levels. Wire them through `registry-utils.ts` following the exact same provider-loop pattern used for tools.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | MCP Resources expose authenticated org list as a discoverable resource | Static resource at `salesforce://orgs` returns `OrgService.getAllowedOrgs()` data on each read |
| DISC-02 | MCP Resources expose per-org permission levels as a discoverable resource | Resource template at `salesforce://orgs/{orgName}/permissions` returns read/write/execute levels from `orgPermissions` Map + `tool-categories.ts` |
| DISC-03 | `registry-utils.ts` wires `provideResources()` from providers to `server.registerResource()` | New `registerResourcesFromProviders()` function mirrors `createToolRegistryFromProviders()` pattern |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `~/.claude/CLAUDE.md` (global instructions):

- **Language:** English for code/comments; respond in Chinese
- **Code style:** Concise comments only for complex logic; no author attribution
- **File size:** 200-400 lines typical, 800 max per file
- **Organization:** Feature/domain, not by type; high cohesion, low coupling
- **Testing:** TDD; 80% minimum coverage; unit tests for utilities, integration for APIs, E2E for critical flows
- **Security:** No hardcoded secrets; validate all inputs; parameterized queries only
- **Git:** Conventional commits; never commit to main directly; run tests before commit
- **No console.log in production code**
- **Immutability preferred** -- avoid mutating objects or arrays
- **Salesforce CLI:** Always add `--json` flag

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.18.2 | MCP server with resource registration API | Already installed; `registerResource()`, `ResourceTemplate` class, `ReadResourceCallback` type all available [VERIFIED: node_modules inspection] |
| @salesforce/mcp-provider-api | 0.6.0 | Abstract `McpResource`, `McpResourceTemplate` base classes | Already defines the provider API contract [VERIFIED: source code] |
| zod | 3.25.76 | Schema validation (if needed for resource data) | Already a dependency [VERIFIED: package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| mocha | 11.7.2 | Test framework (mcp package) | Unit tests for resource wiring and resource implementations |
| chai | 4.3.10 | Assertion library | All test assertions |
| sinon | 10.0.0 | Mocking/stubbing | Mock OrgService in resource read tests |
| @modelcontextprotocol/sdk Client | 1.18.2 | `client.listResources()`, `client.readResource()` | E2E tests verifying resource discovery |

**No new dependencies required.** [VERIFIED: all packages already in package.json]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom URI scheme `salesforce://` | `file://` or `https://` scheme | Custom scheme is correct per MCP spec -- these are not web-fetchable or filesystem resources [CITED: https://modelcontextprotocol.io/specification/2025-06-18/server/resources] |
| Resource Template for permissions | Static resources per-org (one per org) | Template is cleaner; the `list` callback can enumerate all orgs dynamically; avoids N registration calls at startup |
| One combined resource (orgs+permissions) | Separate resources | Separate resources follow MCP best practice of granular, focused resources; org list is a quick overview, permissions is detailed per-org |

## Architecture Patterns

### Recommended Project Structure

```
packages/mcp-provider-dx-core/src/
  resources/
    org-list-resource.ts          # McpResource: salesforce://orgs
    org-permissions-resource.ts   # McpResourceTemplate: salesforce://orgs/{orgName}/permissions

packages/mcp/src/utils/
  registry-utils.ts               # Add registerResourcesFromProviders()
```

### Pattern 1: Resource Wiring (DISC-03)

**What:** A new `registerResourcesFromProviders()` function that mirrors the existing `createToolRegistryFromProviders()` pattern.
**When to use:** Called from `index.ts` after `registerToolsets()`, before `server.connect(transport)`.

The wiring function iterates over all providers in `MCP_PROVIDER_REGISTRY`, calls `provideResources(services)` on each, and registers the results with the server.

**Key insight from SDK source:** [VERIFIED: mcp.js line 298-341]
- `server.registerResource(name, uri, config, readCallback)` registers a static resource (keyed by URI string)
- `server.registerResource(name, resourceTemplate, config, readCallback)` registers a template resource (keyed by name string)
- Both calls trigger `setResourceRequestHandlers()` on first invocation (lazy initialization)
- Both calls emit `sendResourceListChanged()` notification
- The `readCallback` is invoked fresh on every `resources/read` request -- **no server-side caching**

```typescript
// Source: Verified from existing createToolRegistryFromProviders() pattern in registry-utils.ts
import { McpResource, McpResourceTemplate } from '@salesforce/mcp-provider-api';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function registerResourcesFromProviders(
  providers: McpProvider[],
  services: Services,
  server: SfMcpServer
): Promise<void> {
  const resourcePromises = providers.map(provider => {
    validateMcpProviderVersion(provider);
    return provider.provideResources(services);
  });

  const allResources = (await Promise.all(resourcePromises)).flat();

  for (const resource of allResources) {
    if (resource.kind === 'McpResource') {
      // Static resource: name, uri string, config, readCallback
      server.registerResource(
        resource.getName(),
        resource.getUri(),
        resource.getConfig(),
        (uri, extra) => resource.read(uri, extra)
      );
    } else {
      // Template resource: name, ResourceTemplate instance, config, readCallback
      server.registerResource(
        resource.getName(),
        resource.getTemplate(),
        resource.getConfig(),
        (uri, variables, extra) => resource.read(uri, variables, extra)
      );
    }
  }
}
```

### Pattern 2: Static Resource — Org List (DISC-01)

**What:** A concrete `McpResource` that returns the list of authenticated orgs.
**URI:** `salesforce://orgs`
**MIME type:** `application/json`

```typescript
// Source: Derived from McpResource abstract class in mcp-provider-api/src/resources.ts
import { McpResource } from '@salesforce/mcp-provider-api';
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { Services } from '@salesforce/mcp-provider-api';

export class OrgListResource extends McpResource {
  private services: Services;

  constructor(services: Services) {
    super();
    this.services = services;
  }

  getName(): string {
    return 'salesforce-orgs';
  }

  getUri(): string {
    return 'salesforce://orgs';
  }

  getConfig(): ResourceMetadata {
    return {
      description: 'List of authenticated Salesforce orgs available to this MCP server',
      mimeType: 'application/json',
    };
  }

  async read(): Promise<ReadResourceResult> {
    const orgs = await this.services.getOrgService().getAllowedOrgs();
    return {
      contents: [{
        uri: this.getUri(),
        mimeType: 'application/json',
        text: JSON.stringify(orgs, null, 2),
      }],
    };
  }
}
```

### Pattern 3: Resource Template — Per-Org Permissions (DISC-02)

**What:** A `McpResourceTemplate` that returns permission levels for a specific org.
**URI Template:** `salesforce://orgs/{orgName}/permissions`

The template needs access to both `orgPermissions` Map (from `SfMcpServerOptions`) and `tool-categories.ts` (for category classification). Since resources are provided by providers (which receive `Services`), the permission data needs to be accessible through `Services` or passed as constructor arguments.

**Design decision:** Extend the `Services` interface to expose org permission information, OR pass the permission map directly when constructing the resource in `mcp-provider-dx-core`.

**Recommended approach:** Since `OrgService` already exposes `getAllowedOrgs()`, add a new service method or pass permission data through a new service interface. Alternatively, the simpler approach: the resource implementation lives in `packages/mcp/src/` (not in `mcp-provider-dx-core`) because it needs access to `orgPermissions` which is a server-level concern, not a provider concern.

```typescript
// Source: Derived from McpResourceTemplate abstract class + SDK ResourceTemplate
import { McpResourceTemplate } from '@salesforce/mcp-provider-api';
import { ResourceTemplate, type ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

export class OrgPermissionsResource extends McpResourceTemplate {
  // ... receives orgPermissions, authorizedOrgs, toolCategoryMap

  getName(): string {
    return 'salesforce-org-permissions';
  }

  getTemplate(): ResourceTemplate {
    return new ResourceTemplate('salesforce://orgs/{orgName}/permissions', {
      list: async () => ({
        resources: authorizedOrgs.map(org => ({
          uri: `salesforce://orgs/${org}/permissions`,
          name: `${org}-permissions`,
          description: `Permission levels for org: ${org}`,
          mimeType: 'application/json',
        })),
      }),
      complete: {
        orgName: async () => [...authorizedOrgs],
      },
    });
  }

  getConfig(): ResourceMetadata {
    return {
      description: 'Permission levels (read/write/execute) for a specific Salesforce org',
      mimeType: 'application/json',
    };
  }

  async read(uri: URL, variables: Variables): Promise<ReadResourceResult> {
    const orgName = variables.orgName as string;
    // Compute permission levels per tool category
    const permissions = {
      org: orgName,
      permission: getOrgPermission(orgPermissions, orgName),
      categories: {
        read: canExecute(orgPermissions, orgName, 'read'),
        write: canExecute(orgPermissions, orgName, 'write'),
        execute: canExecute(orgPermissions, orgName, 'execute'),
      },
    };
    return {
      contents: [{
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(permissions, null, 2),
      }],
    };
  }
}
```

### Pattern 4: Where Resources Live — Provider vs Server

**Critical design decision:** The org list resource needs `OrgService` (available via `Services`), but the permissions resource needs `orgPermissions` Map (available only in `SfMcpServer`/`index.ts`).

**Option A: Both resources in mcp-provider-dx-core** (recommended for consistency)
- Add permission data to `Services` interface (new `getPermissionService()` method)
- `DxCoreMcpProvider.provideResources(services)` returns both resources
- Follows the same provider pattern as tools
- Requires adding to `mcp-provider-api` Services interface

**Option B: Resources registered directly in index.ts** (simpler but breaks pattern)
- Skip the provider pattern entirely
- Register resources directly on the server object in `index.ts`
- Avoids extending Services interface
- Does NOT satisfy DISC-03 ("registry-utils.ts calls provideResources()")

**Option C: Hybrid — org list in provider, permissions in server** (pragmatic)
- Org list resource goes through provider pattern (has access to OrgService)
- Permissions resource registered directly in index.ts (needs server-level orgPermissions)
- Partially satisfies DISC-03

**Recommendation: Option A.** DISC-03 explicitly requires `registry-utils.ts` to call `provideResources()` and wire the results. This means we need to extend `Services` to include permission data so providers can build permission-aware resources.

### Anti-Patterns to Avoid

- **Caching resource data at registration time:** The SDK calls `readCallback` on every `resources/read` — use this to return live data. Do NOT capture org list in a closure at startup and return stale data forever. [VERIFIED: SDK mcp.js line 228-246, callback invoked per-request]
- **Registering N static resources (one per org):** Use a ResourceTemplate with a `list` callback that enumerates dynamically. Adding/removing orgs at runtime would require re-registration otherwise.
- **Putting permissions resource in mcp-provider-dx-core without Services access:** The `canExecute()` function and `orgPermissions` Map live in `packages/mcp/src/utils/`. Either extend Services to expose them, or accept the coupling.
- **Using `file://` or `https://` scheme:** These are NOT web-fetchable or filesystem resources. Custom scheme `salesforce://` is correct per MCP spec guidance on URI schemes. [CITED: https://modelcontextprotocol.io/specification/2025-06-18/server/resources]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URI template matching | Custom regex parser | `ResourceTemplate` from SDK | SDK's `UriTemplate` class implements RFC 6570 with `match()` and `expand()` methods [VERIFIED: SDK uriTemplate.d.ts] |
| Resource list/read handlers | Manual `server.setRequestHandler()` | `server.registerResource()` high-level API | McpServer handles `ListResourcesRequestSchema`, `ReadResourceRequestSchema`, template matching automatically [VERIFIED: SDK mcp.js line 186-248] |
| Resource change notifications | Manual JSON-RPC notification | `server.sendResourceListChanged()` | SDK provides built-in method [VERIFIED: SDK mcp.d.ts line 152] |
| Org permission checking | Duplicate logic | Import `canExecute()` / `getOrgPermission()` from `org-permissions.ts` | Already tested and proven [VERIFIED: source code + existing tests] |

**Key insight:** The SDK's `registerResource()` method handles all protocol-level details (request routing, template variable extraction, error codes, list/read dispatching). Implementations only need to provide the `readCallback`.

## Common Pitfalls

### Pitfall 1: Stale Data from Closure Capture

**What goes wrong:** Resource callback captures org list at registration time; never refreshes.
**Why it happens:** Developer creates a variable `const orgs = await getAllOrgs()` then passes it to the callback closure, instead of calling `getAllOrgs()` inside the callback.
**How to avoid:** Always call `OrgService` methods inside the `readCallback`, not outside it.
**Warning signs:** Resources return the same data after org auth changes.

### Pitfall 2: ResourceTemplate list Callback Returns undefined

**What goes wrong:** SDK requires the `list` callback to be explicitly provided (even if `undefined`) in the `ResourceTemplate` constructor. Omitting it causes confusing errors.
**Why it happens:** The `ResourceTemplate` constructor signature is `new ResourceTemplate(uriTemplate, { list: ... })` where `list` is required to be specified but can be `undefined`. [VERIFIED: SDK mcp.d.ts line 176-186]
**How to avoid:** Always provide `{ list: listCallback }` — use `undefined` explicitly if you don't want enumeration.
**Warning signs:** `TypeError` or missing resources in `resources/list` response.

### Pitfall 3: URI Scheme Validation

**What goes wrong:** `new URL('salesforce://orgs')` works in Node.js but the URL object treats `orgs` as the host. `new URL('salesforce://orgs/prod/permissions')` parses `orgs` as host, `prod` as first path segment.
**Why it happens:** Node.js URL parser follows RFC 3986 which treats the part after `://` as authority.
**How to avoid:** Be aware of URL parsing behavior. The SDK passes `new URL(request.params.uri)` to the readCallback. Access the path via `url.pathname` or `url.href`. The ResourceTemplate's `match()` method handles variable extraction correctly regardless. [VERIFIED: SDK mcp.js line 229, `const uri = new URL(request.params.uri)`]
**Warning signs:** Variable extraction returns unexpected values in `readCallback`.

### Pitfall 4: SfMcpServer Extends McpServer — registerResource Inheritance

**What goes wrong:** `SfMcpServer` only overrides `registerTool()`. It does NOT override `registerResource()`. The inherited `McpServer.registerResource()` works correctly without middleware wrapping.
**Why it happens:** Resources are read-only by nature — they don't need the permission middleware, rate limiting, or telemetry wrapping that tools need.
**How to avoid:** Call `server.registerResource()` directly — it's inherited from `McpServer` and works as expected.
**Warning signs:** None — this is correct behavior.

### Pitfall 5: Extending Services Interface Requires Multi-Package Change

**What goes wrong:** Adding `getPermissionService()` to the `Services` interface in `mcp-provider-api` requires changes in both `mcp-provider-api/src/services.ts` and `packages/mcp/src/services.ts`.
**Why it happens:** The interface is defined in `mcp-provider-api` (consumed by providers) but implemented in `packages/mcp` (server).
**How to avoid:** Plan both changes together. The interface addition in `mcp-provider-api` and the implementation in `packages/mcp/src/services.ts` must be in the same plan wave.
**Warning signs:** TypeScript compilation errors in provider packages.

## Code Examples

### SDK registerResource() for Static Resource

```typescript
// Source: Verified from @modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts line 62
server.registerResource(
  'salesforce-orgs',                    // name
  'salesforce://orgs',                  // uri (string = static resource)
  {                                     // config (ResourceMetadata)
    description: 'Authenticated Salesforce orgs',
    mimeType: 'application/json',
  },
  async (uri: URL, extra) => ({        // readCallback (invoked per-request)
    contents: [{
      uri: uri.toString(),
      mimeType: 'application/json',
      text: JSON.stringify(await getOrgData()),
    }],
  })
);
```

### SDK registerResource() for Resource Template

```typescript
// Source: Verified from @modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts line 63
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

const template = new ResourceTemplate(
  'salesforce://orgs/{orgName}/permissions',
  {
    list: async () => ({
      resources: authorizedOrgs.map(org => ({
        uri: `salesforce://orgs/${org}/permissions`,
        name: `${org}-permissions`,
        mimeType: 'application/json',
      })),
    }),
    complete: {
      orgName: async (value: string) =>
        authorizedOrgs.filter(org => org.startsWith(value)),
    },
  }
);

server.registerResource(
  'salesforce-org-permissions',         // name
  template,                             // ResourceTemplate = template resource
  {                                     // config
    description: 'Per-org permission levels',
    mimeType: 'application/json',
  },
  async (uri: URL, variables, extra) => ({
    contents: [{
      uri: uri.toString(),
      mimeType: 'application/json',
      text: JSON.stringify({
        org: variables.orgName,
        permission: getOrgPermission(orgPermissions, variables.orgName as string),
      }),
    }],
  })
);
```

### ReadResourceResult Shape

```typescript
// Source: Verified from @modelcontextprotocol/sdk/dist/esm/types.d.ts
// ReadResourceResult = { contents: Array<{ uri: string, mimeType?: string, text: string } | { uri: string, mimeType?: string, blob: string }> }
const result: ReadResourceResult = {
  contents: [{
    uri: 'salesforce://orgs',
    mimeType: 'application/json',
    text: JSON.stringify([
      { username: 'user@example.com', orgId: '00D...', aliases: ['my-org'], isScratchOrg: false },
    ]),
  }],
};
```

### E2E Test Pattern — Resource Listing

```typescript
// Source: Derived from existing tool-registration.test.ts E2E pattern
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { DxMcpTransport } from '@salesforce/mcp-test-client';

const client = new Client({ name: 'test', version: '0.0.1' });
const transport = DxMcpTransport({ args: ['--orgs', 'ALLOW_ALL_ORGS', '--toolsets', 'all', '--no-telemetry'] });
await client.connect(transport);

// List resources
const { resources } = await client.listResources();
// Should include salesforce://orgs and any template-enumerated resources

// Read a specific resource
const result = await client.readResource({ uri: 'salesforce://orgs' });
// result.contents[0].text contains JSON org list
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No resource support | `resources: {}` capability already declared | Already in codebase | Registration wiring is the only missing piece |
| `provideResources()` returns `[]` | Concrete resource implementations needed | This phase | LLM agents can discover orgs without calling tools |
| Permission info only via tools | Permission info as MCP Resources | This phase | Reduces unnecessary tool calls for discovery |

**Deprecated/outdated:**
- Resource subscriptions (`subscribe: true`) are explicitly deferred per REQUIREMENTS.md Out of Scope. [VERIFIED: REQUIREMENTS.md line 58]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Custom URI scheme `salesforce://` is acceptable per MCP spec | Architecture Patterns | Low — spec explicitly allows custom schemes per RFC 3986; other servers use custom schemes |
| A2 | Extending `Services` interface is the right approach for exposing permission data to providers | Pattern 4 | Medium — could alternatively register permissions resource directly in server code without provider pattern, but this would not satisfy DISC-03 literally |
| A3 | `mcp-provider-dx-core` is the correct home for resource implementations | Architecture Patterns | Low — it's the primary provider; resources are Salesforce-org-specific |

## Open Questions

1. **Should permission data be exposed via Services or constructed at the server level?**
   - What we know: DISC-03 says registry-utils.ts calls provideResources(). This implies the provider pattern. But `orgPermissions` Map only exists in `SfMcpServer`.
   - What's unclear: Whether adding `orgPermissions` to Services is acceptable scope creep.
   - Recommendation: Add a lightweight `PermissionService` interface to `mcp-provider-api` Services. Implementation in `packages/mcp/src/services.ts` delegates to `orgPermissions` Map and `canExecute()`. This keeps the provider pattern intact.

2. **Should the org list resource use `getAllowedOrgs()` or `getAllowedOrgUsernames()`?**
   - What we know: `getAllowedOrgs()` returns `SanitizedOrgAuthorization[]` with rich data (username, instanceUrl, isScratchOrg, etc). `getAllowedOrgUsernames()` returns `Set<string>`.
   - What's unclear: What level of detail is useful for LLM agents.
   - Recommendation: Use `getAllowedOrgs()` for the full rich data. LLM agents benefit from knowing org type, instance URL, and aliases.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | mocha 11.7.2 + chai 4.3.10 + sinon 10.0.0 |
| Config file | packages/mcp/.mocharc.json |
| Quick run command | `cd packages/mcp && yarn test:only` |
| Full suite command | `cd packages/mcp && yarn test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-03 | registerResourcesFromProviders() calls provideResources() and registers results | unit | `cd packages/mcp && npx mocha test/unit/resource-registration.test.ts` | Wave 0 |
| DISC-03 | McpResource instances registered as static resources | unit | same file | Wave 0 |
| DISC-03 | McpResourceTemplate instances registered as template resources | unit | same file | Wave 0 |
| DISC-01 | salesforce://orgs resource returns current org list | unit | `cd packages/mcp-provider-dx-core && npx mocha test/unit/org-list-resource.test.ts` | Wave 0 |
| DISC-01 | Org list resource returns fresh data on each read (not cached) | unit | same file | Wave 0 |
| DISC-02 | salesforce://orgs/{orgName}/permissions returns permission levels | unit | `cd packages/mcp-provider-dx-core && npx mocha test/unit/org-permissions-resource.test.ts` | Wave 0 |
| DISC-02 | Permission resource template lists all authorized orgs | unit | same file | Wave 0 |
| DISC-01+02 | E2E: client.listResources() includes org resources | E2E | `cd packages/mcp-provider-dx-core && npx mocha test/e2e/resource-discovery.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/mcp && yarn test:only` (unit tests only, fast)
- **Per wave merge:** `cd packages/mcp && yarn test` (full suite with lint)
- **Phase gate:** Full suite green across both `packages/mcp` and `packages/mcp-provider-dx-core`

### Wave 0 Gaps
- [ ] `packages/mcp/test/unit/resource-registration.test.ts` -- covers DISC-03 (wiring)
- [ ] `packages/mcp-provider-dx-core/test/unit/org-list-resource.test.ts` -- covers DISC-01
- [ ] `packages/mcp-provider-dx-core/test/unit/org-permissions-resource.test.ts` -- covers DISC-02
- [ ] `packages/mcp-provider-dx-core/test/e2e/resource-discovery.test.ts` -- covers DISC-01+02 E2E

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- resources read from already-authenticated orgs |
| V3 Session Management | no | N/A |
| V4 Access Control | yes | Resources respect existing `authorizedOrgs` allowlist; permission resource reflects `orgPermissions` Map |
| V5 Input Validation | yes | Validate `orgName` variable from URI template against authorized org list |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for MCP Resources

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| URI injection via orgName variable | Tampering | Validate orgName against authorized org set before returning data |
| Information disclosure of unauthorized org permissions | Information Disclosure | Only return permission data for orgs in `authorizedOrgs` set |
| Enumeration of org names via template completion | Information Disclosure | `complete` callback only returns authorized org names (already filtered) |

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk` v1.18.2 compiled source (`dist/esm/server/mcp.js`, `mcp.d.ts`) -- resource registration API, readCallback invocation pattern, ResourceTemplate class
- `mcp-provider-api` source code (`src/resources.ts`, `src/provider.ts`, `src/services.ts`) -- McpResource/McpResourceTemplate abstract classes, provideResources() signature
- `packages/mcp/src/utils/registry-utils.ts` -- existing tool registration wiring pattern
- `packages/mcp/src/sf-mcp-server.ts` -- SfMcpServer extends McpServer, registerResource() inherited
- `packages/mcp/src/index.ts` -- server already declares `resources: {}` capability
- `packages/mcp/src/utils/org-permissions.ts` -- OrgPermission type, canExecute(), getOrgPermission()
- `packages/mcp/src/utils/tool-categories.ts` -- ToolCategory type, getToolCategory()

### Secondary (MEDIUM confidence)
- MCP Specification 2025-06-18 Resources page [CITED: https://modelcontextprotocol.io/specification/2025-06-18/server/resources] -- URI schemes, resource data types, security considerations

### Tertiary (LOW confidence)
- None -- all findings verified against source code or official specification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified against source
- Architecture: HIGH -- SDK API verified via compiled source; abstract classes verified in provider-api
- Pitfalls: HIGH -- all derived from direct code inspection of SDK internals and existing patterns

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (SDK version pinned at ^1.18.0; resource API is stable)
