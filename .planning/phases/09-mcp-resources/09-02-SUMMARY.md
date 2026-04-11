# Phase 09-02 Summary: Concrete MCP Resource Implementations

## What was done

### Task 1: OrgListResource
- Created `packages/mcp-provider-dx-core/src/resources/org-list-resource.ts`
  - Extends `McpResource` from `@salesforce/mcp-provider-api`
  - URI: `salesforce://orgs` (static resource)
  - Delegates to `OrgService.getAllowedOrgs()` on each read (fresh data)
  - Returns JSON-formatted org list
- Created unit test `packages/mcp-provider-dx-core/test/unit/org-list-resource.test.ts` (6 tests)

### Task 2: OrgPermissionsResource + provideResources() wiring
- Created `packages/mcp-provider-dx-core/src/resources/org-permissions-resource.ts`
  - Extends `McpResourceTemplate` from `@salesforce/mcp-provider-api`
  - URI template: `salesforce://orgs/{orgName}/permissions`
  - `getTemplate()` includes `list` callback (enumerates authorized orgs) and `complete` callback (prefix autocomplete)
  - Delegates to `PermissionService` for permission and category data
- Updated `packages/mcp-provider-dx-core/src/index.ts`
  - Added `provideResources()` override returning both resources
  - Added imports for `McpResource`, `McpResourceTemplate`, `OrgListResource`, `OrgPermissionsResource`
- Updated `packages/mcp-provider-dx-core/package.json`
  - Bumped `@salesforce/mcp-provider-api` dependency from `^0.4.1` to `0.6.0` (required for `PermissionService` in `Services` interface)
- Created unit test `packages/mcp-provider-dx-core/test/unit/org-permissions-resource.test.ts` (5 resource tests + 1 provider integration test)

## Test results

All 42 unit tests pass (12 new + 30 existing):
- OrgListResource: 6 passing
- OrgPermissionsResource: 5 passing
- DxCoreMcpProvider.provideResources(): 1 passing
- Existing tests: 30 passing (no regressions)

## Known issues

- `yarn install` fails globally due to a pre-existing broken `brace-expansion` symlink in `mcp-provider-api/node_modules/@typescript-eslint/typescript-estree/node_modules/`. This is not caused by this phase. Workaround: manually symlink `mcp-provider-api` into dx-core's node_modules.
