/** Minimal typings for Telegram Mini App (official script sets window.Telegram) */
export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        /** ios | android | macos | tdesktop | web | weba | … */
        platform?: string;
        initDataUnsafe?: {
          user?: {
            id?: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
        close?: () => void;
        downloadFile?: (
          params: { url: string; file_name: string },
          callback?: (accepted: boolean) => void,
        ) => void;
        /** เปิดลิงก์ HTTPS ในเบราว์เซอร์ภายนอก — fallback เมื่อ downloadFile ไม่ทำงาน */
        openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
      };
    };
  }
}
