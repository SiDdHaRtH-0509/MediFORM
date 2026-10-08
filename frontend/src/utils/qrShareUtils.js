let Platform, Share;
try {
  const RN = require('react-native');
  Platform = RN.Platform;
  Share = RN.Share;
} catch (e) {
  Platform = { OS: 'web' };
  Share = { share: async () => ({ action: 'sharedAction' }) };
}

/**
 * Robust copy function for Secure Handoff URL.
 * Never copies PHI, PIN, JWT, or patient details.
 */
async function copyHandoffLink(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }

  // 1. Primary: Modern Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(url);
      return { success: true, method: 'clipboard' };
    } catch (err) {
      // Fall through to DOM fallback on permission denial or restriction
    }
  }

  // 2. Fallback: Executive copy command via temporary textarea (Web)
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const copied = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (copied) {
        return { success: true, method: 'execCommand' };
      }
    } catch (err) {
      // Failed fallback
    }
  }

  // 3. Fallback: Prompt user with copy dialog if clipboard access fails
  if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
    try {
      window.prompt('Copy MediFORM Secure Handoff Link:', url);
      return { success: true, method: 'prompt' };
    } catch (err) {
      // Ignore
    }
  }

  return { success: false, error: 'Clipboard copy unavailable or permission denied.' };
}

/**
 * Shares the secure handoff link via Web Share API or Native Share Sheet.
 * Falls back to clipboard copy if Web Share is unsupported.
 */
async function shareHandoffLink(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }

  // Web Platform
  if (Platform && Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'MediFORM Secure Handoff',
          text: 'Secure medical handoff',
          url
        });
        return { success: true, method: 'web-share' };
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
          return { success: false, cancelled: true };
        }
        // Fallback to Copy Link on share failure
        const copyRes = await copyHandoffLink(url);
        if (copyRes.success) {
          return {
            success: true,
            method: 'copy-fallback',
            message: 'Web share failed. Secure link copied to clipboard instead.'
          };
        }
        return { success: false, error: err.message || 'Share operation failed.' };
      }
    } else {
      // Fallback to copy link if Web Share API is unavailable
      const copyRes = await copyHandoffLink(url);
      if (copyRes.success) {
        return {
          success: true,
          method: 'copy-fallback',
          message: 'Web share unsupported. Secure link copied to clipboard instead.'
        };
      }
      return { success: false, error: 'Web Share API unavailable and clipboard copy failed.' };
    }
  }

  // Native Mobile (Android / iOS)
  try {
    const result = await Share.share({
      title: 'MediFORM Secure Handoff',
      message: `MediFORM Secure Transfer Handoff Link:\n${url}`,
      url
    });
    if (result.action === Share.dismissedAction) {
      return { success: false, cancelled: true };
    }
    return { success: true, method: 'native-share' };
  } catch (err) {
    return { success: false, error: err.message || 'Native share failed.' };
  }
}

/**
 * Converts an SVG DOM element to a PNG Blob with white background for readability.
 */
function convertSvgToPngBlob(svgElement) {
  return new Promise((resolve, reject) => {
    if (!svgElement) {
      return reject(new Error('SVG element is missing.'));
    }
    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svgElement);

      // Ensure xmlns attribute exists
      if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const URL = (typeof window !== 'undefined' ? window.URL || window.webkitURL : null) || global.URL;
      const blobUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const width = svgElement.clientWidth || svgElement.getBoundingClientRect?.()?.width || 300;
        const height = svgElement.clientHeight || svgElement.getBoundingClientRect?.()?.height || 300;

        canvas.width = Math.max(width, 250);
        canvas.height = Math.max(height, 250);

        const ctx = canvas.getContext('2d');
        // Fill white background for scan contrast
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        URL.revokeObjectURL(blobUrl);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to generate PNG Blob from canvas.'));
          }
        }, 'image/png');
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('Failed to render SVG image to canvas.'));
      };

      img.src = blobUrl;
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Shares the actual QR code PNG image file on platforms supporting file sharing.
 * Falls back to Share Link if file sharing is unsupported.
 */
async function shareQrImage(svgElement, url) {
  if (Platform && Platform.OS === 'web') {
    if (!svgElement) {
      return shareHandoffLink(url);
    }

    try {
      const blob = await convertSvgToPngBlob(svgElement);
      const file = new File([blob], 'mediform-handoff-qr.png', { type: 'image/png' });

      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({
            title: 'MediFORM Secure Handoff',
            text: 'Scan this secure MediFORM handoff QR',
            files: [file]
          });
          return { success: true, method: 'web-share-file' };
        } catch (err) {
          if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
            return { success: false, cancelled: true };
          }
          const linkRes = await shareHandoffLink(url);
          return {
            success: true,
            method: 'link-fallback',
            message: 'QR image sharing failed. Secure link shared instead.'
          };
        }
      } else {
        const linkRes = await shareHandoffLink(url);
        return {
          success: true,
          method: 'link-fallback',
          message: 'QR image sharing not supported by browser. Secure link shared instead.'
        };
      }
    } catch (err) {
      const linkRes = await shareHandoffLink(url);
      return {
        success: true,
        method: 'link-fallback',
        message: 'Failed to process QR image. Secure link shared instead.'
      };
    }
  }

  return {
    success: false,
    method: 'unavailable',
    message: 'QR image sharing is unavailable on this device. Share Link instead.'
  };
}

/**
 * Downloads the QR code PNG image file on Web.
 */
async function downloadQrImage(svgElement, filename = 'mediform-handoff-qr.png') {
  if (!Platform || Platform.OS !== 'web' || typeof document === 'undefined') {
    return { success: false, error: 'QR Download is only available on web browsers.' };
  }

  if (!svgElement) {
    return { success: false, error: 'QR Code element is not ready for download.' };
  }

  try {
    const blob = await convertSvgToPngBlob(svgElement);
    const URL = (typeof window !== 'undefined' ? window.URL || window.webkitURL : null) || global.URL;
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    return { success: true, filename };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to download QR image.' };
  }
}

module.exports = {
  copyHandoffLink,
  shareHandoffLink,
  convertSvgToPngBlob,
  shareQrImage,
  downloadQrImage
};
