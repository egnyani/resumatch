/**
 * profile-memory.ts
 * Static answers to standard profile questions, loaded from config/settings.json.
 * These are known, safe to auto-fill — no LLM or Telegram needed.
 */
import rawSettings from '../../config/settings.json';

const p = rawSettings.profile as any;

export interface ProfileMemory {
  first_name:             string;
  last_name:              string;
  full_name:              string;
  email:                  string;
  phone:                  string;
  address_line1:          string;
  address_line2:          string;
  city:                   string;
  state:                  string;
  state_full:             string;
  zip:                    string;
  country:                string;
  linkedin_url:           string;
  github_url:             string;
  portfolio_url:          string;
  authorized_to_work:     boolean;
  requires_sponsorship:   boolean;
  visa_type:              string;
  visa_sponsorship_note:  string;
  willing_to_relocate:    boolean;
  preferred_work_type:    string;
  salary_expectation_min: number;
  salary_expectation_max: number;
  salary_string:          string;
  earliest_start_date:    string;
  years_experience:       number;
  security_clearance:     boolean;
  us_veteran:             boolean;
  disability_status:      string;
  race_ethnicity:         string;
  gender:                 string;
}

const nameParts = (p.name as string).split(' ');

export const profile: ProfileMemory = {
  first_name:             nameParts[0],
  last_name:              nameParts.slice(1).join(' '),
  full_name:              p.name,
  email:                  p.email,
  phone:                  p.phone,
  address_line1:          p.address_line1   ?? '',
  address_line2:          p.address_line2   ?? '',
  city:                   p.city,
  state:                  p.state,
  state_full:             p.state_full      ?? p.state,
  zip:                    p.zip,
  country:                p.country,
  linkedin_url:           p.linkedin,
  github_url:             p.github,
  portfolio_url:          p.portfolio,
  authorized_to_work:     p.authorized_to_work,
  requires_sponsorship:   p.requires_sponsorship,
  visa_type:              p.visa_type,
  visa_sponsorship_note:  p.visa_sponsorship_note ?? '',
  willing_to_relocate:    p.willing_to_relocate,
  preferred_work_type:    p.preferred_work_type,
  salary_expectation_min: p.salary_min,
  salary_expectation_max: p.salary_max,
  salary_string:          `$${p.salary_min.toLocaleString()} - $${p.salary_max.toLocaleString()}`,
  earliest_start_date:    p.earliest_start_date,
  years_experience:       p.years_experience,
  security_clearance:     p.security_clearance  ?? false,
  us_veteran:             p.us_veteran          ?? false,
  disability_status:      p.disability_status   ?? "I don't wish to answer",
  race_ethnicity:         p.race_ethnicity      ?? "I don't wish to answer",
  gender:                 p.gender              ?? "I don't wish to answer",
};
