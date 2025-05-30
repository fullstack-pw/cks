// frontend/hooks/useTerminal.js
import { useState, useCallback, useRef, useEffect } from 'react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

export function useTerminal(sessionId) {
  // Terminal state management
  const [terminals, setTerminals] = useState({
    'control-plane': { id: null, status: 'disconnected', isLoading: false, error: null },
    'worker-node': { id: null, status: 'disconnected', isLoading: false, error: null }
  });
  const [activeTerminal, setActiveTerminal] = useState('control-plane');
  const [sessionStatus, setSessionStatus] = useState({
    isReady: false,
    isLoading: true,
    message: 'Checking session status...',
    error: null
  });

  const toast = useToast();
  const isMounted = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Check session status
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const checkSessionStatus = async () => {
      if (cancelled) return;

      try {
        const session = await api.sessions.get(sessionId);

        if (cancelled || !isMounted.current) return;

        if (session.status === 'running') {
          setSessionStatus({
            isReady: true,
            isLoading: false,
            message: 'Session is ready',
            error: null
          });
        } else if (session.status === 'failed') {
          setSessionStatus({
            isReady: false,
            isLoading: false,
            message: `Session failed: ${session.statusMessage || 'Unknown error'}`,
            error: session.statusMessage || 'Session failed'
          });
        } else {
          setSessionStatus({
            isReady: false,
            isLoading: true,
            message: `Session status: ${session.status}`,
            error: null
          });
        }
      } catch (error) {
        if (cancelled || !isMounted.current) return;

        setSessionStatus({
          isReady: false,
          isLoading: false,
          message: 'Unable to check session status',
          error: error.message || 'Unknown error'
        });
      }
    };

    checkSessionStatus();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Create terminal session
  const createTerminal = useCallback(async (target) => {
    console.log(`createTerminal called for ${target}`, {
      sessionReady: sessionStatus.isReady,
      currentTerminalState: terminals[target]
    });
    if (!sessionStatus.isReady) {
      toast.error('Session not ready for terminal creation');
      return null;
    }

    if (terminals[target].isLoading) {
      return null;
    }

    try {
      setTerminals(prev => ({
        ...prev,
        [target]: { ...prev[target], isLoading: true, error: null }
      }));

      console.log(`Creating terminal for ${target}...`);
      const result = await api.terminals.create(sessionId, target);

      if (isMounted.current) {
        setTerminals(prev => ({
          ...prev,
          [target]: {
            id: result.terminalId,
            status: 'connected',
            isLoading: false,
            error: null
          }
        }));

        console.log(`Terminal created: ${result.terminalId}`);
        return result.terminalId;
      }
    } catch (error) {
      console.error(`Failed to create ${target} terminal:`, error);

      if (isMounted.current) {
        setTerminals(prev => ({
          ...prev,
          [target]: {
            ...prev[target],
            isLoading: false,
            error: error.message || `Failed to create terminal for ${target}`
          }
        }));
        toast.error(`Failed to create ${target} terminal`);
      }
      return null;
    }
  }, [sessionId, sessionStatus.isReady, terminals, toast]);

  // Handle terminal connection status change
  const handleConnectionChange = useCallback((target, isConnected) => {
    if (isMounted.current) {
      setTerminals(prev => ({
        ...prev,
        [target]: { ...prev[target], status: isConnected ? 'connected' : 'disconnected' }
      }));
    }
  }, []);

  // Switch active terminal tab
  const switchTerminal = useCallback((target) => {
    setActiveTerminal(target);

    // Create terminal if it doesn't exist and session is ready
    if (sessionStatus.isReady && !terminals[target].id && !terminals[target].isLoading) {
      createTerminal(target);
    }
  }, [sessionStatus.isReady, terminals, createTerminal]);

  return {
    terminals,
    activeTerminal,
    sessionStatus,
    createTerminal,
    switchTerminal,
    handleConnectionChange,
    isSessionReady: sessionStatus.isReady
  };
}

export default useTerminal;