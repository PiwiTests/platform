/**
 * Ask the desktop shell whether a local run could start at all in the folder
 * linked to a project: does the folder still exist, and does it (or a parent,
 * for hoisted monorepo installs) hold a Playwright installation? Surfaces the
 * "run your package manager's install first" case before anything spawns.
 */

interface DesktopLocalEnv {
  folder: string;
  exists: boolean;
  playwrightCli: string | null;
}

export function useDesktopEnvCheck(projectId: MaybeRefOrGetter<string | number | null | undefined>) {
  const env = ref<DesktopLocalEnv | null>(null);

  const playwrightMissing = computed(() => !!env.value?.exists && env.value.playwrightCli == null);

  async function checkEnv() {
    const core = tauriCore();
    const id = toValue(projectId);
    env.value = null;
    if (!core || id == null) return;
    try {
      env.value = await core.invoke<DesktopLocalEnv>('desktop_check_local_env', { projectId: String(id) });
    } catch {
      // No folder linked, or an older shell without the command — the run
      // itself still reports either way.
    }
  }

  return { env, playwrightMissing, checkEnv };
}
