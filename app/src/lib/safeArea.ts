import { getSafeAreaInsets } from 'tauri-plugin-blinko-api';
import { isAndroid } from './tauriHelper';

/**
 * The Android activity draws edge-to-edge, so the WebView covers the system bars.
 * Recent WebViews expose the insets through `env(safe-area-inset-*)`; older ones
 * report 0, so ask the native side and publish the values as CSS custom properties
 * on `documentElement` (which override the `:root` env() fallback).
 */
export async function applySafeAreaInsets() {
  if (!isAndroid()) return;
  try {
    const insets = await getSafeAreaInsets();
    const style = document.documentElement.style;
    style.setProperty('--safe-area-inset-top', `${insets.top}px`);
    style.setProperty('--safe-area-inset-right', `${insets.right}px`);
    style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
    style.setProperty('--safe-area-inset-left', `${insets.left}px`);
  } catch (error) {
    console.warn('Failed to read safe area insets, falling back to env()', error);
  }
}
