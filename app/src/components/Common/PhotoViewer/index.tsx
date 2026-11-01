import type { ComponentProps } from 'react';
import {
  PhotoProvider as PhotoProviderBase,
  PhotoView as PhotoViewBase,
} from 'react-photo-view';

type PhotoProviderProps = ComponentProps<typeof PhotoProviderBase>;
type PhotoViewProps = ComponentProps<typeof PhotoViewBase>;
type OverlayRenderProps = Parameters<NonNullable<PhotoProviderProps['toolbarRender']>>[0];
import { Icon } from '@/components/Common/Iconify/icons';
import './index.css';

/**
 * Full-screen image viewer shared by every entry point (attachment grid, markdown
 * images, resource manager, ...).
 *
 * react-photo-view's default banner is a 44px strip pinned to the very top, which
 * lands under the status bar / camera cutout on an edge-to-edge Android window.
 * We hide it and render our own toolbar inside the safe area instead.
 */

const PhotoToolbar = ({ images, index, onClose, overlayVisible }: OverlayRenderProps) => {
  return (
    <div className={`blinko-photo__bar ${overlayVisible ? 'blinko-photo__bar--visible' : ''}`}>
      <button
        type="button"
        aria-label="close"
        className="blinko-photo__button"
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onClose(event);
        }}
      >
        <Icon icon="tabler:x" width={22} height={22} />
      </button>

      {images.length > 1 && (
        <div className="blinko-photo__counter">
          {index + 1} / {images.length}
        </div>
      )}

      <span aria-hidden className="blinko-photo__spacer" />
    </div>
  );
};

export const PhotoProvider = ({ children, ...props }: PhotoProviderProps) => (
  <PhotoProviderBase
    maskOpacity={1}
    photoClosable={false}
    // Snappier than the 400ms default; long zooms feel laggy on a phone.
    speed={() => 240}
    easing={() => 'cubic-bezier(0.22, 0.61, 0.36, 1)'}
    toolbarRender={PhotoToolbar}
    className="blinko-photo"
    maskClassName="blinko-photo__mask"
    {...props}
  >
    {children}
  </PhotoProviderBase>
);

/** Single tap opens the viewer; double tap is reserved for the gallery gestures. */
export const PhotoView = ({ triggers, ...props }: PhotoViewProps) => (
  <PhotoViewBase triggers={triggers ?? ['onClick']} {...props} />
);

export default PhotoProvider;
