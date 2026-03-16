export type ATSPlatform =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'taleo'
  | 'icims'
  | 'smartrecruiters'
  | 'direct'
  | 'unknown';

const ATS_PATTERNS: Record<ATSPlatform, RegExp[]> = {
  greenhouse:      [/greenhouse\.io/, /boards\.greenhouse/],
  lever:           [/jobs\.lever\.co/],
  ashby:           [/jobs\.ashbyhq\.com/],
  workday:         [/myworkdayjobs\.com/, /workday\.com/],
  taleo:           [/taleo\.net/],
  icims:           [/icims\.com/],
  smartrecruiters: [/smartrecruiters\.com/],
  direct:          [],
  unknown:         [],
};

export function classifyATS(applyUrl: string): ATSPlatform {
  if (!applyUrl) return 'unknown';
  for (const [platform, patterns] of Object.entries(ATS_PATTERNS) as [ATSPlatform, RegExp[]][]) {
    if (patterns.length > 0 && patterns.some(pattern => pattern.test(applyUrl))) {
      return platform;
    }
  }
  return 'unknown';
}
