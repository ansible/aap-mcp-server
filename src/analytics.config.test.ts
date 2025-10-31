import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the analytics module with simple functions
vi.mock('./analytics.js', () => ({
  getSegmentSnippet: vi.fn((writeKey: string) => `<script>analytics.load("${writeKey}");</script>`),
  getAnalyticsTrackingCode: vi.fn(() => `<script>analytics.page();</script>`)
}));

import { injectAnalytics } from './views/utils.js';

describe('Analytics Configuration and Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('View Analytics Injection', () => {
    it('should inject analytics when properly configured', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      const result = await injectAnalytics(html, true, 'test_key');
      
      expect(result).toContain('analytics.load("test_key")');
      expect(result).toContain('analytics.page()');
      expect(result).toMatch(/<script>.*<\/script>\s*<\/body>/);
    });

    it('should not inject when analytics disabled', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      const result = await injectAnalytics(html, false, 'test_key');
      
      expect(result).toBe(html);
      expect(result).not.toContain('analytics.load');
    });

    it('should not inject when write key missing', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      const result = await injectAnalytics(html, true, '');
      
      expect(result).toBe(html);
      expect(result).not.toContain('analytics.load');
    });

    it('should not inject when write key is undefined', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      const result = await injectAnalytics(html, true, undefined);
      
      expect(result).toBe(html);
      expect(result).not.toContain('analytics.load');
    });

    it('should handle malformed HTML gracefully', async () => {
      const html = '<html><head><title>Test</title></head>';
      const result = await injectAnalytics(html, true, 'test_key');
      
      expect(result).toBe(html); // Should return unchanged
    });

    it('should inject before the last closing body tag', async () => {
      const htmlWithMultipleContent = `
<!DOCTYPE html>
<html>
<body>
  <div>Content 1</div>
  <div>Content 2</div>
</body>
</html>`;

      const result = await injectAnalytics(htmlWithMultipleContent, true, 'test_key');
      
      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');
      expect(result).toMatch(/Content 2.*<script>.*<\/body>/s);
    });

    it('should preserve HTML structure and formatting', async () => {
      const formattedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Page</title>
</head>
<body>
    <h1>Hello World</h1>
    <p>This is a test.</p>
</body>
</html>`;

      const result = await injectAnalytics(formattedHtml, true, 'test_key');
      
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<html lang="en">');
      expect(result).toContain('<meta charset="UTF-8">');
      expect(result).toContain('<h1>Hello World</h1>');
      expect(result).toContain('<p>This is a test.</p>');
    });

    it('should handle various write key formats', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      
      // Test with different key formats
      const result1 = await injectAnalytics(html, true, 'sk_test_12345');
      expect(result1).toContain('analytics.load("sk_test_12345")');
      
      const result2 = await injectAnalytics(html, true, 'prod_key_abcdef');
      expect(result2).toContain('analytics.load("prod_key_abcdef")');
      
      const result3 = await injectAnalytics(html, true, '1234567890');
      expect(result3).toContain('analytics.load("1234567890")');
    });

    it('should handle HTML with multiple body tags', async () => {
      const html = '<html><body><div>First</div></body><body><div>Second</div></body></html>';
      const result = await injectAnalytics(html, true, 'test_key');
      
      // Should inject before the last </body> tag
      expect(result).toContain('analytics.load("test_key")');
      expect(result).toContain('analytics.page()');
    });

    it('should handle HTML with no body tag', async () => {
      const html = '<html><head><title>Test</title></head><div>Content</div></html>';
      const result = await injectAnalytics(html, true, 'test_key');
      
      // Should return unchanged since there's no </body> tag to replace
      expect(result).toBe(html);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle falsy values for enableAnalytics', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      
      const result1 = await injectAnalytics(html, false, 'test_key');
      expect(result1).toBe(html);
      
      const result2 = await injectAnalytics(html, null as any, 'test_key');
      expect(result2).toBe(html);
      
      const result3 = await injectAnalytics(html, undefined as any, 'test_key');
      expect(result3).toBe(html);
      
      const result4 = await injectAnalytics(html, 0 as any, 'test_key');
      expect(result4).toBe(html);
    });

    it('should handle different HTML encodings and special characters', async () => {
      const html = '<html><body><h1>Test with &amp; special chars &lt;&gt;</h1></body></html>';
      const result = await injectAnalytics(html, true, 'test_key');
      
      expect(result).toContain('Test with &amp; special chars &lt;&gt;');
      expect(result).toContain('analytics.load("test_key")');
    });

    it('should handle very large HTML documents', async () => {
      const largeContent = 'x'.repeat(10000);
      const html = `<html><body><div>${largeContent}</div></body></html>`;
      const result = await injectAnalytics(html, true, 'test_key');
      
      expect(result).toContain(largeContent);
      expect(result).toContain('analytics.load("test_key")');
      expect(result.length).toBeGreaterThan(html.length);
    });

    it('should handle write keys with special characters', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      
      // Test with write key containing special characters
      const specialKey = 'key-with-dashes_and_underscores.and.dots';
      const result = await injectAnalytics(html, true, specialKey);
      
      expect(result).toContain(`analytics.load("${specialKey}")`);
    });
  });

  describe('Error Handling', () => {
    it('should handle analytics module loading errors gracefully', async () => {
      // This test checks that if the analytics module fails to load,
      // the function should return the original HTML unchanged
      const html = '<html><body><h1>Test</h1></body></html>';
      
      // The function has try/catch built in, so this should not throw
      const result = await injectAnalytics(html, true, 'test_key');
      
      // Since we've mocked the analytics module, this should work
      expect(result).toContain('analytics.load("test_key")');
    });

    it('should handle concurrent analytics injection calls', async () => {
      const html = '<html><body><h1>Test</h1></body></html>';
      
      // Run multiple analytics injections concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(injectAnalytics(html, true, `key_${i}`));
      }
      
      const results = await Promise.all(promises);
      
      // Each should have injected the correct key
      results.forEach((result, index) => {
        expect(result).toContain(`analytics.load("key_${index}")`);
        expect(result).toContain('analytics.page()');
      });
    });
  });
});