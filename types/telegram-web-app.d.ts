export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          query_id?: string;
          user?: {
            id: number;
            is_bot?: boolean;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          auth_date: number;
          hash: string;
        };
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
        openLink: (url: string) => void; // Added openLink method
        expand: () => void; // Optionally expand the WebApp
        HapticFeedback: {
          impactOccurred: (style?: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
        sendData: (data: string) => void; // Sends data to the bot
        setHeaderColor: (color: string) => void; // Sets the header color
        setBackgroundColor: (color: string) => void; // Sets the background color
        enableClosingConfirmation: () => void; // Enable confirmation before closing
        disableClosingConfirmation: () => void; // Disable confirmation before closing
      };
    };
  }
}
