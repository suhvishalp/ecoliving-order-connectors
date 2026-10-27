import { describe, expect, it } from 'vitest';
import { extensionUrl } from '../src/connector/post-deploy.js';

describe('extensionUrl', () => {
  it('keeps the URL Connect injects, which already ends with the endpoint', () => {
    expect(extensionUrl('https://service-abc.europe-west1.gcp.4.sandbox.commercetools.app/cart-rules', '/cart-rules'))
      .toBe('https://service-abc.europe-west1.gcp.4.sandbox.commercetools.app/cart-rules');
  });
  it('appends the endpoint to a bare host (local runs)', () => {
    expect(extensionUrl('http://localhost:8080/', '/cart-rules')).toBe('http://localhost:8080/cart-rules');
  });
});
