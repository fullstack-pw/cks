# docs/frontend-design.md - Technical design document for the frontend application

# KillerKoda-Local Frontend Application Design

## Overview

The KillerKoda-Local frontend application provides a web-based interface for users to interact with CKS practice environments. It offers scenario selection, terminal access, task tracking, and validation feedback.

## Technology Stack

- **Framework**: Next.js (React)
- **Styling**: TailwindCSS
- **State Management**: React Context API + SWR for data fetching
- **Terminal**: xterm.js with WebSocket integration
- **UI Components**: Custom components with Headless UI
- **Markdown Rendering**: react-markdown for task instructions
- **Icons**: Heroicons

## Architecture

The frontend follows a component-based architecture with clear separation of UI components, data fetching, and business logic:

```
┌───────────────────────────────────────────────────┐
│                    Pages                          │
├───────────────────────────────────────────────────┤
│ Home | Scenarios | Lab Environment | Settings     │
└───────────────────────────────────────────────────┘
                      │
┌───────────────────────────────────────────────────┐
│                   Components                      │
├───────────────────────────────────────────────────┤
│ Layout | Terminal | Scenario Card | Task List     │
└───────────────────────────────────────────────────┘
                      │
┌───────────────────────────────────────────────────┐
│                   Hooks & Context                 │
├───────────────────────────────────────────────────┤
│ useSession | useScenario | useTerminal | useTask  │
└───────────────────────────────────────────────────┘
                      │
┌───────────────────────────────────────────────────┐
│                   API Client                      │
├───────────────────────────────────────────────────┤
│ sessions | scenarios | terminals | tasks          │
└───────────────────────────────────────────────────┘
```

## Core Components

### 1. Layout Components

#### Main Layout
- Persistent navigation
- Breadcrumb navigation
- Status indicators (session time, completion status)
- Responsive design for desktop and tablet

#### Lab Layout
- Split view with resizable panels
- Terminal panel with tabs
- Task panel with collapsible sections
- Status bar with session information

### 2. Terminal Component

The Terminal component provides an interactive shell interface using xterm.js:

```jsx
// Terminal.jsx
import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { useTerminal } from '../hooks/useTerminal';

const TerminalComponent = ({ sessionId, target }) => {
  const terminalRef = useRef(null);
  const { 
    connect, 
    disconnect, 
    resize, 
    isConnected 
  } = useTerminal(sessionId, target);
  
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4'
      }
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    
    terminal.open(terminalRef.current);
    fitAddon.fit();
    
    connect(terminal);
    
    const handleResize = () => {
      fitAddon.fit();
      const dimensions = fitAddon.proposeDimensions();
      if (dimensions) {
        resize(dimensions.rows, dimensions.cols);
      }
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      disconnect();
      terminal.dispose();
      window.removeEventListener('resize', handleResize);
    };
  }, []);
  
  return (
    <div className="h-full w-full bg-gray-900 rounded-md overflow-hidden">
      <div className="flex items-center bg-gray-800 px-4 py-2">
        <div className={`w-3 h-3 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        <span className="text-gray-300 text-sm">{target}</span>
      </div>
      <div ref={terminalRef} className="h-full" />
    </div>
  );
};

export default TerminalComponent;
```

### 3. Scenario Selection Components

#### ScenarioList
- Filterable grid of scenario cards
- Category filters
- Difficulty filters
- Search functionality
- Pagination support

#### ScenarioCard
- Scenario title and description
- Difficulty indicator
- Estimated time
- Topics/tags
- Quick start button

```jsx
// ScenarioCard.jsx
const ScenarioCard = ({ scenario, onStart }) => {
  const { id, title, description, difficulty, timeEstimate, topics } = scenario;
  
  const difficultyColors = {
    beginner: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800'
  };
  
  return (
    <div className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white">
      <div className="px-6 py-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${difficultyColors[difficulty]}`}>
            {difficulty}
          </span>
        </div>
        <p className="text-gray-600 text-sm mb-4 line-clamp-2">{description}</p>
        <div className="flex items-center text-gray-500 text-xs mb-4">
          <ClockIcon className="w-4 h-4 mr-1" />
          <span>{timeEstimate}</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          {topics.map(topic => (
            <span key={topic} className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
              {topic}
            </span>
          ))}
        </div>
        <button
          onClick={() => onStart(id)}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
        >
          Start Lab
        </button>
      </div>
    </div>
  );
};
```

### 4. Task Components

#### TaskList
- List of tasks for the current scenario
- Task status indicators
- Collapsible task sections
- Progress tracking

#### TaskDetail
- Task description rendered from Markdown
- Step-by-step instructions
- Validation button
- Hints section (collapsible)
- Task completion status

```jsx
// TaskDetail.jsx
import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { useTask } from '../hooks/useTask';

