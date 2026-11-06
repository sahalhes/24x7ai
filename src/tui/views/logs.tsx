import React from 'react';
import { Box, Text } from 'ink';

interface LogsViewerProps {
  title: string;
  lines: string[];
  onBack: () => void;
}

export const LogsViewer: React.FC<LogsViewerProps> = ({ title, lines }) => {
  const visibleLines = lines.slice(-20);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="yellow">Log Stream: {title}</Text>
        <Text color="gray">[Esc / b] Back</Text>
      </Box>

      <Box flexDirection="column">
        {visibleLines.length === 0 ? (
          <Text color="gray">No log output yet.</Text>
        ) : (
          visibleLines.map((line, idx) => (
            <Text key={idx} color={line.includes('ERROR') ? 'red' : line.includes('WARN') ? 'yellow' : 'white'}>
              {line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
};
