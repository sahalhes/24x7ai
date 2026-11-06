import React from 'react';
import { Box, Text } from 'ink';
import { ProjectWithDaemon, AgentRunRecord } from '../../state/models.js';

interface DaemonDetailProps {
  project: ProjectWithDaemon;
  recentRuns: AgentRunRecord[];
  onBack: () => void;
}

export const DaemonDetail: React.FC<DaemonDetailProps> = ({ project, recentRuns }) => {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Daemon Details: {project.slug} (#{project.sl_no})
        </Text>
        <Text color="gray">[Esc / b] Back</Text>
      </Box>

      <Box flexDirection="column" marginY={1}>
        <Text><Text bold>Idea:</Text> {project.idea}</Text>
        <Text><Text bold>Status:</Text> {project.daemon_status} | <Text bold>MVP Complete:</Text> {project.mvp_complete ? 'Yes' : 'No'}</Text>
        <Text><Text bold>Schedule:</Text> {project.daemon_schedule} | <Text bold>Next Run:</Text> {project.next_run_at || 'Due'}</Text>
        <Text><Text bold>Consecutive Errors:</Text> {project.consecutive_errors || 0}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold color="yellow">Recent Runs ({recentRuns.length}):</Text>
        {recentRuns.length === 0 ? (
          <Text color="gray">No recorded runs yet.</Text>
        ) : (
          recentRuns.map((r) => (
            <Box key={r.id} marginY={0}>
              <Text>
                #{r.id} [{r.run_type.toUpperCase()}] {r.started_at.slice(0, 19)} | Exit: {r.exit_code ?? 'running'} | Commits: {r.commits_produced} | Files: {r.files_changed} | Duration: {Math.round((r.duration_ms || 0) / 1000)}s
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
