/**
 * THALES OS — Canvas Environment & Deployment Mode Detection
 * 
 * Environment modes control Canvas API behavior:
 *  • dev: Local Canvas instance (testing)
 *  • staging: Staging Canvas (pre-production validation)
 *  • production: Live Canvas (real student data)
 * 
 * Deployment modes control data persistence:
 *  • dry-run: Test execution, no Canvas updates
 *  • live: Real Canvas updates (requires confirmation)
 */

export type CanvasMode = 'dev' | 'staging' | 'production';
export type DeployMode = 'dry-run' | 'live';

/**
 * Get the current Canvas environment mode from Vite config.
 * Defaults to 'dev' if not set.
 */
export function getCanvasMode(): CanvasMode {
  const mode = import.meta.env.VITE_CANVAS_MODE as string | undefined;
  if (mode === 'staging' || mode === 'production') return mode;
  return 'dev';
}

/**
 * Get the current deployment mode from Vite config.
 * Defaults to 'dry-run' if not set (safe default).
 */
export function getDeployMode(): DeployMode {
  const mode = import.meta.env.VITE_DEPLOY_MODE as string | undefined;
  return mode === 'live' ? 'live' : 'dry-run';
}

/**
 * Check if running in development Canvas environment.
 */
export function isDevMode(): boolean {
  return getCanvasMode() === 'dev';
}

/**
 * Check if running in staging Canvas environment.
 */
export function isStagingMode(): boolean {
  return getCanvasMode() === 'staging';
}

/**
 * Check if running in production Canvas environment.
 */
export function isProductionMode(): boolean {
  return getCanvasMode() === 'production';
}

/**
 * Check if running in dry-run deployment mode (no Canvas changes).
 */
export function isDryRunMode(): boolean {
  return getDeployMode() === 'dry-run';
}

/**
 * Check if running in live deployment mode (real Canvas changes).
 */
export function isLiveMode(): boolean {
  return getDeployMode() === 'live';
}

/**
 * Get a human-readable label for the current mode.
 */
export function getModeLabel(): string {
  const canvas = getCanvasMode();
  const deploy = getDeployMode();
  if (deploy === 'dry-run') return `${canvas} (dry-run)`;
  return `${canvas} (live)`;
}
