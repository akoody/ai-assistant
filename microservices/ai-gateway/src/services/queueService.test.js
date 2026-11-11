import { describe, expect, test } from '@jest/globals';
import { resolveEffectiveLlmConfig, shouldUseRequestCache } from './queueService.js';

describe('queueService failover timeout', () => {
  test('caps timeout for non-last candidate when fallback exists', () => {
    const effective = resolveEffectiveLlmConfig(
      {
        modelId: 'qwen2.5',
        timeoutMs: 90000,
      },
      0,
      2
    );

    expect(effective.timeoutMs).toBe(45000);
  });

  test('keeps configured timeout for last candidate', () => {
    const effective = resolveEffectiveLlmConfig(
      {
        modelId: 'qwen-polza',
        timeoutMs: 90000,
      },
      1,
      2
    );

    expect(effective.timeoutMs).toBe(90000);
  });

  test('allows callers to bypass response cache', () => {
    expect(shouldUseRequestCache({})).toBe(true);
    expect(shouldUseRequestCache({ no_cache: false })).toBe(true);
    expect(shouldUseRequestCache({ no_cache: true })).toBe(false);
  });
});
