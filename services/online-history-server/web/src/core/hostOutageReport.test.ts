import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminClientId } from './adminClientId';
import {
  PENDING_HOST_OUTAGE_KEY,
  buildHostOutageReportBody,
  clearPendingHostOutageReport,
  loadPendingHostOutageReport,
  savePendingHostOutageReport,
} from './hostOutageReport';

describe('host outage report (D6)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('buildHostOutageReportBody formats from/to ISO', () => {
    const body = buildHostOutageReportBody(
      'tab-1',
      Date.parse('2026-06-01T10:00:00.000Z'),
      Date.parse('2026-06-01T10:04:00.000Z'),
    );
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

  it('pending report survives save/load and clears after success', () => {
    savePendingHostOutageReport({
      clientId: 'c1',
      fromMs: 1_720_000_000_000,
      toMs: null,
    });
    expect(localStorage.getItem(PENDING_HOST_OUTAGE_KEY)).toBeTruthy();
    expect(loadPendingHostOutageReport()).toEqual({
      clientId: 'c1',
      fromMs: 1_720_000_000_000,
      toMs: null,
    });

    savePendingHostOutageReport({
      clientId: 'c1',
      fromMs: 1_720_000_000_000,
      toMs: 1_720_000_060_000,
    });
    expect(loadPendingHostOutageReport()?.toMs).toBe(1_720_000_060_000);

    clearPendingHostOutageReport();
    expect(loadPendingHostOutageReport()).toBeNull();
    expect(localStorage.getItem(PENDING_HOST_OUTAGE_KEY)).toBeNull();
  });

  it('load drops corrupt payload', () => {
    localStorage.setItem(PENDING_HOST_OUTAGE_KEY, '{not-json');
    expect(loadPendingHostOutageReport()).toBeNull();
  });
});
