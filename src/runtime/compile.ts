import * as esbuild from 'esbuild-wasm/esm/browser.js';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import { compileChallenge, type CompileMode, type CompiledChallenge } from '../../shared/compiler';

let ready: Promise<void> | null = null;

/** esbuild-wasm can only be initialized once per page; later calls reuse the same instance. */
function initialize(): Promise<void> {
  ready ??= esbuild.initialize({ wasmURL, worker: true }).catch((error) => { ready = null; throw error; });
  return ready;
}

export async function compileInBrowser(files: Record<string, string>, mode: CompileMode = 'preview'): Promise<CompiledChallenge> {
  await initialize();
  return compileChallenge(files, esbuild.build as Parameters<typeof compileChallenge>[1], mode);
}
