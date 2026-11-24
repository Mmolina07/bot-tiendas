declare namespace Cloudflare {
  interface Env {
    ENTORNO?: string;
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
