import { Icon } from '@/components/Common/Iconify/icons';
import { observer } from "mobx-react-lite";
import { RootStore } from "@/store";
import { BaseStore } from "@/store/baseStore";
import { BlinkoStore } from "@/store/blinkoStore";
import { getFixedHeaderBackground, SideBarItem } from "./index";
import { useTranslation } from "react-i18next";
import { useSwiper } from "@/lib/hooks";
import { motion } from "framer-motion";
import { Link, useLocation, useSearchParams } from 'react-router-dom';

interface MobileNavBarProps {
  onItemClick?: () => void;
}

export const MobileNavBar = observer(({ onItemClick }: MobileNavBarProps) => {
  const base = RootStore.Get(BaseStore);
  const { t } = useTranslation();
  const blinkoStore = RootStore.Get(BlinkoStore);
  const isVisible = useSwiper();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  if (blinkoStore.config.value?.isHiddenMobileBar) {
    return null;
  }

  const routerInfo = {
    pathname: location.pathname,
    searchParams
  };

  // Get all visible items for mobile, including those that might be hidden in sidebar
  // Make sure to include items even if they have hiddenSidebar=true but hiddenMobile=false
  const mobileItems = base.routerList.filter(i => !i.hiddenMobile);

  return (
    <motion.div
      className="blinko-bottom-bar h-[60px] flex w-full px-3 py-2 gap-1 bg-background block md:hidden overflow-hidden fixed bottom-0 z-40"
      initial={false}
      animate={{ y: isVisible ? 0 : '100%' }}
      transition={{ type: 'tween', duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      style={{
        willChange: 'transform',
        // Grow into the navigation bar / gesture area instead of sitting under it.
        height: 'calc(60px + var(--safe-area-inset-bottom, 0px))',
        paddingBottom: 'calc(var(--safe-area-inset-bottom, 0px) + 0.5rem)',
        background: getFixedHeaderBackground(),
        boxShadow: '0 -1px 0 color-mix(in srgb, var(--foreground) 10%, transparent)'
      }}
    >
      {mobileItems.map(i => (
        <div key={i.title} className="flex-1">
          <Link
            className={`w-full h-full items-center justify-center flex !flex-col group ${SideBarItem} ${base.isSideBarActive(routerInfo, i) ? '!text-foreground' : '!text-desc'
              }`}
            to={i.href}
            onClick={() => {
              base.currentRouter = i;
              onItemClick?.();
            }}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <motion.div whileTap={{ scale: 0.9 }} transition={{ type: 'tween', duration: 0.12 }}>
              <Icon className={`text-center`} icon={i.icon} width="24" height="24" />
            </motion.div>
          </Link>
        </div>
      ))}
    </motion.div>
  );
});