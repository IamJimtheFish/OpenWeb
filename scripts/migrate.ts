import { getStore } from "@webx/store";

const store = getStore();
store.migrate();
console.log(`[migrate] schema version: ${store.getSchemaVersion()}`);
