declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    AUTH_BOOTSTRAP_USERNAME?: string;
    AUTH_BOOTSTRAP_DISPLAY_NAME?: string;
    AUTH_BOOTSTRAP_PASSWORD?: string;
    AUTH_PASSWORD_PEPPER?: string;
    APP_ORIGIN?: string;
  }
}
