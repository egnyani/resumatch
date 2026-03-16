/**
 * question-router.ts
 * Classifies a form question as low / medium / high risk
 * so the interrupt message can show the right warning.
 */

export type QuestionRisk = 'low' | 'medium' | 'high';

export interface RoutedQuestion {
  risk: QuestionRisk;
  category: string;
  suggested_answer?: string;
  warning?: string;
}

// High-risk: answers that affect your offer or could disqualify you
const HIGH_RISK: RegExp[] = [
  /salary/i,
  /compensation/i,
  /expected.*pay/i,
  /equity/i,
  /stock/i,
  /start date/i,
  /notice period/i,
  /when.*available/i,
  /why.*this company/i,
  /why.*us\b/i,
  /why.*role/i,
  /why.*position/i,
  /cover letter/i,
];

// Medium-risk: eligibility / logistics questions
const MEDIUM_RISK: RegExp[] = [
  /sponsor/i,
  /visa/i,
  /h-?1b/i,
  /work.*authoriz/i,
  /legally.*work/i,
  /authorized.*work/i,
  /relocat/i,
  /willing.*move/i,
  /travel/i,
  /background check/i,
  /drug test/i,
  /security clearance/i,
];

export function routeQuestion(question: string): RoutedQuestion {
  if (HIGH_RISK.some(p => p.test(question))) {
    return {
      risk:     'high',
      category: 'negotiation_or_fit',
      warning:  '⚠️ High-risk question — your answer may affect the offer. Review carefully.',
    };
  }

  if (MEDIUM_RISK.some(p => p.test(question))) {
    return {
      risk:     'medium',
      category: 'eligibility',
    };
  }

  return {
    risk:     'low',
    category: 'general',
  };
}
