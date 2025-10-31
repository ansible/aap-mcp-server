import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLogIcon, injectAnalytics } from './utils.js';

// Mock the analytics module at the top level
vi.mock('../analytics.js', () => ({
  getSegmentSnippet: vi.fn((writeKey: string) => `<script>/* Segment snippet for ${writeKey} */</script>`),
  getAnalyticsTrackingCode: vi.fn(() => `<script>/* Analytics tracking code */</script>`)
}));

describe('View Utils', () => {
  describe('getLogIcon', () => {
    it('should return correct icon for info severity', () => {
      expect(getLogIcon('info')).toBe('ℹ️');
      expect(getLogIcon('INFO')).toBe('ℹ️');
      expect(getLogIcon('Info')).toBe('ℹ️');
    });

    it('should return correct icon for warn severity', () => {
      expect(getLogIcon('warn')).toBe('⚠️');
      expect(getLogIcon('WARN')).toBe('⚠️');
      expect(getLogIcon('Warn')).toBe('⚠️');
    });

    it('should return correct icon for err severity', () => {
      expect(getLogIcon('err')).toBe('❌');
      expect(getLogIcon('ERR')).toBe('❌');
      expect(getLogIcon('Err')).toBe('❌');
    });

    it('should return default icon for unknown severity', () => {
      expect(getLogIcon('unknown')).toBe('📝');
      expect(getLogIcon('')).toBe('📝');
      expect(getLogIcon('debug')).toBe('📝');
    });
  });

  describe('injectAnalytics', () => {
    const mockHtml = `
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Hello World</h1>
</body>
</html>`;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should inject analytics when enabled with write key', async () => {
      const result = await injectAnalytics(mockHtml, true, 'test_write_key');
      
      expect(result).toContain('Segment snippet for test_write_key');
      expect(result).toContain('Analytics tracking code');
      expect(result).toMatch(/<script>\/\* Segment snippet for test_write_key \*\/<\/script>\s*<script>\/\* Analytics tracking code \*\/<\/script>\s*<\/body>/);
    });

    it('should not inject analytics when disabled', async () => {
      const result = await injectAnalytics(mockHtml, false, 'test_write_key');
      
      expect(result).toBe(mockHtml);
      expect(result).not.toContain('Segment snippet');
      expect(result).not.toContain('Analytics tracking code');
    });

    it('should not inject analytics when no write key provided', async () => {
      const result = await injectAnalytics(mockHtml, true);
      
      expect(result).toBe(mockHtml);
      expect(result).not.toContain('Segment snippet');
    });

    it('should not inject analytics when write key is empty', async () => {
      const result = await injectAnalytics(mockHtml, true, '');
      
      expect(result).toBe(mockHtml);
      expect(result).not.toContain('Segment snippet');
    });

    it('should handle HTML without body tag gracefully', async () => {
      const htmlWithoutBody = '<html><head><title>Test</title></head></html>';
      const result = await injectAnalytics(htmlWithoutBody, true, 'test_key');
      
      expect(result).toBe(htmlWithoutBody);
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
  });
});