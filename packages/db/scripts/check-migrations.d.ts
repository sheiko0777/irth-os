export interface PlanResult {
  ok: boolean;
  errors: string[];
  maxMain: number;
}

export function plan(
  mainFiles: string[],
  prFilesWithStatus: Array<{ status: string; file: string } | string>,
): PlanResult;

export function runCli(): void;
