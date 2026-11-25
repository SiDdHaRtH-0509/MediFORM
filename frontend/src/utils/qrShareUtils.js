let Platform, Share, Linking;
try {
  const RN = require('react-native');
  Platform = RN.Platform;
  Share = RN.Share;
  Linking = RN.Linking;
} catch (e) {
  Platform = { OS: 'web' };
  Share = { share: async () => ({ action: 'sharedAction' }) };
  Linking = null;
}

let ExpoClipboard = null;
let ExpoFileSystem = null;
let ExpoSharing = null;
if (Platform && Platform.OS !== 'web') {
  try { ExpoClipboard = require('expo-clipboard'); } catch (e) {}
  try { ExpoFileSystem = require('expo-file-system'); } catch (e) {}
  try { ExpoSharing = require('expo-sharing'); } catch (e) {}
}

/**
 * Robust cross-platform clipboard copy helper (Web + iOS + Android).
 */
async function copyText(text) {
  if (!text || typeof text !== 'string') {
    return { success: false, error: 'Invalid text provided.' };
  }

  // Native iOS / Android via expo-clipboard
  if (Platform && Platform.OS !== 'web' && ExpoClipboard && typeof ExpoClipboard.setStringAsync === 'function') {
    try {
      await ExpoClipboard.setStringAsync(text);
      return { success: true, method: 'expo-clipboard' };
    } catch (err) {
      // fall through
    }
  }

  // 1. Primary Web: Modern Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'clipboard' };
    } catch (err) {
      // Fall through to DOM fallback
    }
  }

  // 2. Fallback Web: execCommand via temporary textarea
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
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

  // 3. Fallback Web Prompt
  if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
    try {
      window.prompt('Copy MediFORM Text:', text);
      return { success: true, method: 'prompt' };
    } catch (err) {
      // Ignore
    }
  }

  return { success: false, error: 'Clipboard copy unavailable or permission denied.' };
}

/**
 * Robust copy function for Secure Handoff URL.
 * Never copies PHI, PIN, JWT, or patient details.
 */
async function copyHandoffLink(url) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }
  return copyText(url);
}

/**
 * Reads clipboard text on Web / iOS / Android for fast handoff paste.
 */
async function pasteTextFromClipboard() {
  if (Platform && Platform.OS !== 'web' && ExpoClipboard && typeof ExpoClipboard.getStringAsync === 'function') {
    try {
      return await ExpoClipboard.getStringAsync();
    } catch (e) {
      return '';
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return '';
    }
  }
  return '';
}

/**
 * Opens tel:, sms:, https://wa.me, or Maps URL across Web, iOS, and Android.
 */
async function openExternalUrl(targetUrl) {
  if (!targetUrl) return { success: false, error: 'Empty target URL.' };
  try {
    if (Platform && Platform.OS === 'web' && typeof window !== 'undefined') {
      if (targetUrl.startsWith('tel:') || targetUrl.startsWith('sms:') || targetUrl.startsWith('mailto:')) {
        window.location.href = targetUrl;
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
      return { success: true };
    }
    if (Linking && typeof Linking.openURL === 'function') {
      await Linking.openURL(targetUrl);
      return { success: true };
    }
    return { success: false, error: 'Deep linking unavailable.' };
  } catch (err) {
    return { success: false, error: err.message || 'Unable to launch external app.' };
  }
}

/**
 * Shares the secure handoff link via Web Share API or Native Share Sheet.
 * Falls back to clipboard copy if Web Share is unsupported.
 */
async function shareHandoffLink(url, customMessage = null) {
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }

  // Web Platform
  if (Platform && Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'MediFORM Secure Handoff',
          text: customMessage || 'Secure medical handoff',
          url
        });
        return { success: true, method: 'web-share' };
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
          return { success: false, cancelled: true };
        }
        const copyRes = await copyHandoffLink(customMessage ? `${customMessage}\n${url}` : url);
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
      const copyRes = await copyHandoffLink(customMessage ? `${customMessage}\n${url}` : url);
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
      message: customMessage ? `${customMessage}\n${url}` : `MediFORM Secure Transfer Handoff Link:\n${url}`,
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
 * Converts an SVG DOM element to a PNG Blob with white background for readability (Web).
 */
function convertSvgToPngBlob(svgElement) {
  return new Promise((resolve, reject) => {
    if (!svgElement) {
      return reject(new Error('SVG element is missing.'));
    }
    try {
      const serializer = new XMLSerializer();
      let svgString = serializer.serializeToString(svgElement);

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

      img.onerror = () => {
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
 * Shares the actual QR code PNG image file on Web, iOS, and Android.
 * Falls back to Share Link if file sharing is unsupported.
 */
async function shareQrImage(svgElement, url, nativeSvgRef = null) {
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
          await shareHandoffLink(url);
          return {
            success: true,
            method: 'link-fallback',
            message: 'QR image sharing failed. Secure link shared instead.'
          };
        }
      } else {
        await shareHandoffLink(url);
        return {
          success: true,
          method: 'link-fallback',
          message: 'QR image sharing not supported by browser. Secure link shared instead.'
        };
      }
    } catch (err) {
      await shareHandoffLink(url);
      return {
        success: true,
        method: 'link-fallback',
        message: 'Failed to process QR image. Secure link shared instead.'
      };
    }
  }

  // Native Mobile (iOS / Android) via react-native-svg toDataURL + expo-file-system + expo-sharing
  if (nativeSvgRef && typeof nativeSvgRef.toDataURL === 'function' && ExpoFileSystem && ExpoSharing) {
    try {
      const base64Data = await new Promise((resolve) => {
        nativeSvgRef.toDataURL((data) => resolve(data));
      });
      if (base64Data) {
        const fileUri = `${ExpoFileSystem.cacheDirectory}mediform-handoff-qr.png`;
        await ExpoFileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: ExpoFileSystem.EncodingType.Base64
        });
        const canShare = await ExpoSharing.isAvailableAsync();
        if (canShare) {
          await ExpoSharing.shareAsync(fileUri, {
            mimeType: 'image/png',
            dialogTitle: 'Share MediFORM Secure Handoff QR'
          });
          return { success: true, method: 'native-share-file' };
        }
      }
    } catch (err) {
      // Fallback to native link share below
    }
  }

  return shareHandoffLink(url);
}

/**
 * Downloads the QR code PNG image file on Web, or shares/saves on Native Mobile.
 */
async function downloadQrImage(svgElement, filename = 'mediform-handoff-qr.png', nativeSvgRef = null) {
  if (!Platform || Platform.OS !== 'web' || typeof document === 'undefined') {
    if (nativeSvgRef) {
      return shareQrImage(null, 'https://mediform.health', nativeSvgRef);
    }
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
  copyText,
  copyHandoffLink,
  pasteTextFromClipboard,
  openExternalUrl,
  shareHandoffLink,
  convertSvgToPngBlob,
  shareQrImage,
  downloadQrImage
};
