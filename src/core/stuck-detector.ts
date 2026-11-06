import { FleetStore } from '../state/queries.js';
import { ProjectRecord, DaemonStatus } from '../state/models.js';

export interface StuckCheckResult {
  isStuck: boolean;
  reason?: string;
}

export class StuckDetector {
  constructor(
    private store: FleetStore,
    private maxConsecutiveNoChanges = 3,
    private stuckTimeoutMs = 30 * 60 * 1000
  ) {}

  checkProject(projectId: number): StuckCheckResult {
    const daemonState = this.store.getDaemonState(projectId);
    if (!daemonState) return { isStuck: false };

    // 1. Check if consecutive no changes threshold reached
    if (daemonState.consecutive_no_changes >= this.maxConsecutiveNoChanges) {
      return {
        isStuck: true,
        reason: `Last ${daemonState.consecutive_no_changes} runs produced 0 commits and 0 file changes`,
      };
    }

    // 2. Check if consecutive errors threshold reached
    if (daemonState.consecutive_errors >= 3) {
      return {
        isStuck: true,
        reason: `Failed with consecutive errors (${daemonState.consecutive_errors} times)`,
      };
    }

    // 3. Check recent runs for repeated identical error
    const recentRuns = this.store.getRecentRuns(projectId, 3);
    if (recentRuns.length >= 3) {
      const allFailed = recentRuns.every((r) => (r.exit_code ?? 0) !== 0 && r.error);
      if (allFailed) {
        const firstError = recentRuns[0].error;
        const allSame = recentRuns.every((r) => r.error === firstError);
        if (allSame) {
          return {
            isStuck: true,
            reason: `Repeated error 3 times: ${firstError?.slice(0, 100)}`,
          };
        }
      }
    }

    return { isStuck: false };
  }

  evaluateAndApply(projectId: number): boolean {
    const check = this.checkProject(projectId);
    if (check.isStuck) {
      this.store.updateDaemonStatus(projectId, 'stuck');
      return true;
    }
    return false;
  }
}
