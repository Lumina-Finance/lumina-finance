interface ErrorReportDetails {
  componentStack: string | null;
  error: unknown;
  occurredAt: Date;
  path: string;
  userAgent: string;
}

/**
 * Assembles the plain-text report a user copies off an error screen and pastes into a bug report
 *
 * The stacks go last and the short fields first, so the useful part survives a reader who stops
 * reading partway. Everything is passed in rather than read from the page, so the caller decides
 * what a report may contain
 *
 * @param details - The caught error, where and when it happened, and the browser it happened in
 * @returns The report as newline-separated text
 */
export function buildErrorReport({ componentStack, error, occurredAt, path, userAgent }: ErrorReportDetails): string {
  // A thrown value is not necessarily an Error, and String() is the only description a bare
  // throw can offer
  const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  const lines = [
    `Time: ${occurredAt.toISOString()}`,
    `Page: ${path}`,
    `Error: ${description}`,
    `Browser: ${userAgent}`,
  ];

  if (error instanceof Error && error.stack) {
    lines.push('', 'Stack:', error.stack.trim());
  }

  if (componentStack) {
    lines.push('', 'Components:', componentStack.trim());
  }

  return lines.join('\n');
}
