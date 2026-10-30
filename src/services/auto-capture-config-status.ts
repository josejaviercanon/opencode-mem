import { CONFIG } from "../config.js";
import { log } from "./logger.js";

/** Toast/log copy when auto-capture is on but no provider is ready (#424). */
export function buildAutoCaptureConfigReminderMessage(issues: string[]): string {
  const issueText = issues.length > 0 ? ` Issues: ${issues.join("; ")}.` : "";
  return (
    "Auto-capture is enabled but no AI provider is configured. " +
    "Set opencodeProvider + opencodeModel (or memoryModel/memoryApiUrl/memoryApiKey), " +
    `or set autoCaptureEnabled: false.${issueText}`
  );
}

/** Minimal toast client shape; accepts OpenCode's OpencodeClient.tui. */
type AutoCaptureStatusToastClient = {
  tui?: {
    // OpenCode's SDK typing for showToast is version-dependent; keep loose.
    showToast?: (input: any) => Promise<unknown>;
  };
};

/**
 * Log (and optionally toast) when auto-capture cannot run due to missing
 * provider config. Toast is gated by showErrorToasts like other error notices.
 */
export function notifyAutoCaptureProviderStatus(client?: AutoCaptureStatusToastClient): void {
  if (!CONFIG.autoCaptureEnabled || CONFIG.autoCaptureProviderStatus.ready) return;

  const message = buildAutoCaptureConfigReminderMessage(CONFIG.autoCaptureProviderStatus.issues);
  log(`Auto-capture disabled by configuration. ${message}`);

  if (!CONFIG.showErrorToasts || !client?.tui?.showToast) return;

  client.tui
    .showToast({
      body: {
        title: "Auto-Capture",
        message,
        variant: "warning",
        duration: 8000,
      },
    })
    .catch(() => {});
}
