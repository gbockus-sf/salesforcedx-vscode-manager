import { PublisherCatalogService } from '../../src/services/publisherCatalogService';
import type {
  CatalogEntry,
  MarketplaceVersionService
} from '../../src/services/marketplaceVersionService';
import type { SettingsService } from '../../src/services/settingsService';
import type { Logger } from '../../src/util/logger';

const mkMarketplace = (entries: CatalogEntry[] = []): MarketplaceVersionService => ({
  listPublisherExtensions: jest.fn(async () => entries),
  clearCache: jest.fn()
} as unknown as MarketplaceVersionService);

const mkSettings = (updateCheck: 'onStartup' | 'manual' | 'never' = 'manual'): SettingsService => ({
  getUpdateCheck: jest.fn(() => updateCheck)
} as unknown as SettingsService);

const mkLogger = (): Logger => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), dispose: jest.fn(), show: jest.fn()
} as unknown as Logger);

const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  extensionId: id,
  displayName: id,
  shortDescription: undefined,
  categories: [],
  version: undefined,
  installCount: undefined,
  ...extra
});

describe('PublisherCatalogService', () => {
  it('current() is empty before refresh()', () => {
    const svc = new PublisherCatalogService('salesforce', mkMarketplace(), mkSettings(), mkLogger());
    expect(svc.current()).toEqual([]);
  });

  it('refresh() populates the snapshot from the marketplace', async () => {
    const mp = mkMarketplace([entry('salesforce.apex'), entry('salesforce.core')]);
    const svc = new PublisherCatalogService('salesforce', mp, mkSettings(), mkLogger());
    await svc.refresh();
    expect(svc.current().map(e => e.extensionId)).toEqual(['salesforce.apex', 'salesforce.core']);
  });

  it('refresh() dedupes concurrent callers', async () => {
    const mp = mkMarketplace([entry('salesforce.apex')]);
    const svc = new PublisherCatalogService('salesforce', mp, mkSettings(), mkLogger());
    await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(mp.listPublisherExtensions).toHaveBeenCalledTimes(1);
  });

  it('refresh() without force is a no-op when updateCheck is "never"', async () => {
    const mp = mkMarketplace([entry('salesforce.apex')]);
    const svc = new PublisherCatalogService('salesforce', mp, mkSettings('never'), mkLogger());
    await svc.refresh();
    expect(mp.listPublisherExtensions).not.toHaveBeenCalled();
    expect(svc.current()).toEqual([]);
  });

  it('refresh({ force: true }) bypasses the "never" guard', async () => {
    const mp = mkMarketplace([entry('salesforce.apex')]);
    const svc = new PublisherCatalogService('salesforce', mp, mkSettings('never'), mkLogger());
    await svc.refresh({ force: true });
    expect(mp.listPublisherExtensions).toHaveBeenCalledTimes(1);
    expect(svc.current().length).toBe(1);
  });

  it('clear() drops the snapshot and the marketplace cache', async () => {
    const mp = mkMarketplace([entry('salesforce.apex')]);
    const svc = new PublisherCatalogService('salesforce', mp, mkSettings(), mkLogger());
    await svc.refresh();
    svc.clear();
    expect(svc.current()).toEqual([]);
    expect(mp.clearCache).toHaveBeenCalled();
  });
});
