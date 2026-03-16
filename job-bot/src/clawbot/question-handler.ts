/**
 * question-handler.ts
 * Resolves each form question to an answer using three-tier priority:
 *   1. Profile memory (instant, no DB)
 *   2. Answer store (SQLite keyword match)
 *   3. Human interrupt via Telegram
 */
import { profile, ProfileMemory } from '../application/profile-memory';
import { findAnswer } from '../memory/answer-store';

export type QuestionResolution =
  | { type: 'profile'; value: string }
  | { type: 'memory';  value: string; confidence: number }
  | { type: 'interrupt'; reason: string };

export async function resolveQuestion(
  questionText: string,
  fieldType: 'text' | 'select' | 'radio' | 'checkbox' | 'file',
  options?: string[]
): Promise<QuestionResolution> {
  // Tier 1: direct profile field match
  const profileValue = matchProfileField(questionText);
  if (profileValue !== null) {
    return { type: 'profile', value: String(profileValue) };
  }

  // Tier 2: answer store lookup
  const stored = findAnswer(questionText, options);
  if (stored && stored.confidence >= 0.75) {
    return {
      type:       'memory',
      value:      stored.approved_answer,
      confidence: stored.confidence,
    };
  }

  // Tier 3: escalate to human
  return {
    type:   'interrupt',
    reason: `No answer found for: "${questionText}"`,
  };
}

// ─── Profile field matching ───────────────────────────────────────────────────

function matchProfileField(question: string): string | boolean | number | null {
  const q = question.toLowerCase().trim();

  // Name
  if (q.includes('first name'))                          return profile.first_name;
  if (q.includes('last name') || q.includes('surname'))  return profile.last_name;
  if (q.includes('full name') || q === 'name')           return profile.full_name;

  // Contact
  if (q.includes('email'))                               return profile.email;
  if (q.includes('phone') || q.includes('mobile'))       return profile.phone;

  // Location
  if (q.includes('address line 2') || q.includes('address 2') ||
      q.includes('apt') || q.includes('suite') || q.includes('unit'))
                                                         return profile.address_line2;
  if (q.includes('address line 1') || q.includes('address 1') ||
      q.includes('street address') || q === 'address')   return profile.address_line1;
  if (q.includes('city'))                                return profile.city;
  if (q.includes('state') && !q.includes('status')) {
    // Some forms want full state name vs abbreviation
    if (q.includes('full') || q.includes('name'))        return profile.state_full;
    return profile.state;
  }
  if (q.includes('zip') || q.includes('postal'))         return profile.zip;
  if (q.includes('country'))                             return profile.country;

  // Social
  if (q.includes('linkedin'))                            return profile.linkedin_url;
  if (q.includes('github'))                              return profile.github_url;
  if (q.includes('portfolio') || q.includes('website'))  return profile.portfolio_url;

  // Work authorization
  if (q.includes('authorized to work') ||
      q.includes('legally authorized') ||
      q.includes('eligible to work'))                    return profile.authorized_to_work ? 'Yes' : 'No';

  if (q.includes('sponsorship') || q.includes('sponsor')) {
    return profile.requires_sponsorship ? 'Yes' : 'No';
  }

  if (q.includes('visa type') || q.includes('work visa') || q.includes('visa status'))
                                                         return profile.visa_type;

  // Security clearance
  if (q.includes('security clearance') || q.includes('clearance'))
    return profile.security_clearance ? 'Yes' : 'No';

  // Veteran / military status
  if (q.includes('veteran') || q.includes('military service') || q.includes('served in'))
    return profile.us_veteran ? 'Yes' : 'No, I am not a veteran';

  // EEO / demographic (OFCCP — decline to self-identify)
  if (q.includes('disability') || q.includes('disabled'))
    return profile.disability_status;
  if (q.includes('race') || q.includes('ethnicity') || q.includes('ethnic'))
    return profile.race_ethnicity;
  if (q === 'gender' || q.includes('gender identity') || q.includes('sex'))
    return profile.gender;

  // Preferences
  if (q.includes('relocat'))
    return profile.willing_to_relocate ? 'Yes' : 'Yes, open to relocation';

  if (q.includes('salary') || q.includes('compensation') || q.includes('expected pay')) {
    return profile.salary_string;
  }

  if (q.includes('start date') || q.includes('available to start') ||
      q.includes('when can you start') || q.includes('notice period')) {
    return profile.earliest_start_date;
  }

  if (q.includes('years of experience') || q.includes('how many years')) {
    return String(profile.years_experience);
  }

  return null;
}
