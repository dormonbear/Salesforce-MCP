import { expect } from 'chai';
import sinon from 'sinon';
import type { Services } from '@salesforce/mcp-provider-api';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { OrgListResource } from '../../src/resources/org-list-resource.js';

describe('OrgListResource', () => {
  let services: Services;
  let getAllowedOrgsStub: sinon.SinonStub;
  let resource: OrgListResource;

  const mockOrgs = [
    { username: 'admin@prod.org', aliases: ['prod'], instanceUrl: 'https://prod.salesforce.com' },
    { username: 'admin@dev.org', aliases: ['dev'], instanceUrl: 'https://dev.salesforce.com' },
  ];

  beforeEach(() => {
    getAllowedOrgsStub = sinon.stub().resolves(mockOrgs);
    services = {
      getTelemetryService: () => ({ sendEvent: () => {} }),
      getOrgService: () => ({
        getAllowedOrgs: getAllowedOrgsStub,
        getAllowedOrgUsernames: sinon.stub().resolves(new Set()),
        getConnection: sinon.stub(),
        getDefaultTargetOrg: sinon.stub(),
        getDefaultTargetDevHub: sinon.stub(),
        findOrgByUsernameOrAlias: sinon.stub(),
      }),
      getConfigService: () => ({ getDataDir: () => '/tmp', getStartupFlags: () => ({}) }),
      getPermissionService: () => ({
        getOrgPermission: () => 'full-access' as const,
        canExecuteCategory: () => 'allow' as const,
        getAuthorizedOrgs: () => [],
      }),
    } as unknown as Services;

    resource = new OrgListResource(services);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return "salesforce-orgs" from getName()', () => {
    expect(resource.getName()).to.equal('salesforce-orgs');
  });

  it('should return "salesforce://orgs" from getUri()', () => {
    expect(resource.getUri()).to.equal('salesforce://orgs');
  });

  it('should return config with description and mimeType', () => {
    const config = resource.getConfig();
    expect(config.description).to.be.a('string').that.is.not.empty;
    expect(config.mimeType).to.equal('application/json');
  });

  it('should call getAllowedOrgs() on each read()', async () => {
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;

    await resource.read(new URL('salesforce://orgs'), fakeExtra);
    await resource.read(new URL('salesforce://orgs'), fakeExtra);

    expect(getAllowedOrgsStub.calledTwice).to.be.true;
  });

  it('should return proper ReadResourceResult shape', async () => {
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;

    const result = await resource.read(new URL('salesforce://orgs'), fakeExtra);

    expect(result).to.have.property('contents').that.is.an('array').with.lengthOf(1);
    const content = result.contents[0];
    expect(content).to.have.property('uri', 'salesforce://orgs');
    expect(content).to.have.property('mimeType', 'application/json');
    expect(content).to.have.property('text');
    const parsed = JSON.parse(content.text as string);
    expect(parsed).to.deep.equal(mockOrgs);
  });

  it('should return fresh data on each call', async () => {
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;
    const updatedOrgs = [{ username: 'new@org.com', aliases: ['new'], instanceUrl: 'https://new.salesforce.com' }];

    // First call returns original
    const result1 = await resource.read(new URL('salesforce://orgs'), fakeExtra);
    expect(JSON.parse(result1.contents[0].text as string)).to.deep.equal(mockOrgs);

    // Update stub for second call
    getAllowedOrgsStub.resolves(updatedOrgs);
    const result2 = await resource.read(new URL('salesforce://orgs'), fakeExtra);
    expect(JSON.parse(result2.contents[0].text as string)).to.deep.equal(updatedOrgs);
  });
});
