import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminClientId } from './adminClientId';
import { buildHostOutageReportBody } from './hostOutageReport';

describe('host outage report (D6)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('buildHostOutageReportBody formats from/to ISO', () => {
    const body = buildHostOutageReportBody('tab-1', Date.parse('2026-06-01T10:00:00.000Z'), Date.parse('2026-06-01T10:04:00.000Z'));
    expect(body).toEqual({
      clientId: 'tab-1',
      from: '2026-06-01T10:00:00.000Z',
      to: '2026-06-01T10:04:00.000Z',
    });
    expect(buildHostOutageReportBody('tab-1', Date.parse('2026-06-01T10:00:00.000Z'), null).to).toBeNull();
  });

  it('getAdminClientId is stable within the tab', () => {
    const a = getAdminClientId();
    const b = getAdminClientId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('getAdminClientId falls back when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const id = getAdminClientId();
    expect(id.length).toBeGreaterThan(4);
    spy.mockRestore();
  });
});
