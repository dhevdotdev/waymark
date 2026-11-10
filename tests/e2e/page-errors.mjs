/** Collects errors thrown by the app. Playwright's click helper runs inside the page and can throw there on its own account. */
export function watchPageErrors(page, errors) {
  page.on("pageerror", (e) => {
    if (!e.stack?.includes("expectHitTarget")) errors.push(String(e));
  });
}
