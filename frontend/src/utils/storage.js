import { Platform } from 'react-native';

let AsyncStorage = null;
if (Platform.OS !== 'web') {
  try {
    AsyncStorage = require('@react-native-async-storage/async-storage').default;
  } catch (e) {
    AsyncStorage = null;
  }
}

const memoryCache = new Map();
let initialized = false;

export const storage = {
  async init() {
    if (initialized) return;
    initialized = true;
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return;
    }
    if (AsyncStorage) {
      try {
        const keys = await AsyncStorage.getAllKeys();
        if (keys && keys.length > 0) {
          const pairs = await AsyncStorage.multiGet(keys);
          pairs.forEach(([k, v]) => {
            if (v !== null && v !== undefined) {
              memoryCache.set(k, v);
            }
          });
        }
      } catch (e) {
        // Ignore hydration errors
      }
    }
  },

  getItem(key) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        return memoryCache.get(key) ?? null;
      }
    }
    return memoryCache.has(key) ? memoryCache.get(key) : null;
  },

  async getItemAsync(key) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return this.getItem(key);
    }
    if (memoryCache.has(key)) {
      return memoryCache.get(key);
    }
    if (AsyncStorage) {
      try {
        const val = await AsyncStorage.getItem(key);
        if (val !== null) memoryCache.set(key, val);
        return val;
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  setItem(key, value) {
    const str = String(value);
    memoryCache.set(key, str);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, str);
      } catch (e) {
        // Ignore storage quota errors
      }
      return;
    }
    if (AsyncStorage) {
      AsyncStorage.setItem(key, str).catch(() => {});
    }
  },

  removeItem(key) {
    memoryCache.delete(key);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        // Ignore
      }
      return;
    }
    if (AsyncStorage) {
      AsyncStorage.removeItem(key).catch(() => {});
    }
  }
};

export default storage;
