export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: any;
        colorScheme: "light" | "dark";
        isExpanded: boolean;
        viewportHeight: number;
        headerColor: string;
        backgroundColor: string;
        themeParams: {
          bg_color: string;
          text_color: string;
          hint_color: string;
          link_color: string;
          button_color: string;
          button_text_color: string;
        };
        MainButton: {
          isVisible: boolean;
          isActive: boolean;
          isProgressVisible: boolean;
          text: string;
          color: string;
          textColor: string;
          setText: (text: string) => void;
          show: () => void;
          hide: () => void;
          enable: () => void;
          disable: () => void;
          setParams: (params: { color?: string; text_color?: string }) => void;
          onClick: (callback: () => void) => void;
        };
        ready: () => void;
        close: () => void;
      };
    };
  }
}
