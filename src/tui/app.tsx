import React, { useState, useEffect } from 'react';
import { useInput, useApp, Box } from 'ink';
import { FleetStore } from '../state/queries.js';
import { AppConfig } from '../config/schema.js';
import { ProjectWithDaemon, AgentRunRecord } from '../state/models.js';
import { FleetOverview } from './views/fleet-overview.js';
import { DaemonDetail } from './views/daemon-detail.js';
import { LogsViewer } from './views/logs.js';
import { DaemonManager } from '../core/daemon-manager.js';
import fs from 'node:fs';
import path from 'node:path';

interface AppProps {
  store: FleetStore;
  config: AppConfig;
  daemonManager: DaemonManager;
}

type ViewMode = 'overview' | 'detail' | 'logs';

export const App: React.FC<AppProps> = ({ store, config, daemonManager }) => {
  const { exit } = useApp();
  const [projects, setProjects] = useState<ProjectWithDaemon[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [recentRuns, setRecentRuns] = useState<AgentRunRecord[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);

  const refresh = () => {
    const list = store.listProjects();
    setProjects(list);
    if (selectedIndex >= list.length && list.length > 0) {
      setSelectedIndex(list.length - 1);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  const selectedProject = projects[selectedIndex];

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    if (viewMode === 'detail' || viewMode === 'logs') {
      if (key.escape || input === 'b') {
        setViewMode('overview');
        return;
      }
    }

    if (viewMode === 'overview') {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => (prev < projects.length - 1 ? prev + 1 : prev));
      } else if (input === 's' && selectedProject) {
        daemonManager.start(selectedProject.id);
        refresh();
      } else if (input === 'p' && selectedProject) {
        daemonManager.pause(selectedProject.id);
        refresh();
      } else if (input === 'r' && selectedProject) {
        daemonManager.runSingleDaemon(selectedProject).then(refresh);
      } else if (key.return && selectedProject) {
        setRecentRuns(store.getRecentRuns(selectedProject.id, 5));
        setViewMode('detail');
      } else if (input === 'l') {
        const logPath = path.join(config.projectsRoot, '.24x7ai', 'logs', 'pipeline.log');
        if (fs.existsSync(logPath)) {
          const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
          setLogLines(lines);
        } else {
          setLogLines(['No log file found yet.']);
        }
        setViewMode('logs');
      }
    }
  });

  return (
    <Box flexDirection="column">
      {viewMode === 'overview' && (
        <FleetOverview
          projects={projects}
          selectedIndex={selectedIndex}
          maxParallel={config.maxParallel}
        />
      )}
      {viewMode === 'detail' && selectedProject && (
        <DaemonDetail
          project={selectedProject}
          recentRuns={recentRuns}
          onBack={() => setViewMode('overview')}
        />
      )}
      {viewMode === 'logs' && (
        <LogsViewer
          title={selectedProject ? selectedProject.slug : 'Fleet'}
          lines={logLines}
          onBack={() => setViewMode('overview')}
        />
      )}
    </Box>
  );
};
