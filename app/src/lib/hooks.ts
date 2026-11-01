import { useEffect, useState, useRef } from "react";
import { helper } from "./helper";
import { BlinkoStore } from "@/store/blinkoStore";
import { RootStore } from "@/store";
import { isAndroid, isInTauri } from '@/lib/tauriHelper';
import { ShowEditBlinkoModel } from '@/components/BlinkoRightClickMenu';
import { eventBus } from '@/lib/event';

import { readFile } from "@tauri-apps/plugin-fs";
import { FocusEditorFixMobile } from "@/components/Common/Editor/editorUtils";
import { ToastPlugin } from "@/store/module/Toast/Toast";

export const useConfigSetting = (configKey: keyof BlinkoStore['config']['value']) => {
  const blinko = RootStore.Get(BlinkoStore);

  const store = RootStore.Local(() => ({
    value: '',
    isVisible: false,
    setValue(newValue: string) {
      this.value = newValue;
    },
    toggleVisibility() {
      this.isVisible = !this.isVisible;
    }
  }));

  useEffect(() => {
    if (blinko.config.value && blinko.config.value[configKey]) {
      store.setValue(blinko.config.value[configKey] as string);
    }
  }, [blinko.config.value, configKey]);

  return {
    value: store.value,
    isVisible: store.isVisible,
    setValue: store.setValue,
    toggleVisibility: store.toggleVisibility
  };
};


const SWIPE_IGNORE_SELECTOR = '.PhotoView-Portal, [role="dialog"], [data-swipe-ignore]';

/**
 * Shows the mobile bottom bar while the finger moves down and hides it while it
 * moves up.
 *
 * The previous implementation re-anchored the touch origin on every move, so one
 * long drag could toggle the bar dozens of times (the "flickering" the bar had on
 * device), and it also reacted to horizontal swipes and to drags inside the image
 * viewer, dialogs and carousels. This version only follows a single vertical
 * gesture, ignores those overlays, and rate-limits consecutive toggles.
 */
export const useSwiper = (threshold = 64) => {
  const [isVisible, setIsVisible] = useState(true);
  const startY = useRef(0);
  const startX = useRef(0);
  const tracking = useRef(false);
  const lastToggleAt = useRef(0);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking.current = false;
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(SWIPE_IGNORE_SELECTOR)) {
        tracking.current = false;
        return;
      }
      tracking.current = true;
      startY.current = event.touches[0]!.clientY;
      startX.current = event.touches[0]!.clientX;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!tracking.current || event.touches.length !== 1) return;

      const deltaY = event.touches[0]!.clientY - startY.current;
      const deltaX = event.touches[0]!.clientX - startX.current;

      // Horizontal gesture (page swipe / carousel): stop following this touch.
      if (Math.abs(deltaX) > 24 && Math.abs(deltaX) > Math.abs(deltaY)) {
        tracking.current = false;
        return;
      }

      if (Math.abs(deltaY) < threshold) return;

      const now = Date.now();
      if (now - lastToggleAt.current < 150) return;

      // Finger moving down means the content is scrolling back up: reveal the bar.
      const shouldShow = deltaY > 0;
      setIsVisible(previous => (previous === shouldShow ? previous : shouldShow));
      lastToggleAt.current = now;
      // Re-anchor so the remainder of a long drag cannot toggle again.
      startY.current = event.touches[0]!.clientY;
    };

    const handleTouchEnd = () => {
      tracking.current = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [threshold]);

  return isVisible;
};


export const handlePaste = (event) => {
  //@ts-ignore
  const clipboardData = event.clipboardData || window.clipboardData;
  const items = clipboardData.items;
  let files = [];

  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === "file") {
      const file = items[i].getAsFile();
      //@ts-ignore
      files.push(file);
    }
  }

  if (files.length > 0) {
    return files
  }
};


export const usePasteFile = (targetRef) => {
  const [pastedFiles, setPastedFiles] = useState([]);

  useEffect(() => {


    const targetElement = targetRef.current;

    if (targetElement) {
      targetElement.addEventListener("paste", handlePaste);
    }

    return () => {
      if (targetElement) {
        targetElement.removeEventListener("paste", handlePaste);
      }
    };
  }, [targetRef]);

  return pastedFiles;
};


interface HistoryBackProps<T extends string> {
  state: boolean;
  onStateChange: () => void;
  historyState: T;
}

