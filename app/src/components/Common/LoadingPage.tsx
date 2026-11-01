export const LoadingPage = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--secondbackground)]">
    <div className="rounded-3xl overflow-hidden">
      <img
        src="/loading.gif"
        className="w-[70px] h-[70px] md:w-[100px] md:h-[100px] object-contain"
        alt=""
      />
    </div>
  </div>
);
