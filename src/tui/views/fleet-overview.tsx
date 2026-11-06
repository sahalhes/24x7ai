import React from 'react';
import { Box, Text } from 'ink';
import { ProjectWithDaemon } from '../../state/models.js';

interface FleetOverviewProps {
  projects: ProjectWithDaemon[];
  selectedIndex: number;
  maxParallel: number;
  pipelineStatus?: {
    activeProject?: string;
    slNo?: number;
    total?: number;
    agent?: string;
    duration?: string;
  };
}

export const FleetOverview: React.FC<FleetOverviewProps> = ({
  projects,
  selectedIndex,
  maxParallel,
  pipelineStatus,
}) => {
  const activeCount = projects.filter((p) => p.daemon_active).length;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          24x7ai Fleet Controller
        </Text>
        <Text color="gray">
          max-parallel: {maxParallel} | daemons: {activeCount}/{projects.length}
        </Text>
      </Box>

      {/* Main Pipeline Banner */}
      <Box flexDirection="column" marginY={1} paddingX={1} borderStyle="single" borderColor="blue">
        {pipelineStatus?.activeProject ? (
          <>
            <Text>
              <Text bold color="yellow">Pipeline:</Text> Building #{pipelineStatus.slNo}/{pipelineStatus.total} — &ldquo;{pipelineStatus.activeProject}&rdquo;
            </Text>
            <Text color="gray">
              Agent: {pipelineStatus.agent || 'codex'} | {pipelineStatus.duration || 'Active'}
            </Text>
          </>
        ) : (
          <Text color="green">Pipeline: All scheduled MVPs complete or idle</Text>
        )}
      </Box>

      {/* Projects Table Header */}
      <Box flexDirection="column" marginY={1}>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Box width="6%"><Text bold>#</Text></Box>
          <Box width="30%"><Text bold>Project</Text></Box>
          <Box width="15%"><Text bold>Status</Text></Box>
          <Box width="15%"><Text bold>MVP</Text></Box>
          <Box width="18%"><Text bold>Last Run</Text></Box>
          <Box width="16%"><Text bold>Commits</Text></Box>
        </Box>

        {/* Rows */}
        {projects.length === 0 ? (
          <Box padding={1}><Text color="gray">No projects in fleet. Run `npx 24x7ai run` to ingest ideas.</Text></Box>
        ) : (
          projects.map((p, idx) => {
            const isSelected = idx === selectedIndex;
            let statusColor = 'green';
            let statusText: string = p.daemon_status || 'idle';

            if (statusText === 'running') {
              statusColor = 'yellow';
              statusText = '● running';
            } else if (statusText === 'stuck') {
              statusColor = 'red';
              statusText = '● stuck';
            } else if (statusText === 'paused') {
              statusColor = 'gray';
              statusText = '● paused';
            } else if (statusText === 'error') {
              statusColor = 'red';
              statusText = '● error';
            } else {
              statusColor = 'green';
              statusText = '● idle';
            }

            return (
              <Box
                key={p.id}
                paddingX={1}
                backgroundColor={isSelected ? 'gray' : undefined}
              >
                <Box width="6%"><Text color={isSelected ? 'black' : 'white'}>{p.sl_no}</Text></Box>
                <Box width="30%"><Text bold color={isSelected ? 'black' : 'white'}>{p.slug.slice(0, 24)}</Text></Box>
                <Box width="15%"><Text color={statusColor as any}>{statusText}</Text></Box>
                <Box width="15%"><Text color={p.mvp_complete ? 'green' : 'yellow'}>{p.mvp_complete ? 'Done' : 'Pending'}</Text></Box>
                <Box width="18%"><Text color={isSelected ? 'black' : 'gray'}>{p.last_run_started_at ? p.last_run_started_at.slice(11, 16) : '—'}</Text></Box>
                <Box width="16%"><Text color={isSelected ? 'black' : 'white'}>{p.last_run_commits || 0}</Text></Box>
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer Controls */}
      <Box marginTop={1} justifyContent="space-between">
        <Text color="gray">
          [↑/↓] Select  [s]tart  [p]ause  [r]un now  [l]ogs  [q]uit
        </Text>
      </Box>
    </Box>
  );
};
