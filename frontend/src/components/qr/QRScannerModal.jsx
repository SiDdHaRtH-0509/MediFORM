import React from 'react';
import { UniversalQRScannerModal } from './UniversalQRScannerModal';

/**
 * Legacy wrapper for backward compatibility.
 * Delegates directly to UniversalQRScannerModal.
 */
export function QRScannerModal(props) {
  return <UniversalQRScannerModal {...props} />;
}

export { UniversalQRScannerModal };
