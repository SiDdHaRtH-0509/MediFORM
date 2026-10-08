const {
  copyHandoffLink,
  shareHandoffLink,
  convertSvgToPngBlob,
  shareQrImage,
  downloadQrImage
} = require('../../frontend/src/utils/qrShareUtils');

describe('QR & Link Sharing Utilities (qrShareUtils)', () => {
  const sampleUrl = 'https://mediform.health/handoff/12345678-abcd-ef01-2345-6789abcdef01';

  beforeEach(() => {
    // Setup global browser polyfills for Node test environment
    global.navigator = {
      clipboard: undefined,
      share: undefined,
      canShare: undefined
    };

    global.document = {
      createElement: jest.fn().mockImplementation((tag) => {
        if (tag === 'textarea') {
          return {
            value: '',
            style: {},
            focus: jest.fn(),
            select: jest.fn()
          };
        }
        if (tag === 'canvas') {
          return {
            width: 300,
            height: 300,
            getContext: jest.fn().mockReturnValue({
              fillStyle: '',
              fillRect: jest.fn(),
              drawImage: jest.fn()
            }),
            toBlob: jest.fn().mockImplementation((cb) => {
              cb(new global.Blob(['fake-png-data'], { type: 'image/png' }));
            })
          };
        }
        if (tag === 'a') {
          return {
            href: '',
            download: '',
            click: jest.fn()
          };
        }
        return {};
      }),
      body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
      },
      execCommand: jest.fn().mockReturnValue(true)
    };

    global.Blob = class Blob {
      constructor(content, options) {
        this.content = content;
        this.type = options?.type || '';
      }
    };

    global.File = class File extends global.Blob {
      constructor(content, name, options) {
        super(content, options);
        this.name = name;
      }
    };

    global.XMLSerializer = class XMLSerializer {
      serializeToString() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"></svg>';
      }
    };

    global.URL = {
      createObjectURL: jest.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: jest.fn()
    };

    global.window = {
      URL: global.URL
    };
  });

  describe('1. copyHandoffLink', () => {
    test('Copies secure handoff URL via navigator.clipboard.writeText when available', async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      global.navigator.clipboard = { writeText: writeTextMock };

      const res = await copyHandoffLink(sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('clipboard');
      expect(writeTextMock).toHaveBeenCalledWith(sampleUrl);
      expect(sampleUrl).not.toContain('PIN');
      expect(sampleUrl).not.toContain('patient');
    });

    test('Falls back to document.execCommand when navigator.clipboard throws', async () => {
      global.navigator.clipboard = {
        writeText: jest.fn().mockRejectedValue(new Error('Permission denied'))
      };

      const res = await copyHandoffLink(sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('execCommand');
      expect(document.execCommand).toHaveBeenCalledWith('copy');
    });

    test('Returns error if both Clipboard API and document.execCommand fail', async () => {
      global.navigator.clipboard = {
        writeText: jest.fn().mockRejectedValue(new Error('Blocked'))
      };
      global.document.execCommand.mockReturnValue(false);

      const res = await copyHandoffLink(sampleUrl);

      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('2. shareHandoffLink', () => {
    test('Calls navigator.share when available on Web', async () => {
      const shareMock = jest.fn().mockResolvedValue(undefined);
      global.navigator.share = shareMock;

      const res = await shareHandoffLink(sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('web-share');
      expect(shareMock).toHaveBeenCalledWith({
        title: 'MediFORM Secure Handoff',
        text: 'Secure medical handoff',
        url: sampleUrl
      });
    });

    test('Handles AbortError (user share cancellation) gracefully without error', async () => {
      const abortError = new Error('Share canceled');
      abortError.name = 'AbortError';
      global.navigator.share = jest.fn().mockRejectedValue(abortError);

      const res = await shareHandoffLink(sampleUrl);

      expect(res.success).toBe(false);
      expect(res.cancelled).toBe(true);
    });

    test('Falls back to copy link when navigator.share is unavailable', async () => {
      global.navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };

      const res = await shareHandoffLink(sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('copy-fallback');
    });
  });

  describe('3. shareQrImage & downloadQrImage', () => {
    test('downloadQrImage creates download link and triggers click on Web', async () => {
      const fakeSvg = { clientWidth: 200, clientHeight: 200 };

      global.Image = class {
        set src(val) {
          setTimeout(() => this.onload && this.onload(), 10);
        }
      };

      const res = await downloadQrImage(fakeSvg, 'mediform-handoff-qr.png');

      expect(res.success).toBe(true);
      expect(res.filename).toBe('mediform-handoff-qr.png');
    });

    test('shareQrImage uses navigator.share with files if navigator.canShare returns true', async () => {
      const fakeSvg = { clientWidth: 200, clientHeight: 200 };

      global.Image = class {
        set src(val) {
          setTimeout(() => this.onload && this.onload(), 10);
        }
      };

      const shareMock = jest.fn().mockResolvedValue(undefined);
      global.navigator.share = shareMock;
      global.navigator.canShare = jest.fn().mockReturnValue(true);

      const res = await shareQrImage(fakeSvg, sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('web-share-file');
      expect(shareMock).toHaveBeenCalled();
    });

    test('shareQrImage falls back to Share Link if navigator.canShare returns false', async () => {
      const fakeSvg = { clientWidth: 200, clientHeight: 200 };

      global.Image = class {
        set src(val) {
          setTimeout(() => this.onload && this.onload(), 10);
        }
      };

      global.navigator.canShare = jest.fn().mockReturnValue(false);
      global.navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };

      const res = await shareQrImage(fakeSvg, sampleUrl);

      expect(res.success).toBe(true);
      expect(res.method).toBe('link-fallback');
    });
  });
});
