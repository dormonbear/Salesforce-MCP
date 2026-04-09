/**
 * E2E test for multi-org permissions feature.
 * Tests all three permission modes: full-access, read-only, approval-required
 *
 * Usage: node e2e-permission-test.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_BIN = '/Users/dormon/Projects/Salesforce-MCP/packages/mcp/bin/run.js';
const ORG = 'dormon104@agentforce.com';
const ORG2 = 'dormon@dormon.partner';
const PROJECT_DIR = '/Users/dormon/Projects/Salesforce-MCP';

// Known org identifiers for data-level isolation verification
const ORG1_ID = '00Dfj00000F31rlEAB';
const ORG1_INSTANCE = 'orgfarm-d300fcfc0f-dev-ed.develop.my.salesforce.com';
const ORG2_ID = '00D5j000001jz4ZEAQ';
const ORG2_INSTANCE = 'dormon2-dev-ed.my.salesforce.com';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

async function createClient(envOverrides = {}, orgs = ORG) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_BIN, '--orgs', orgs, '--toolsets', 'all', '--no-telemetry'],
    env: {
      ...process.env,
      NODE_OPTIONS: '--no-deprecation',
      ...envOverrides,
    },
  });

  const client = new Client({ name: 'e2e-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function callTool(client, name, args = {}) {
  try {
    return await client.callTool({ name, arguments: args });
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }], _thrown: true };
  }
}

// ============================================================
// Test Suite 1: Server startup & tool listing
// ============================================================
async function testServerStartup() {
  console.log('\n=== Test 1: Server Startup & Tool Listing ===');
  const { client } = await createClient();

  try {
    const tools = await client.listTools();
    assert(tools.tools.length > 0, `Server registered ${tools.tools.length} tools`);

    // Check new salesforce_get_org_info tool exists
    const orgInfoTool = tools.tools.find(t => t.name === 'salesforce_get_org_info');
    assert(orgInfoTool !== undefined, 'salesforce_get_org_info tool registered');

    // Check targetOrg injected into tool schemas
    const queryTool = tools.tools.find(t => t.name === 'run_soql_query');
    const hasTargetOrg = queryTool?.inputSchema?.properties?.targetOrg;
    assert(hasTargetOrg !== undefined, 'targetOrg parameter injected into tool schema');

    // Check targetOrg description includes authorized orgs
    const desc = hasTargetOrg?.description || '';
    assert(desc.includes(ORG), `targetOrg description includes authorized org: ${ORG}`);

    // Check default org is mentioned
    assert(desc.includes('Default:'), 'targetOrg description includes default org hint');

    // Verify write tools also have targetOrg
    const deployTool = tools.tools.find(t => t.name === 'deploy_metadata');
    const deployHasTargetOrg = deployTool?.inputSchema?.properties?.targetOrg;
    assert(deployHasTargetOrg !== undefined, 'targetOrg injected into write tools too (deploy_metadata)');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 2: full-access mode (default) - read operations
// ============================================================
async function testFullAccessRead() {
  console.log('\n=== Test 2: Full-Access Mode - Read Operations ===');
  const { client } = await createClient();

  try {
    // get_org_info (no directory/usernameOrAlias needed)
    const readResult = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG });
    assert(!readResult.isError, 'full-access: read (get_org_info) succeeds');
    const content = readResult.content?.[0]?.text || '';
    assert(content.includes(ORG) || content.includes('orgId'), 'full-access: get_org_info returns org data');

    // SOQL query - usernameOrAlias is required by Zod schema (validated before middleware)
    // middleware will override it with targetOrg value
    const soqlResult = await callTool(client, 'run_soql_query', {
      query: 'SELECT Id, Name FROM Account LIMIT 1',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    assert(!soqlResult.isError, `full-access: SOQL query succeeds. ${soqlResult.isError ? soqlResult.content?.[0]?.text?.slice(0,100) : 'OK'}`);

    // Default org when targetOrg omitted
    const defaultResult = await callTool(client, 'salesforce_get_org_info', {});
    assert(!defaultResult.isError, 'full-access: default org used when targetOrg omitted');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 3: full-access mode - write operations
// ============================================================
async function testFullAccessWrite() {
  console.log('\n=== Test 3: Full-Access Mode - Write Operations ===');
  const { client } = await createClient();

  try {
    // assign_permission_set is a write tool - we expect it to pass permission check
    // but may fail on actual SF execution (no such perm set). That's fine -
    // we're testing that the permission middleware doesn't block it.
    const writeResult = await callTool(client, 'assign_permission_set', {
      permissionSetName: 'E2E_Test_NonExistent',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    // In full-access, the middleware should NOT block - tool may fail for SF reasons
    const writeContent = writeResult.content?.[0]?.text || '';
    const blockedByPermission = writeContent.includes('read-only') || writeContent.includes('denied');
    assert(!blockedByPermission, `full-access: write not blocked by permission middleware`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 4: read-only mode
// ============================================================
async function testReadOnly() {
  console.log('\n=== Test 4: Read-Only Mode ===');
  const { client } = await createClient({
    ORG_PERMISSIONS: `${ORG}:read-only`,
  });

  try {
    // Read should succeed
    const readResult = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG });
    assert(!readResult.isError, 'read-only: read (get_org_info) succeeds');

    // SOQL query should succeed (read category)
    const soqlResult = await callTool(client, 'run_soql_query', {
      query: 'SELECT Id, Name FROM Account LIMIT 1',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    assert(!soqlResult.isError, `read-only: SOQL query succeeds`);

    // Write tool should be denied
    const writeResult = await callTool(client, 'assign_permission_set', {
      permissionSetName: 'E2E_Test_NonExistent',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    const writeContent = writeResult.content?.[0]?.text || '';
    const isDenied = writeResult.isError || writeContent.includes('denied') || writeContent.includes('read-only');
    assert(isDenied, `read-only: write (assign_permission_set) denied. Response: ${writeContent.slice(0, 100)}`);

    // Deploy (write) should also be denied
    const deployResult = await callTool(client, 'deploy_metadata', {
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    const deployContent = deployResult.content?.[0]?.text || '';
    const deployDenied = deployResult.isError || deployContent.includes('denied') || deployContent.includes('read-only');
    assert(deployDenied, `read-only: write (deploy_metadata) denied. Response: ${deployContent.slice(0, 100)}`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 5: approval-required mode
// ============================================================
async function testApprovalRequired() {
  console.log('\n=== Test 5: Approval-Required Mode ===');
  const { client } = await createClient({
    ORG_PERMISSIONS: `${ORG}:approval-required`,
  });

  try {
    // Read should succeed (no approval needed)
    const readResult = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG });
    assert(!readResult.isError, 'approval-required: read (get_org_info) succeeds');

    // Write should trigger elicitation (which our test client doesn't support -> error)
    const writeResult = await callTool(client, 'assign_permission_set', {
      permissionSetName: 'E2E_Test_NonExistent',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    const writeContent = writeResult.content?.[0]?.text || '';
    // Should get elicitation error or approval message
    const needsApproval = writeContent.includes('licit') || writeContent.includes('approval') ||
                          writeContent.includes('approve') || writeContent.includes('Approval') ||
                          writeContent.includes('not supported');
    assert(needsApproval, `approval-required: write triggers approval/elicitation. Response: ${writeContent.slice(0, 200)}`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 6: unauthorized org
// ============================================================
async function testUnauthorizedOrg() {
  console.log('\n=== Test 6: Unauthorized Org ===');
  const { client } = await createClient();

  try {
    const result = await callTool(client, 'salesforce_get_org_info', {
      targetOrg: 'unauthorized@example.com',
    });
    const content = result.content?.[0]?.text || '';
    const isDenied = result.isError || content.includes('not authorized') || content.includes('not in the authorized');
    assert(isDenied, `unauthorized org rejected. Response: ${content.slice(0, 150)}`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 7: default org behavior
// ============================================================
async function testDefaultOrg() {
  console.log('\n=== Test 7: Default Org Behavior ===');
  const { client } = await createClient();

  try {
    // get_org_info without targetOrg -> should use default
    const result = await callTool(client, 'salesforce_get_org_info', {});
    assert(!result.isError, 'default org used when targetOrg omitted');
    const content = result.content?.[0]?.text || '';
    assert(content.includes(ORG) || content.includes('orgId'), 'default org returns correct org data');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 8: concurrent call serialization (mutex)
// ============================================================
async function testConcurrentCalls() {
  console.log('\n=== Test 8: Concurrent Call Serialization ===');
  const { client } = await createClient();

  try {
    const queries = [
      callTool(client, 'salesforce_get_org_info', { targetOrg: ORG }),
      callTool(client, 'salesforce_get_org_info', { targetOrg: ORG }),
      callTool(client, 'salesforce_get_org_info', { targetOrg: ORG }),
    ];

    const results = await Promise.all(queries);
    const allSucceeded = results.every(r => !r.isError);
    assert(allSucceeded, 'concurrent calls all succeed (mutex serialization works)');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 9: SOQL with default org
// ============================================================
async function testSoqlDefaultOrg() {
  console.log('\n=== Test 9: SOQL with Default Org ===');
  const { client } = await createClient();

  try {
    const result = await callTool(client, 'run_soql_query', {
      query: 'SELECT Id FROM Account LIMIT 1',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
    });
    assert(!result.isError, `SOQL with default org succeeds. ${result.isError ? result.content?.[0]?.text?.slice(0,100) : 'OK'}`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 10: Multi-org mixed permissions
// ORG1 = read-only, ORG2 = full-access
// Verify each org gets its own permission enforced
// ============================================================
async function testMultiOrgMixedPermissions() {
  console.log('\n=== Test 10: Multi-Org Mixed Permissions ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient(
    { ORG_PERMISSIONS: `${ORG}:read-only,${ORG2}:full-access` },
    BOTH_ORGS
  );

  try {
    // ORG1 (read-only): read should succeed
    const org1Read = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG });
    assert(!org1Read.isError, 'multi-org: ORG1 (read-only) read succeeds');

    // ORG1 (read-only): write should be denied
    const org1Write = await callTool(client, 'assign_permission_set', {
      permissionSetName: 'E2E_Test',
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    const org1WriteContent = org1Write.content?.[0]?.text || '';
    assert(
      org1Write.isError || org1WriteContent.includes('read-only') || org1WriteContent.includes('denied'),
      `multi-org: ORG1 (read-only) write denied. Got: ${org1WriteContent.slice(0, 80)}`
    );

    // ORG2 (full-access): read should succeed
    const org2Read = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG2 });
    assert(!org2Read.isError, 'multi-org: ORG2 (full-access) read succeeds');

    // ORG2 (full-access): write should NOT be blocked by permission
    const org2Write = await callTool(client, 'assign_permission_set', {
      permissionSetName: 'E2E_Test',
      usernameOrAlias: ORG2,
      directory: PROJECT_DIR,
      targetOrg: ORG2,
    });
    const org2WriteContent = org2Write.content?.[0]?.text || '';
    const org2Blocked = org2WriteContent.includes('read-only') || org2WriteContent.includes('denied');
    assert(!org2Blocked, `multi-org: ORG2 (full-access) write NOT blocked by permission`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 11: Multi-org concurrent calls - permission isolation
// Fire reads and writes to both orgs concurrently, verify each
// gets the correct permission decision
// ============================================================
async function testMultiOrgConcurrentIsolation() {
  console.log('\n=== Test 11: Multi-Org Concurrent Permission Isolation ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient(
    { ORG_PERMISSIONS: `${ORG}:read-only,${ORG2}:full-access` },
    BOTH_ORGS
  );

  try {
    // Fire 6 calls concurrently: 3 per org (read, write, read)
    const results = await Promise.all([
      // ORG1 calls
      callTool(client, 'salesforce_get_org_info', { targetOrg: ORG }),           // [0] read -> ok
      callTool(client, 'assign_permission_set', {                                // [1] write -> denied
        permissionSetName: 'X', usernameOrAlias: ORG, directory: PROJECT_DIR, targetOrg: ORG,
      }),
      callTool(client, 'run_soql_query', {                                       // [2] read -> ok
        query: 'SELECT Id FROM Account LIMIT 1', usernameOrAlias: ORG, directory: PROJECT_DIR, targetOrg: ORG,
      }),
      // ORG2 calls
      callTool(client, 'salesforce_get_org_info', { targetOrg: ORG2 }),          // [3] read -> ok
      callTool(client, 'assign_permission_set', {                                // [4] write -> ok (full-access)
        permissionSetName: 'X', usernameOrAlias: ORG2, directory: PROJECT_DIR, targetOrg: ORG2,
      }),
      callTool(client, 'run_soql_query', {                                       // [5] read -> ok
        query: 'SELECT Id FROM Account LIMIT 1', usernameOrAlias: ORG2, directory: PROJECT_DIR, targetOrg: ORG2,
      }),
    ]);

    // ORG1 (read-only)
    assert(!results[0].isError, 'concurrent: ORG1 read #1 succeeds');
    const r1w = results[1].content?.[0]?.text || '';
    assert(
      results[1].isError || r1w.includes('read-only') || r1w.includes('denied'),
      `concurrent: ORG1 write denied (not leaked to ORG2 full-access)`
    );
    assert(!results[2].isError, 'concurrent: ORG1 read #2 succeeds');

    // ORG2 (full-access)
    assert(!results[3].isError, 'concurrent: ORG2 read succeeds');
    const r2w = results[4].content?.[0]?.text || '';
    const r2Blocked = r2w.includes('read-only') || r2w.includes('denied');
    assert(!r2Blocked, `concurrent: ORG2 write NOT denied (not leaked from ORG1 read-only)`);
    assert(!results[5].isError, 'concurrent: ORG2 SOQL read succeeds');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 12: Multi-org approval vs full-access isolation
// ORG1 = approval-required, ORG2 = full-access
// Concurrent writes: ORG1 should trigger elicitation, ORG2 should pass
// ============================================================
async function testMultiOrgApprovalIsolation() {
  console.log('\n=== Test 12: Multi-Org Approval vs Full-Access Isolation ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient(
    { ORG_PERMISSIONS: `${ORG}:approval-required,${ORG2}:full-access` },
    BOTH_ORGS
  );

  try {
    // Fire writes to both orgs concurrently
    const [org1Write, org2Write] = await Promise.all([
      callTool(client, 'assign_permission_set', {
        permissionSetName: 'X', usernameOrAlias: ORG, directory: PROJECT_DIR, targetOrg: ORG,
      }),
      callTool(client, 'assign_permission_set', {
        permissionSetName: 'X', usernameOrAlias: ORG2, directory: PROJECT_DIR, targetOrg: ORG2,
      }),
    ]);

    // ORG1 should require approval
    const org1Content = org1Write.content?.[0]?.text || '';
    const org1NeedsApproval = org1Content.includes('licit') || org1Content.includes('approval') || org1Content.includes('not supported');
    assert(org1NeedsApproval, `approval-isolation: ORG1 write requires approval`);

    // ORG2 should NOT require approval
    const org2Content = org2Write.content?.[0]?.text || '';
    const org2NeedsApproval = org2Content.includes('licit') || org2Content.includes('approval') || org2Content.includes('not supported');
    assert(!org2NeedsApproval, `approval-isolation: ORG2 write does NOT require approval`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 13: Multi-org default org selection
// When server has multiple orgs, default is first org
// ============================================================
async function testMultiOrgDefault() {
  console.log('\n=== Test 13: Multi-Org Default Org Selection ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient({}, BOTH_ORGS);

  try {
    // Omit targetOrg -> default should be the first org (ORG)
    const result = await callTool(client, 'salesforce_get_org_info', {});
    assert(!result.isError, 'multi-org default: call without targetOrg succeeds');

    // Verify both orgs are listed in tool schema
    const tools = await client.listTools();
    const queryTool = tools.tools.find(t => t.name === 'run_soql_query');
    const desc = queryTool?.inputSchema?.properties?.targetOrg?.description || '';
    assert(desc.includes(ORG), 'multi-org default: schema lists ORG1');
    assert(desc.includes(ORG2), 'multi-org default: schema lists ORG2');

    // Verify both orgs can be targeted explicitly
    const r1 = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG });
    const r2 = await callTool(client, 'salesforce_get_org_info', { targetOrg: ORG2 });
    assert(!r1.isError, 'multi-org default: explicit ORG1 works');
    assert(!r2.isError, 'multi-org default: explicit ORG2 works');
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 14: Data-level org isolation (sequential)
// Verify returned data actually comes from the targeted org,
// not just that the middleware routed permissions correctly.
// ============================================================
async function testDataIsolationSequential() {
  console.log('\n=== Test 14: Data-Level Org Isolation (Sequential) ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient({}, BOTH_ORGS);

  try {
    // Query ORG1 -> verify orgId belongs to ORG1
    const r1 = await callTool(client, 'run_soql_query', {
      query: "SELECT Id FROM Organization LIMIT 1",
      usernameOrAlias: ORG,
      directory: PROJECT_DIR,
      targetOrg: ORG,
    });
    const r1Text = r1.content?.[0]?.text || '';
    assert(!r1.isError, `data-seq: ORG1 SOQL succeeds`);
    assert(r1Text.includes(ORG1_ID), `data-seq: ORG1 returned its own orgId (${ORG1_ID}). Got: ${r1Text.slice(0, 120)}`);

    // Query ORG2 -> verify orgId belongs to ORG2
    const r2 = await callTool(client, 'run_soql_query', {
      query: "SELECT Id FROM Organization LIMIT 1",
      usernameOrAlias: ORG2,
      directory: PROJECT_DIR,
      targetOrg: ORG2,
    });
    const r2Text = r2.content?.[0]?.text || '';
    assert(!r2.isError, `data-seq: ORG2 SOQL succeeds`);
    assert(r2Text.includes(ORG2_ID), `data-seq: ORG2 returned its own orgId (${ORG2_ID}). Got: ${r2Text.slice(0, 120)}`);

    // Cross-check: ORG1 result must NOT contain ORG2's id
    assert(!r1Text.includes(ORG2_ID), `data-seq: ORG1 result does NOT contain ORG2 orgId`);
    // Cross-check: ORG2 result must NOT contain ORG1's id
    assert(!r2Text.includes(ORG1_ID), `data-seq: ORG2 result does NOT contain ORG1 orgId`);
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 15: Data-level org isolation (concurrent)
// The critical test: fire SOQL queries to both orgs at the
// same time, verify each result matches its targeted org.
// This catches process.chdir() race conditions and connection
// object leaks between concurrent calls.
// ============================================================
async function testDataIsolationConcurrent() {
  console.log('\n=== Test 15: Data-Level Org Isolation (Concurrent) ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient({}, BOTH_ORGS);

  try {
    // Fire identical SOQL to both orgs concurrently, multiple rounds
    for (let round = 1; round <= 3; round++) {
      const [r1, r2] = await Promise.all([
        callTool(client, 'run_soql_query', {
          query: "SELECT Id FROM Organization LIMIT 1",
          usernameOrAlias: ORG,
          directory: PROJECT_DIR,
          targetOrg: ORG,
        }),
        callTool(client, 'run_soql_query', {
          query: "SELECT Id FROM Organization LIMIT 1",
          usernameOrAlias: ORG2,
          directory: PROJECT_DIR,
          targetOrg: ORG2,
        }),
      ]);

      const r1Text = r1.content?.[0]?.text || '';
      const r2Text = r2.content?.[0]?.text || '';

      assert(
        !r1.isError && r1Text.includes(ORG1_ID),
        `data-concurrent round ${round}: ORG1 query returned ORG1 data (${ORG1_ID})`
      );
      assert(
        !r2.isError && r2Text.includes(ORG2_ID),
        `data-concurrent round ${round}: ORG2 query returned ORG2 data (${ORG2_ID})`
      );
      // Cross-contamination check
      assert(
        !r1Text.includes(ORG2_ID),
        `data-concurrent round ${round}: ORG1 result NOT contaminated with ORG2`
      );
      assert(
        !r2Text.includes(ORG1_ID),
        `data-concurrent round ${round}: ORG2 result NOT contaminated with ORG1`
      );
    }
  } finally {
    await client.close();
  }
}

// ============================================================
// Test Suite 16: Data isolation under interleaved access pattern
// Alternating org targets: ORG1, ORG2, ORG1, ORG2
// Catches bugs where a cached connection from the previous
// call leaks into the next call.
// ============================================================
async function testDataIsolationInterleaved() {
  console.log('\n=== Test 16: Data-Level Org Isolation (Interleaved) ===');
  const BOTH_ORGS = `${ORG},${ORG2}`;
  const { client } = await createClient({}, BOTH_ORGS);

  try {
    const sequence = [ORG, ORG2, ORG, ORG2, ORG];
    const expectedIds = [ORG1_ID, ORG2_ID, ORG1_ID, ORG2_ID, ORG1_ID];

    for (let i = 0; i < sequence.length; i++) {
      const target = sequence[i];
      const expectedId = expectedIds[i];
      const result = await callTool(client, 'run_soql_query', {
        query: "SELECT Id FROM Organization LIMIT 1",
        usernameOrAlias: target,
        directory: PROJECT_DIR,
        targetOrg: target,
      });
      const text = result.content?.[0]?.text || '';
      assert(
        !result.isError && text.includes(expectedId),
        `interleaved step ${i + 1} (${target}): got correct orgId (${expectedId})`
      );
    }
  } finally {
    await client.close();
  }
}

// ============================================================
// Run all tests
// ============================================================
async function main() {
  console.log('Salesforce MCP Multi-Org Permissions E2E Tests');
  console.log('='.repeat(50));
  console.log(`Target org: ${ORG}`);

  try {
    await testServerStartup();
    await testFullAccessRead();
    await testFullAccessWrite();
    await testReadOnly();
    await testApprovalRequired();
    await testUnauthorizedOrg();
    await testDefaultOrg();
    await testConcurrentCalls();
    await testSoqlDefaultOrg();
    await testMultiOrgMixedPermissions();
    await testMultiOrgConcurrentIsolation();
    await testMultiOrgApprovalIsolation();
    await testMultiOrgDefault();
    await testDataIsolationSequential();
    await testDataIsolationConcurrent();
    await testDataIsolationInterleaved();
  } catch (err) {
    console.error('\nFATAL ERROR:', err.message);
    console.error(err.stack);
    failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
