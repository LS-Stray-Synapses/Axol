import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when test globals are on; we keep them off.
afterEach(() => cleanup());

// Silence the expected console noise (validation warnings, React's report of
// errors our boundaries catch) so real failures stand out.
const quiet = () => {};
console.warn = quiet;
console.error = quiet;
