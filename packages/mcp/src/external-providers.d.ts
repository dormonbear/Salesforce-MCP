/*
 * Ambient module declarations for @salesforce provider packages that ship
 * source-only (no compiled .d.ts). Required for tsconfig.publish.json builds
 * which don't use project references.
 *
 * lwc-experts and aura-experts are excluded — they bundle their own .d.ts.
 */

declare module '@salesforce/mcp-provider-code-analyzer';
declare module '@salesforce/mcp-provider-mobile-web';
declare module '@salesforce/mcp-provider-devops';
declare module '@salesforce/mcp-provider-scale-products';
declare module '@salesforce/mcp-provider-metadata-enrichment';
