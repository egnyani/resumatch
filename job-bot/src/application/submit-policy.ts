/**
 * submit-policy.ts
 * Controls whether Clawbot actually clicks the submit button.
 *
 * Modes (set in config/settings.json → submission_policy.mode):
 *   watch_only       — never submit, just watch Clawbot fill the form
 *   prefill_and_wait — fill everything but stop before submit (default for Phase 3)
 *   safe_auto_submit — auto-submit only for trusted ATS platforms
 */
import rawSettings from '../../config/settings.json';

const policy = rawSettings.submission_policy as {
  mode: 'watch_only' | 'prefill_and_wait' | 'safe_auto_submit';
  trusted_ats_platforms: string[];
};

export function shouldSubmit(atsPlatform: string | null): boolean {
  switch (policy.mode) {
    case 'watch_only':
      return false;

    case 'prefill_and_wait':
      return false;

    case 'safe_auto_submit':
      return policy.trusted_ats_platforms.includes(atsPlatform ?? '');

    default:
      return false;
  }
}

export function getMode(): string {
  return policy.mode;
}
