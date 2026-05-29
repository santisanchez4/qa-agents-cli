import { ProjectScanResult } from './projectScanner';

export type ExecutionTarget = {
  script: string;
  requiredEnv?: string[];
};

export type ExecutionEnvironment = {
  requiredEnv: string[];
  notes: string;
};

export type ExecutionConfig = {
  environments: Record<string, ExecutionEnvironment>;
  targets: Record<string, ExecutionTarget>;
};

export function classifyTestScript(value: string): string | null {
  const v = value.toLowerCase();
  if (/lambdatest|lambda|lt:|cloud/.test(v)) return 'cloud';
  if (/debug/.test(v)) return 'debug';
  if (/report|allure|html-report/.test(v)) return 'report';
  if (/headed/.test(v)) return 'headed';
  if (/--ui|\bui\b/.test(v)) return 'ui';
  if (/playwright\s+test|cypress\s+run|npm\s+test|\btest\b/.test(v)) return 'local';
  return null;
}

export function buildExecutionConfig(profile: ProjectScanResult): ExecutionConfig {
  const scripts = profile.packageScripts ?? {};

  const environments: Record<string, ExecutionEnvironment> = {
    local: { requiredEnv: [], notes: 'Use this environment when running against local services.' },
    QA:    { requiredEnv: [], notes: 'Configure QA-specific variables here.' },
    UAT:   { requiredEnv: [], notes: 'Configure UAT-specific variables here.' },
  };

  const targets: Record<string, ExecutionTarget> = {};

  for (const [name, value] of Object.entries(scripts)) {
    const n = name.toLowerCase();
    const v = value.toLowerCase();

    if (/browserstack/.test(n) || /browserstack/.test(v)) {
      targets['browserstack'] ??= {
        script: name,
        requiredEnv: ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'],
      };
    } else if (/lambdatest|lambda|lt|cloud/.test(n) || /lambdatest|lambda|lt|cloud/.test(v)) {
      targets['lambdatest'] ??= {
        script: name,
        requiredEnv: ['LT_USERNAME', 'LT_ACCESS_KEY'],
      };
    } else if (/headed/.test(n) || /headed/.test(v)) {
      targets['headed'] ??= { script: name };
    } else if (/--ui|\bui\b/.test(n) || /--ui|\bui\b/.test(v)) {
      targets['ui'] ??= { script: name };
    } else if (/playwright\s+test|cypress\s+run|\btest\b/.test(v)) {
      targets['local'] ??= { script: name };
    }
  }

  // Fallback: derive local script name from testCommand if not found above
  if (!targets['local'] && profile.testCommand) {
    const match = profile.testCommand.match(/(?:npm|yarn|pnpm)\s+run\s+(\S+)/);
    if (match) {
      targets['local'] = { script: match[1] };
    } else {
      targets['local'] = { script: profile.testCommand };
    }
  }

  // Ensure local is always present
  targets['local'] ??= { script: '' };

  return { environments, targets };
}
