/**
 * settings.ts — typed loader for config/settings.json
 * Import this instead of importing the JSON directly when you need typed fields.
 */
import rawSettings from './settings.json';

export const settings = {
  openai_api_key:  (rawSettings.llm as any).api_key as string,
  llm_model:       (rawSettings.llm as any).model as string,
  apify_token:     (rawSettings.apify as any).api_token as string,
  job_preferences: rawSettings.job_preferences as any,
  profile:         (rawSettings as any).profile as any,
};
