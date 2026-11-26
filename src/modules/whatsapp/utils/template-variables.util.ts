import { AppError } from '@/lib/errors';

export interface TemplateVariableResolutionInput {
  templateText: string;
  variableMap: Record<string, string>;
}

export interface VariableResolutionResult {
  rendered: string;
  missingVariables: string[];
}

/**
 * Resolves placeholders like {{1}}, {{2}} in template components safely.
 * Disallows arbitrary evaluations or code execution.
 */
export function resolveTemplateVariables(
  input: TemplateVariableResolutionInput,
): VariableResolutionResult {
  const { templateText, variableMap } = input;
  const placeholderRegex = /\{\{(\d+|[a-zA-Z0-9_]+)\}\}/g;
  const missingVariables: string[] = [];

  const rendered = templateText.replace(placeholderRegex, (match, p1) => {
    const val = variableMap[p1];
    if (val === undefined || val === null || val === '') {
      missingVariables.push(p1);
      return match;
    }
    return String(val);
  });

  return {
    rendered,
    missingVariables,
  };
}

/**
 * Validates that all placeholders in a template component are provided in parameter list.
 */
export function validateTemplateParameters(
  templateBody: string,
  providedParameters: Array<{ type: string; text?: string }>,
): void {
  const matches = templateBody.match(/\{\{(\d+)\}\}/g) ?? [];
  const requiredCount = new Set(matches).size;

  if (providedParameters.length < requiredCount) {
    throw AppError.badRequest(
      `Template requires ${requiredCount} parameters, but only ${providedParameters.length} were supplied.`,
      { requiredCount, suppliedCount: providedParameters.length },
    );
  }
}
