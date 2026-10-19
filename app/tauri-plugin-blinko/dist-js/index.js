import { invoke } from '@tauri-apps/api/core';

async function setStatusBarColor(hexColor) {
    await invoke('plugin:blinko|setcolor', {
        payload: {
            hex: hexColor,
        },
    });
    return null;
}
async function openAppSettings() {
    await invoke('plugin:blinko|open_app_settings');
}
async function getSafeAreaInsets() {
    return await invoke('plugin:blinko|get_safe_area_insets');
}

export { getSafeAreaInsets, openAppSettings, setStatusBarColor };
