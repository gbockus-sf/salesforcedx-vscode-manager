import { execFile } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ProcessService {
  run(command: string, args: string[] = [], timeoutMs = 10_000): Promise<ExecResult> {
    return new Promise(resolve => {
      execFile(
        command,
        args,
        { timeout: timeoutMs, encoding: 'utf8' },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: error && typeof (error as NodeJS.ErrnoException).code === 'number'
              ? ((error as NodeJS.ErrnoException).code as unknown as number)
              : error
                ? 1
                : 0
          });
        }
      );
    });
  }
}
