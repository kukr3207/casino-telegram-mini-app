import "react";

declare module "react" {
  interface CSSProperties {
    "--tg-viewport-height"?: string; // Add your custom CSS variable
  }
}
