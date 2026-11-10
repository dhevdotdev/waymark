// A dev server restarting or a page navigating can drop a request. One retry, and a dropped route must not crash the run.
export async function fetchRoute(route) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await route.fetch();
    } catch {
      if (attempt === 1) await route.abort().catch(() => {});
    }
  }
  return null;
}
