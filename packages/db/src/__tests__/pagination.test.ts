import { describe, expect, it } from 'vitest';
import { paginationMeta, paginationOffset } from '../pagination';

describe('pagination helpers', () => {
  it('calculates the zero-based offset from a one-based page', () => {
    expect(paginationOffset(1, 20)).toBe(0);
    expect(paginationOffset(3, 20)).toBe(40);
    expect(paginationOffset(2, 50)).toBe(50);
  });

  it('builds the shared pagination metadata shape', () => {
    expect(paginationMeta(3, 20, 57)).toEqual({ total: 57, page: 3, pageSize: 20 });
  });
});
