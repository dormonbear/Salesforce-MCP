import { expect } from 'chai';
import sinon from 'sinon';
import { McpProvider, McpResource, McpResourceTemplate } from '@salesforce/mcp-provider-api';
import { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReadResourceResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { SemVer } from 'semver';
import { registerResourcesFromProviders } from '../../src/utils/registry-utils.js';
import { SfMcpServer } from '../../src/sf-mcp-server.js';

// Concrete McpResource for testing
class TestResource extends McpResource {
  private readonly resourceName: string;
  private readonly uri: string;
  private readonly config: ResourceMetadata;
  public readStub: sinon.SinonStub;

  constructor(name: string, uri: string, config: ResourceMetadata) {
    super();
    this.resourceName = name;
    this.uri = uri;
    this.config = config;
    this.readStub = sinon.stub().resolves({ contents: [{ uri, text: 'test' }] });
  }

  getName(): string { return this.resourceName; }
  getUri(): string { return this.uri; }
  getConfig(): ResourceMetadata { return this.config; }
  read(
    uri: URL,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): ReadResourceResult | Promise<ReadResourceResult> {
    return this.readStub(uri, extra);
  }
}

// Concrete McpResourceTemplate for testing
class TestResourceTemplate extends McpResourceTemplate {
  private readonly resourceName: string;
  private readonly template: ResourceTemplate;
  private readonly config: ResourceMetadata;
  public readStub: sinon.SinonStub;

  constructor(name: string, template: ResourceTemplate, config: ResourceMetadata) {
    super();
    this.resourceName = name;
    this.template = template;
    this.config = config;
    this.readStub = sinon.stub().resolves({ contents: [{ uri: 'test://x', text: 'test' }] });
  }

  getName(): string { return this.resourceName; }
  getTemplate(): ResourceTemplate { return this.template; }
  getConfig(): ResourceMetadata { return this.config; }
  read(
    uri: URL,
    variables: Variables,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): ReadResourceResult | Promise<ReadResourceResult> {
    return this.readStub(uri, variables, extra);
  }
}

// Minimal mock provider
function createMockProvider(
  resources: (McpResource | McpResourceTemplate)[] = [],
  name = 'test-provider'
): McpProvider {
  const provider = {
    getName: () => name,
    getVersion: () => new SemVer('0.6.0'),
    provideResources: sinon.stub().resolves(resources),
    provideTools: sinon.stub().resolves([]),
    providePrompts: sinon.stub().resolves([]),
  } as unknown as McpProvider;
  return provider;
}

function createMockServer(): SfMcpServer & { registerResource: sinon.SinonStub } {
  const server = {
    registerResource: sinon.stub(),
  } as unknown as SfMcpServer & { registerResource: sinon.SinonStub };
  return server;
}

function createMockServices(): any {
  return {
    getTelemetryService: () => ({ sendEvent: () => {} }),
    getOrgService: () => ({}),
    getConfigService: () => ({ getDataDir: () => '/tmp', getStartupFlags: () => ({}) }),
    getPermissionService: () => ({
      getOrgPermission: () => 'full-access',
      canExecuteCategory: () => 'allow',
      getAuthorizedOrgs: () => [],
    }),
  };
}

describe('registerResourcesFromProviders', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should call provideResources on each provider', async () => {
    const provider1 = createMockProvider([], 'provider-1');
    const provider2 = createMockProvider([], 'provider-2');
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider1, provider2], services, server);

    expect((provider1.provideResources as sinon.SinonStub).calledOnce).to.be.true;
    expect((provider2.provideResources as sinon.SinonStub).calledOnce).to.be.true;
  });

  it('should register McpResource with name, uri, config, and readCallback', async () => {
    const config: ResourceMetadata = { description: 'A test resource' };
    const resource = new TestResource('test-resource', 'sf://test', config);
    const provider = createMockProvider([resource]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    expect(server.registerResource.calledOnce).to.be.true;
    const [name, uri, registeredConfig, readCb] = server.registerResource.firstCall.args;
    expect(name).to.equal('test-resource');
    expect(uri).to.equal('sf://test');
    expect(registeredConfig).to.deep.equal(config);
    expect(typeof readCb).to.equal('function');
  });

  it('should register McpResourceTemplate with name, template, config, and readCallback', async () => {
    const config: ResourceMetadata = { description: 'A template resource' };
    const template = new ResourceTemplate('sf://orgs/{orgId}', { list: undefined });
    const resourceTemplate = new TestResourceTemplate('org-template', template, config);
    const provider = createMockProvider([resourceTemplate]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    expect(server.registerResource.calledOnce).to.be.true;
    const [name, registeredTemplate, registeredConfig, readCb] = server.registerResource.firstCall.args;
    expect(name).to.equal('org-template');
    expect(registeredTemplate).to.equal(template);
    expect(registeredConfig).to.deep.equal(config);
    expect(typeof readCb).to.equal('function');
  });

  it('should handle empty results gracefully', async () => {
    const provider = createMockProvider([]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    expect(server.registerResource.called).to.be.false;
  });

  it('should handle providers returning no resources at all', async () => {
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([], services, server);

    expect(server.registerResource.called).to.be.false;
  });

  it('should delegate readCallback to resource.read() for McpResource', async () => {
    const config: ResourceMetadata = { description: 'test' };
    const resource = new TestResource('res', 'sf://res', config);
    const provider = createMockProvider([resource]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    const readCb = server.registerResource.firstCall.args[3];
    const fakeUri = new URL('sf://res');
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;
    await readCb(fakeUri, fakeExtra);

    expect(resource.readStub.calledOnce).to.be.true;
    expect(resource.readStub.firstCall.args[0]).to.equal(fakeUri);
    expect(resource.readStub.firstCall.args[1]).to.equal(fakeExtra);
  });

  it('should delegate readCallback to resource.read() for McpResourceTemplate', async () => {
    const config: ResourceMetadata = { description: 'test' };
    const template = new ResourceTemplate('sf://orgs/{orgId}', { list: undefined });
    const resourceTemplate = new TestResourceTemplate('tpl', template, config);
    const provider = createMockProvider([resourceTemplate]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    const readCb = server.registerResource.firstCall.args[3];
    const fakeUri = new URL('sf://orgs/001');
    const fakeVariables: Variables = { orgId: '001' };
    const fakeExtra = {} as RequestHandlerExtra<ServerRequest, ServerNotification>;
    await readCb(fakeUri, fakeVariables, fakeExtra);

    expect(resourceTemplate.readStub.calledOnce).to.be.true;
    expect(resourceTemplate.readStub.firstCall.args[0]).to.equal(fakeUri);
    expect(resourceTemplate.readStub.firstCall.args[1]).to.equal(fakeVariables);
    expect(resourceTemplate.readStub.firstCall.args[2]).to.equal(fakeExtra);
  });

  it('should register both McpResource and McpResourceTemplate from same provider', async () => {
    const resource = new TestResource('static-res', 'sf://static', { description: 'static' });
    const template = new ResourceTemplate('sf://dynamic/{id}', { list: undefined });
    const resourceTemplate = new TestResourceTemplate('dynamic-res', template, { description: 'dynamic' });
    const provider = createMockProvider([resource, resourceTemplate]);
    const server = createMockServer();
    const services = createMockServices();

    await registerResourcesFromProviders([provider], services, server);

    expect(server.registerResource.calledTwice).to.be.true;
    // First call: static resource registered with URI string
    expect(server.registerResource.firstCall.args[1]).to.equal('sf://static');
    // Second call: template resource registered with ResourceTemplate
    expect(server.registerResource.secondCall.args[1]).to.equal(template);
  });
});
