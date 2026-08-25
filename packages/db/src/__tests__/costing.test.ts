import { describe, expect, it } from 'vitest';
import { nextAverageCost } from '../costing';

describe('nextAverageCost', () => {
  it('is the unit cost of the receipt when there was no prior position', () => {
    // 10 units received at 500 piastres each, total cost 5000 — nothing held
    // before, so the average IS this receipt's own unit cost.
    expect(nextAverageCost(0, null, 10, 5000n)).toBe(500n);
  });

  it('weights the average by quantity, not by receipt count', () => {
    // 10 units already held at 500/unit (5000 total), receiving 10 more at
    // 700/unit (7000 total) -> 12000 / 20 = 600, not the simple average of
    // 500 and 700 (which would be 600 here by coincidence — use an uneven
    // split below to distinguish the two).
    expect(nextAverageCost(10, 500n, 10, 7000n)).toBe(600n);
  });

  it('weights toward the larger position, not a flat average of the two costs', () => {
    // 90 units at 100/unit (9000 total) plus 10 units at 1000/unit (10000
    // total): weighted average is 19000/100 = 190. A flat average of the two
    // unit costs would wrongly give 550.
    expect(nextAverageCost(90, 100n, 10, 10_000n)).toBe(190n);
  });

  it('rounds to the nearest piastre, ties to even', () => {
    // 1 unit at 1 (total 1) plus 1 unit at 2 (total 2): (1+2)/2 = 1.5 -> 2
    // (rounds to the even neighbour).
    expect(nextAverageCost(1, 1n, 1, 2n)).toBe(2n);
    // 3 units at 1 (total 3) plus 1 unit at 2 (total 2): (3+2)/4 = 1.25 -> 1.
    expect(nextAverageCost(3, 1n, 1, 2n)).toBe(1n);
  });

  it('rejects a non-positive receipt quantity', () => {
    // A receipt of zero or fewer units cannot supply a cost basis to average
    // against — that is what recordCostedReceipt not being called at all
    // means, not this function being asked to divide by zero.
    expect(() => nextAverageCost(10, 500n, 0, 0n)).toThrow(RangeError);
    expect(() => nextAverageCost(10, 500n, -5, 100n)).toThrow(RangeError);
  });

  it('treats a negative held quantity as zero rather than reducing the total', () => {
    // inventory_items.quantity can go negative under an oversell race that
    // outran the P3 stock guard on some historical row; this function must
    // not let a negative prior quantity subtract from the weighted total.
    expect(nextAverageCost(-5, 500n, 10, 5000n)).toBe(500n);
  });
});
