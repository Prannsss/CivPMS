import { z } from "zod";

/**
 * Zod 4 probes `new Function("")` on first parse to decide whether it may compile fast
 * object parsers. Under the CSP (no 'unsafe-eval', docs/DECISIONS.md D9a) that probe is blocked
 * and reported as a violation on every page. Turning the JIT off skips the probe; our forms are
 * small, so the speed difference is not measurable. Imported once by the client providers.
 */
z.config({ jitless: true });
