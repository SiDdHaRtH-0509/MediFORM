import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import { COLORS } from '../../constants/theme';

/**
 * 4-Second Initial Splash Screen & Video Loader Component for MediFORM V2.
 * Plays the project loader video (assets/loader.mp4) exclusively during initial launch (4000ms).
 */
export function SplashScreenLoader({ duration = 4000, onFinish }) {
  const [progress, setProgress] = useState(0);
  const [videoError, setVideoError] = useState(false);

  // Metro / Expo asset reference for loader video
  let loaderVideoSrc = '/assets/loader.mp4';
  try {
    const asset = require('../../../assets/loader.mp4');
    if (typeof asset === 'string') {
      loaderVideoSrc = asset;
    } else if (asset && asset.default) {
      loaderVideoSrc = asset.default;
    } else if (asset && asset.uri) {
      loaderVideoSrc = asset.uri;
    }
  } catch (e) {
    loaderVideoSrc = '/assets/loader.mp4';
  }

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(pct);

      if (elapsed >= duration) {
        clearInterval(interval);
        if (onFinish) {
          onFinish();
        }
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration, onFinish]);

  return (
    <View style={styles.container}>
      {/* FULL SCREEN VIDEO DISPLAY */}
      {Platform.OS === 'web' && !videoError ? (
        <View style={styles.fullScreenVideoWrapper}>
          <video
            src={loaderVideoSrc}
            autoPlay
            muted
            playsInline
            loop
            onError={(e) => {
              const videoEl = e.target;
              if (videoEl.src.includes('/assets/loader.mp4')) {
                videoEl.src = '/loader.mp4';
              } else if (videoEl.src.includes('/loader.mp4')) {
                videoEl.src = 'assets/loader.mp4';
              } else {
                setVideoError(true);
              }
            }}
            id="mediform-loader-video"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              objectFit: 'cover',
              zIndex: 1,
            }}
          />
        </View>
      ) : null}

      {/* FALLBACK LOGO DISPLAY ONLY IF VIDEO FAILS OR ON NATIVE */}
      {(Platform.OS !== 'web' || videoError) && (
        <View style={styles.fallbackContainer}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.logoImage}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999999,
  },
  fullScreenVideoWrapper: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 120,
    height: 120,
    resizeMode: 'contain',
  }
});
