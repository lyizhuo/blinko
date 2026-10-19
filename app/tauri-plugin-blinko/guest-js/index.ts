import { invoke } from '@tauri-apps/api/core'

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export async function setStatusBarColor(hexColor: string): Promise<null> {
  await invoke<{value?: string}>('plugin:blinko|setcolor', {
    payload: {
      hex: hexColor,
    },
  })
  return null
}

export async function openAppSettings(): Promise<void> {
  await invoke('plugin:blinko|open_app_settings')
}

/**
 * System bar and display cutout insets in density independent pixels.
 * The Android activity runs edge-to-edge so the WebView needs these to keep
 * interactive elements clear of the status and navigation bars.
 */
export async function getSafeAreaInsets(): Promise<SafeAreaInsets> {
  return await invoke<SafeAreaInsets>('plugin:blinko|get_safe_area_insets')
}