const TaskDetail = ({ sessionId, task }) => {
  const { id, title, description, hints } = task;
  const [showHints, setShowHints] = useState(false);
  const { validateTask, isValidating, isComplete, validationMessage } = useTask(sessionId, id);
  
  return (
    <div className="border rounded-lg p-4 mb-4 bg-white">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        {isComplete && (
          <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            Completed
          </span>
        )}
      </div>
      
      <div className="prose prose-sm max-w-none mb-4">
        <ReactMarkdown>{description}</ReactMarkdown>
      </div>
      
      {hints.length > 0 && (
        <div className="mb-4">
          <button
            className="text-sm text-indigo-600 hover:text-indigo-800"
            onClick={() => setShowHints(!showHints)}
          >
            {showHints ? 'Hide Hints' : 'Show Hints'}
          </button>
          
          {showHints && (
            <div className="mt-2 bg-indigo-50 p-3 rounded-md">
              <ul className="list-disc pl-4">
                {hints.map((hint, index) => (
                  <li key={index} className="text-sm text-gray-700">{hint}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {validationMessage && (
        <div className={`p-3 rounded-md mb-4 ${
          isComplete ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {validationMessage}
        </div>
      )}
      
      <button
        onClick={validateTask}
        disabled={isValidating}
        className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-50"
      >
        {isValidating ? 'Validating...' : 'Validate Task'}
      </button>
    </div>
  );
};
```

### 5. Lab Environment Components

#### LabEnvironment
- Main container for the lab experience
- Split-pane layout with resize handles
- Terminal tabs management
- Task panel integration

```jsx
// LabEnvironment.jsx
import { useState } from 'react';
import { ResizablePanel, ResizablePanelGroup } from '../components/ResizablePanel';
import TerminalTabs from '../components/TerminalTabs';
import TaskPanel from '../components/TaskPanel';
import SessionInfo from '../components/SessionInfo';
import { useSession } from '../hooks/useSession';
import { useScenario } from '../hooks/useScenario';

const LabEnvironment = ({ sessionId }) => {
  const { session, isLoading: isLoadingSession } = useSession(sessionId);
  const { scenario, isLoading: isLoadingScenario } = useScenario(session?.scenarioId);
  const [activeTerminal, setActiveTerminal] = useState('control-plane');
  
  if (isLoadingSession || isLoadingScenario) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white border-b px-6 py-3">
        <SessionInfo session={session} scenario={scenario} />
      </header>
      
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={60} minSize={30}>
          <TerminalTabs
            sessionId={sessionId}
            targets={{
              'control-plane': session.controlPlaneVM,
              'worker-node': session.workerNodeVM
            }}
            activeTerminal={activeTerminal}
            onChangeTerminal={setActiveTerminal}
          />
        </ResizablePanel>
        
        <ResizablePanel defaultSize={40} minSize={20}>
          <TaskPanel
            sessionId={sessionId}
            tasks={scenario.tasks}
            taskStatus={session.tasks}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default LabEnvironment;
```

## Custom Hooks

The application uses custom hooks to manage state and data fetching:

### useSession Hook

```jsx
// useSession.js
import useSWR from 'swr';
import { api } from '../lib/api';

export function useSession(sessionId) {
  const { data, error, mutate } = useSWR(
    sessionId ? `/sessions/${sessionId}` : null,
    () => api.sessions.get(sessionId),
    {
      refreshInterval: 10000 // Refresh every 10 seconds
    }
  );
  
  return {
    session: data,
    isLoading: !error && !data,
    isError: error,
    refresh: mutate
  };
}
```

### useScenario Hook

```jsx
// useScenario.js
import useSWR from 'swr';
import { api } from '../lib/api';

export function useScenario(scenarioId) {
  const { data, error } = useSWR(
    scenarioId ? `/scenarios/${scenarioId}` : null,
    () => api.scenarios.get(scenarioId)
  );
  
  return {
    scenario: data,
    isLoading: !error && !data,
    isError: error
  };
}
```

### useTerminal Hook

```jsx
// useTerminal.js
import { useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';

export function useTerminal(sessionId, target) {
  const [terminalId, setTerminalId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  
  useEffect(() => {
    // Cleanup function
    return () => {
      if (terminalId) {
        api.terminals.close(terminalId).catch(console.error);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [terminalId, socket]);
  
  const connect = useCallback(async (terminal) => {
    try {
      // Create terminal session
      const { id } = await api.terminals.create(sessionId, target);
      setTerminalId(id);
      
      // Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/terminals/${id}/attach`);
      
      ws.onopen = () => {
        setIsConnected(true);
      };
      
      ws.onclose = () => {
        setIsConnected(false);
      };
      
      ws.onmessage = (event) => {
        terminal.write(event.data);
      };
      
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
      
      setSocket(ws);
    } catch (error) {
      console.error('Failed to connect terminal:', error);
    }
  }, [sessionId, target]);
  
  const disconnect = useCallback(() => {
    if (socket) {
      socket.close();
    }
    if (terminalId) {
      api.terminals.close(terminalId).catch(console.error);
    }
  }, [socket, terminalId]);
  
  const resize = useCallback((rows, cols) => {
    if (terminalId) {
      api.terminals.resize(terminalId, rows, cols).catch(console.error);
    }
  }, [terminalId]);
  
  return { connect, disconnect, resize, isConnected };
}
```

### useTask Hook

```jsx
// useTask.js
import { useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useSession } from './useSession';

export function useTask(sessionId, taskId) {
  const { session, refresh } = useSession(sessionId);
  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  
  const taskStatus = session?.tasks?.find(t => t.id === taskId);
  const isComplete = taskStatus?.status === 'completed';
  
  const validateTask = useCallback(async () => {
    try {
      setIsValidating(true);
      const result = await api.tasks.validate(sessionId, taskId);
      setValidationMessage(result.message);
      // Refresh session data to get updated task status
      refresh();
    } catch (error) {
      setValidationMessage(error.info?.message || 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [sessionId, taskId, refresh]);
  
  return {
    validateTask,
    isValidating,
    isComplete,
    validationMessage
  };
}
```

## Page Components

### Home Page

```jsx
// pages/index.js
import { useState } from 'react';
import useSWR from 'swr';
import { api } from '../lib/api';
import ScenarioList from '../components/ScenarioList';
import CategoryFilter from '../components/CategoryFilter';
import DifficultyFilter from '../components/DifficultyFilter';
import SearchBar from '../components/SearchBar';

export default function Home() {
  const { data: scenarios, error } = useSWR('/scenarios', api.scenarios.list);
  const { data: categories } = useSWR('/scenarios/categories', api.scenarios.categories);
  
  const [filters, setFilters] = useState({
    category: '',
    difficulty: '',
    search: ''
  });
  
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };
  
  const filteredScenarios = scenarios?.filter(scenario => {
    if (filters.category && !scenario.topics.includes(filters.category)) {
      return false;
    }
    if (filters.difficulty && scenario.difficulty !== filters.difficulty) {
      return false;
    }
    if (filters.search && !scenario.title.toLowerCase().includes(filters.search.toLowerCase()) && 
        !scenario.description.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    return true;
  });
  
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">CKS Practice Labs</h1>
      
      <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <SearchBar value={filters.search} onChange={(v) => handleFilterChange('search', v)} />
          <CategoryFilter 
            categories={categories || []} 
            value={filters.category} 
            onChange={(v) => handleFilterChange('category', v)} 
          />
          <DifficultyFilter 
            value={filters.difficulty} 
            onChange={(v) => handleFilterChange('difficulty', v)} 
          />
        </div>
      </div>
      
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-md mb-6">
          Failed to load scenarios. Please try again.
        </div>
      )}
      
      {!error && !scenarios ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : (
        <ScenarioList scenarios={filteredScenarios || []} />
      )}
    </div>
  );
}
```

### Lab Page

```jsx
// pages/lab/[id].js
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import LabEnvironment from '../../components/LabEnvironment';
import { useSession } from '../../hooks/useSession';

export default function LabPage() {
  const router = useRouter();
  const { id } = router.query;
  const { session, isLoading, isError } = useSession(id);
  
  useEffect(() => {
    if (isError) {
      router.push('/');
    }
  }, [isError, router]);
  
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
          <p className="text-gray-600">Loading your lab environment...</p>
        </div>
      </div>
    );
  }
  
  return <LabEnvironment sessionId={id} />;
}
```

## Responsive Design

The application is designed to be responsive with different layouts for various screen sizes:

- **Desktop**: Full split-pane layout with resizable panels
- **Tablet**: Stacked layout with tab navigation between terminal and tasks
- **Mobile**: Not optimized for mobile due to terminal requirements

Media queries and container queries are used to adapt the UI:

```css
/* Base styles - default styles for mobile */
.lab-container {
  flex-direction: column;
}

/* Tablet styles */
@media (min-width: 768px) {
  .lab-container {
    flex-direction: column;
  }
  
  .terminal-container {
    height: 60vh;
  }
  
  .task-container {
    height: 40vh;
  }
}

/* Desktop styles */
@media (min-width: 1024px) {
  .lab-container {
    flex-direction: row;
  }
  
  .terminal-container {
    width: 60%;
    height: 100%;
  }
  
  .task-container {
    width: 40%;
    height: 100%;
  }
}
```

## Accessibility Considerations

The application implements accessibility features:

- Semantic HTML elements
- ARIA attributes for interactive components
- Keyboard navigation support
- Focus management for terminal component
- Color contrast compliance
- Screen reader support

## Performance Optimization

- Code splitting with Next.js dynamic imports
- Static generation for scenario pages
- Optimized terminal rendering
- Memoization of expensive components
- Image optimization with Next.js Image component
- Debounced event handlers for terminal resizing
- Incremental Static Regeneration for scenario data

## Deployment Considerations

The frontend will be deployed as a containerized application with the following configuration:

```Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
```

The application will be served behind a reverse proxy with HTTPS termination and WebSocket support.

## Security Considerations

- CSRF protection
- Content Security Policy
- XSS prevention
- WebSocket connection validation
- Input sanitization
- Secure cookie usage
- Rate limiting
```

## Data Fetching Strategy

The application uses SWR for data fetching with a custom API client:

```jsx
// api.js
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

export const api = {
  async fetchJson(url, options = {}) {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      const error = new Error('API request failed');
      error.status = response.status;
      try {
        error.info = await response.json();
      } catch (e) {
        error.info = { message: response.statusText };
      }
      throw error;
    }
    
    return response.json();
  },
  
  // Session endpoints
  sessions: {
    create: (scenarioId) => api.fetchJson('/sessions', {
      method: 'POST',
      body: JSON.stringify({ scenarioId })
    }),
    get: (id) => api.fetchJson(`/sessions/${id}`),
    delete: (id) => api.fetchJson(`/sessions/${id}`, { method: 'DELETE' }),
    list: () => api.fetchJson('/sessions')
  },
  
  // Scenario endpoints
  scenarios: {
    get: (id) => api.fetchJson(`/scenarios/${id}`),
    list: () => api.fetchJson('/scenarios'),
    categories: () => api.fetchJson('/scenarios/categories')
  },
  
  // Task endpoints
  tasks: {
    validate: (sessionId, taskId) => api.fetchJson(`/sessions/${sessionId}/tasks/${taskId}/validate`, {
      method: 'POST'
    })
  },
  
  // Terminal endpoints
  terminals: {
    create: (sessionId, target) => api.fetchJson(`/sessions/${sessionId}/terminals`, {
      method: 'POST',
      body: JSON.stringify({ target })
    }),
    resize: (terminalId, rows, cols) => api.fetchJson(`/terminals/${terminalId}/resize`, {
      method: 'POST',
      body: JSON.stringify({ rows, cols })
    }),
    close: (terminalId) => api.fetchJson(`/terminals/${terminalId}`, {
      method: 'DELETE'
    })
  }
};