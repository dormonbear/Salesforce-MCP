import { expect } from 'chai';
import sinon from 'sinon';
import type { Services } from '@salesforce/mcp-provider-api';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { OrgPermissionsResource } from '../../src/resources/org-permissions-resource.js';
import { DxCoreMcpProvider } from '../../src/index.js';

describe('OrgPermissionsResource', () => {
  let services: Services;
  let resource: OrgPermissionsResource;

  beforeEach(() => {
    services = {
      getTelemetryService: () => ({ sendEvent: () => {} }),
      getOrgService: () => ({
        getAllowedOrgs: sinon.stub().resolves([]),
        getAllowedOrgUsernames: sinon.stub().resolves(new Set()),
        getConnection: sinon.stub(),
        getDefaultTargetOrg: sinon.stub(),
        getDefaultTargetDevHub: sinon.stub(),
        findOrgByUsernameOrAlias: sinon.stub(),
      }),
      getConfigService: () => ({ getDataDir: () => '/tmp', getStartupFlags: () => ({}) }),
      getPermissionService: () => ({
        getAuthorizedOrgs: () => ['prod', 'staging'],
        getOrgPermission: (orgName: string) => {
          if (orgName === 'prod') return 'full-access';
          if (orgName === 'staging') return 'read-only';
          return 'read-only';
        },
        canExecuteCategory: (orgName: string, category: string) => {
          if (orgName === 'prod') return 'allow';
          if (orgName === 'staging') {
            if (category === 'read') return 'allow';
            return 'deny';
          }
          return 'deny';
        },
      }),
    } as unknown as Services;

    resource = new OrgPermissionsResource(services);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return "salesforce-org-permissions" from getName()', () => {
    expect(resource.getName()).to.equal('salesforce-org-permissions');
  });

  it('should return config with description and mimeType', () => {
    const config = resource.getConfig();
    expect(config.description).to.be.a('string').that.is.not.empty;
    expect(config.mimeType).to.equal('application/json');
  });

  it('should return a ResourceTemplate from getTemplate()', () => {
    const template = resource.getTemplate();
    expect(template).to.not.be.undefined;
  });

  it('should return full-access permissions for prod org', async () => {
    const fakeUri = new URL('salesforce://orgs/prod/permissions');
    const fakeVariables: Variables = { orgName: 'prod' };
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;

    const result = await resource.read(fakeUri, fakeVariables, fakeExtra);

    expect(result).to.have.property('contents').that.is.an('array').with.lengthOf(1);
    const content = result.contents[0];
    expect(content).to.have.property('uri', 'salesforce://orgs/prod/permissions');
    expect(content).to.have.property('mimeType', 'application/json');

    const parsed = JSON.parse(content.text as string);
    expect(parsed).to.deep.equal({
      org: 'prod',
      permission: 'full-access',
      categories: {
        read: 'allow',
        write: 'allow',
        execute: 'allow',
      },
    });
  });

  it('should return read-only permissions for staging org', async () => {
    const fakeUri = new URL('salesforce://orgs/staging/permissions');
    const fakeVariables: Variables = { orgName: 'staging' };
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;

    const result = await resource.read(fakeUri, fakeVariables, fakeExtra);

    const parsed = JSON.parse(result.contents[0].text as string);
    expect(parsed).to.deep.equal({
      org: 'staging',
      permission: 'read-only',
      categories: {
        read: 'allow',
        write: 'deny',
        execute: 'deny',
      },
    });
  });
});

describe('DxCoreMcpProvider.provideResources()', () => {
  it('should return both OrgListResource and OrgPermissionsResource', async () => {
    const services = {
      getTelemetryService: () => ({ sendEvent: () => {} }),
      getOrgService: () => ({
        getAllowedOrgs: sinon.stub().resolves([]),
        getAllowedOrgUsernames: sinon.stub().resolves(new Set()),
        getConnection: sinon.stub(),
        getDefaultTargetOrg: sinon.stub(),
        getDefaultTargetDevHub: sinon.stub(),
        findOrgByUsernameOrAlias: sinon.stub(),
      }),
      getConfigService: () => ({ getDataDir: () => '/tmp', getStartupFlags: () => ({}) }),
      getPermissionService: () => ({
        getAuthorizedOrgs: () => [],
        getOrgPermission: () => 'full-access',
        canExecuteCategory: () => 'allow',
      }),
    } as unknown as Services;

    const provider = new DxCoreMcpProvider();
    const resources = await provider.provideResources(services);

    expect(resources).to.be.an('array').with.lengthOf(2);
    expect(resources[0].getName()).to.equal('salesforce-orgs');
    expect(resources[0].kind).to.equal('McpResource');
    expect(resources[1].getName()).to.equal('salesforce-org-permissions');
    expect(resources[1].kind).to.equal('McpResourceTemplate');
  });
});