export const useHistoryBack = <T extends string>({
  state,
  onStateChange,
  historyState
}: HistoryBackProps<T>) => {
  useEffect(() => {
    if (state) {
      try {
        const currentPath = window.location.pathname + window.location.search;
        history.pushState({
          [historyState]: true,
          timestamp: Date.now(),
          path: currentPath
        }, '', currentPath);
      } catch (error) {
        console.warn('History pushState failed:', error);
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      if (state && event?.state) {
        onStateChange();
      }
    };

    try {
      window.addEventListener('popstate', handlePopState);
    } catch (error) {
      console.warn('Failed to add popstate listener:', error);
    }

    return () => {
      try {
        window.removeEventListener('popstate', handlePopState);
      } catch (error) {
        console.warn('Failed to remove popstate listener:', error);
      }
    };
  }, [state, onStateChange, historyState]);
};

export const useIsIOS = () => {
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    setIsIOS(helper.env.isIOS());
  }, []);
  return isIOS;
};

// Global state for Android shortcuts handling
let androidShortcutsIntervalId: NodeJS.Timeout | null = null;
let isProcessingSharedData = false;
let isInitialized = false;

// Singleton function to initialize Android shortcuts listener
const initializeAndroidShortcuts = () => {
  if (isInitialized || !isAndroid() || !isInTauri()) {
    return;
  }

  isInitialized = true;

  const checkAndroidData = () => {
      // Handle shortcuts
      const action = window.localStorage.getItem('android_shortcut_action');
      if (action) {
        window.localStorage.removeItem('android_shortcut_action');
        switch (action) {
          case 'quick_note':
            ShowEditBlinkoModel('2xl', 'create');
            FocusEditorFixMobile()
            break;

          case 'voice_recording':
            ShowEditBlinkoModel('2xl', 'create');
            // Use eventBus to trigger audio recording after editor is ready
            setTimeout(() => {
              eventBus.emit('editor:startAudioRecording');
            }, 300);
            break;
        }
      }

      // Handle shared data
      const shareDataStr = window.localStorage.getItem('android_share_data');
      if (shareDataStr && !isProcessingSharedData) {
        isProcessingSharedData = true;
        // alert(shareDataStr)
        window.localStorage.removeItem('android_share_data');
        try {
          const shareData = JSON.parse(shareDataStr);
          if (shareData.text) {
            // Remove surrounding quotes (single, double, backticks) and trim whitespace
            let cleanText = shareData.text.trim();
            if ((cleanText.startsWith('"') && cleanText.endsWith('"')) ||
                (cleanText.startsWith("'") && cleanText.endsWith("'")) ||
                (cleanText.startsWith('`') && cleanText.endsWith('`'))) {
              cleanText = cleanText.slice(1, -1);
            }
            ShowEditBlinkoModel('2xl', 'create', { text: cleanText });
            isProcessingSharedData = false;
          }
          else if (shareData.stream && shareData.content_type) {
            readFile(shareData.stream).then(contents => {
              const file = new File([contents], shareData.name || 'shared_file', {
                type: shareData.content_type
              });
              console.log('xxx!!!')
              ShowEditBlinkoModel('2xl', 'create', { file });
              isProcessingSharedData = false;
            }).catch((error: Error) => {
              console.warn('fetching shared content failed:', error);
              RootStore.Get(ToastPlugin).error(error?.message)
              isProcessingSharedData = false;
            });
          }
          else {
            ShowEditBlinkoModel('2xl', 'create');
            isProcessingSharedData = false;
          }
        } catch (e) {
          console.error('Failed to parse share data:', e);
          // Fallback: just open create modal
          RootStore.Get(ToastPlugin).error(e?.message)
          setTimeout(() => { isProcessingSharedData = false; }, 100);
        }
      }
    };

  // Start checking immediately
  checkAndroidData();

  // Register global interval (slower polling since Android injects with 1.5s delay)
  androidShortcutsIntervalId = setInterval(checkAndroidData, 800);
};

// Cleanup function
const cleanupAndroidShortcuts = () => {
  if (androidShortcutsIntervalId) {
    clearInterval(androidShortcutsIntervalId);
    androidShortcutsIntervalId = null;
  }
  isProcessingSharedData = false;
  isInitialized = false;
};

export const useAndroidShortcuts = () => {
  useEffect(() => {
    // Initialize only once globally
    initializeAndroidShortcuts();

    // Return cleanup function (cleanup when app unmounts)
    return () => {
      cleanupAndroidShortcuts();
    };
  }, []);
};



