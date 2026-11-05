import { getSafeAreaInsets } from 'tauri-plugin-blinko-api';
import { isAndroid } from './tauriHelper';

/**
 * The Android activity draws edge-to-edge, so the WebView covers the system bars.
 * Recent WebViews expose the insets through `env(safe-area-inset-*)`; older ones
 * report 0, so ask the native side and publish the values as CSS custom properties
 * on `documentElement` (which override the `:root` env() fallback).
 *
 * The activity can still be laying out when the WebView mounts, and a `0` read
 * at that moment would overwrite a valid `env()` fallback and leave the header
 * under the status bar. Values are therefore only published once a top inset is
 * actually reported, and the caller retries shortly after startup.
 */
export async function applySafeAreaInsets(): Promise<boolean> {
  if (!isAndroid()) return true;
  try {
    const insets = await getSafeAreaInsets();
    if (!insets || insets.top <= 0) return false;
    const style = document.documentElement.style;
    style.setProperty('--safe-area-inset-top', `${insets.top}px`);
    style.setProperty('--safe-area-inset-right', `${insets.right}px`);
    style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
    style.setProperty('--safe-area-inset-left', `${insets.left}px`);
    return true;
  } catch (error) {
    console.warn('Failed to read safe area insets, falling back to env()', error);
    return false;
  }
}
