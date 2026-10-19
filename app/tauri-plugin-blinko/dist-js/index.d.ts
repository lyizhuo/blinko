export interface SafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
export declare function setStatusBarColor(hexColor: string): Promise<null>;
export declare function openAppSettings(): Promise<void>;
/**
 * System bar and display cutout insets in density independent pixels.
 * The Android activity runs edge-to-edge so the WebView needs these to keep
 * interactive elements clear of the status and navigation bars.
 */
export declare function getSafeAreaInsets(): Promise<SafeAreaInsets>;
