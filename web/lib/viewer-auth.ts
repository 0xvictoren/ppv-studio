// Message the browser's session key signs to authenticate API calls without a wallet popup.
export function viewerAuthMessage(viewer: string, ts: number) {
  return `PayPerWatch viewer auth\n${viewer.toLowerCase()}\n${ts}`;
}
