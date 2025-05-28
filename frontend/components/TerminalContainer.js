// frontend/components/TerminalContainer.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Terminal from './Terminal';
import api from '../lib/api';
import { Button, LoadingState, ErrorState, StatusIndicator } from './common';

/**
 * Container component for terminals that manages tabs and terminal sessions
 * with persistence across validation operations.
 */
const TerminalContainer = ({ sessionId }) => {
    // Terminal tabs state
    const [activeTab, setActiveTab] = useState('control-plane');
    const [terminalSessions, setTerminalSessions] = useState({
        'control-plane': { id: null, isLoading: false, error: null, connected: false },
        'worker-node': { id: null, isLoading: false, error: null, connected: false }
    });

    // Session status
    const [sessionStatus, setSessionStatus] = useState({
        isReady: false,
        isLoading: true,
        message: 'Checking session status...',
        error: null
    });

    // Track component mount status
    const isMounted = useRef(true);
    const cleanupFunctions = useRef([]);
    const hasInitialized = useRef(false);

    // Create or get existing terminal session
    const createOrGetTerminalSession = useCallback(async (target) => {
        // Skip if already loading or if the terminal already exists and is connected
        if (terminalSessions[target].isLoading ||
            (terminalSessions[target].id && terminalSessions[target].connected)) {
            return;
        }

        try {
            // Update loading state
            setTerminalSessions(prev => ({
                ...prev,
                [target]: { ...prev[target], isLoading: true, error: null }
            }));

            console.log(`Creating/getting terminal for ${target}...`);
            const result = await api.terminals.create(sessionId, target);

            if (isMounted.current) {
                setTerminalSessions(prev => ({
                    ...prev,
                    [target]: {
                        id: result.terminalId,
                        isLoading: false,
                        error: null,
                        connected: false
                    }
                }));
            }
        } catch (error) {
            console.error(`Failed to create/get ${target} terminal:`, error);

            if (isMounted.current) {
                setTerminalSessions(prev => ({
                    ...prev,
                    [target]: {
                        ...prev[target],
                        isLoading: false,
                        error: error.message || `Failed to create terminal for ${target}`
                    }
                }));
            }
        }
    }, [sessionId, terminalSessions]);

    // Handle terminal connection status change
    const handleConnectionChange = useCallback((target, isConnected) => {
        if (isMounted.current) {
            setTerminalSessions(prev => ({
                ...prev,
                [target]: { ...prev[target], connected: isConnected }
            }));
        }
    }, []);

    // Handle tab change
    const handleTabChange = useCallback((target) => {
        setActiveTab(target);

        // Create terminal session if it doesn't exist and session is ready
        if (sessionStatus.isReady && !terminalSessions[target].id && !terminalSessions[target].isLoading) {
            createOrGetTerminalSession(target);
        }
    }, [sessionStatus.isReady, terminalSessions, createOrGetTerminalSession]);

    // Initialize terminals from session data
    const initializeExistingTerminals = useCallback(async (session) => {
        if (!session.activeTerminals || hasInitialized.current) return;

        console.log('Initializing existing terminals from session:', session.activeTerminals);

        const updates = {};
        for (const [terminalId, terminalInfo] of Object.entries(session.activeTerminals)) {
            if (terminalInfo.status === 'active') {
                updates[terminalInfo.target] = {
                    id: terminalId,
                    isLoading: false,
                    error: null,
                    connected: false // Will be updated when WebSocket connects
                };
            }
        }

        if (Object.keys(updates).length > 0) {
            setTerminalSessions(prev => ({
                ...prev,
                ...updates
            }));
            hasInitialized.current = true;
        }
    }, []);

    // Component mount/unmount
    useEffect(() => {
        isMounted.current = true;

        return () => {
            isMounted.current = false;
            // Execute all cleanup functions
            cleanupFunctions.current.forEach(cleanup => cleanup());
            cleanupFunctions.current = [];
        };
    }, []);

    // Update the session status polling effect
    useEffect(() => {
        if (!sessionId) return;

        const checkSessionStatus = async () => {
            if (!isMounted.current) return;

            try {
                const session = await api.sessions.get(sessionId);

                if (!isMounted.current) return;

                // Sessions from cluster pool are immediately running
                if (session.status === 'running') {
                    setSessionStatus({
                        isReady: true,
                        isLoading: false,
                        message: 'Session is ready',
                        error: null
                    });

                    // Initialize existing terminals from session
                    await initializeExistingTerminals(session);

                    // Create control plane terminal if no existing terminals
                    if (!hasInitialized.current &&
                        !terminalSessions['control-plane'].id &&
                        !terminalSessions['control-plane'].isLoading) {
                        createOrGetTerminalSession('control-plane');
                    }
                } else if (session.status === 'failed') {
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: `Session failed: ${session.statusMessage || 'Unknown error'}`,
                        error: session.statusMessage || 'Session failed'
                    });
                } else {
                    // Handle unexpected status - shouldn't happen with cluster pool
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: `Unexpected session status: ${session.status}`,
                        error: null
                    });
                }
            } catch (error) {
                if (isMounted.current) {
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: 'Unable to check session status',
                        error: error.message || 'Unknown error'
                    });
                }
            }
        };

        // Check immediately, no polling needed for cluster pool sessions
        checkSessionStatus();

        // Cleanup function
        const cleanup = () => {
            // No polling to cleanup
        };

        cleanupFunctions.current.push(cleanup);

        return cleanup;
    }, [sessionId, createOrGetTerminalSession, terminalSessions, initializeExistingTerminals]);

    return (
        <div className="h-full flex flex-col">
            {/* Terminal tabs */}
            <div className="bg-gray-800 px-4 py-2 text-white flex overflow-x-auto">
                <Button
                    variant={activeTab === 'control-plane' ? 'primary' : 'secondary'}
                    onClick={() => handleTabChange('control-plane')}
                    disabled={!sessionStatus.isReady}
                    className={`mr-2 flex items-center ${!sessionStatus.isReady ? 'opacity-50' : ''}`}
                >
                    Control Plane
                    {terminalSessions['control-plane'].connected && (
                        <StatusIndicator status="connected" size="sm" className="ml-2" />
                    )}
                </Button>

                <Button
                    variant={activeTab === 'worker-node' ? 'primary' : 'secondary'}
                    onClick={() => handleTabChange('worker-node')}
                    disabled={!sessionStatus.isReady}
                    className={`flex items-center ${!sessionStatus.isReady ? 'opacity-50' : ''}`}
                >
                    Worker Node
                    {terminalSessions['worker-node'].connected && (
                        <StatusIndicator status="connected" size="sm" className="ml-2" />
                    )}
                </Button>
            </div>

            {/* Terminal content area */}
            <div className="flex-1 overflow-hidden relative">
                {/* Session not ready state */}
                {!sessionStatus.isReady && (
                    <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                        {sessionStatus.isLoading ? (
                            <LoadingState message={sessionStatus.message} size="md" />
                        ) : (
                            <>
                                <p className="text-center mb-2">{sessionStatus.message}</p>

                                {sessionStatus.error ? (
                                    <ErrorState
                                        message="Failed to prepare environment"
                                        details={sessionStatus.error}
                                        onRetry={() => window.location.reload()}
                                    />
                                ) : (
                                    <p className="text-center text-sm mt-2 text-gray-400">
                                        VMs typically take about 5 minutes to initialize.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Terminal content */}
                {sessionStatus.isReady && (
                    <>
                        {/* Control plane terminal */}
                        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'control-plane' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                            {terminalSessions['control-plane'].id ? (
                                <Terminal
                                    terminalId={terminalSessions['control-plane'].id}
                                    onConnectionChange={(connected) => handleConnectionChange('control-plane', connected)}
                                />
                            ) : (
                                <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                                    {terminalSessions['control-plane'].isLoading ? (
                                        <LoadingState message="Creating terminal session..." size="md" />
                                    ) : terminalSessions['control-plane'].error ? (
                                        <ErrorState
                                            message="Failed to create terminal"
                                            details={terminalSessions['control-plane'].error}
                                            onRetry={() => createOrGetTerminalSession('control-plane')}
                                        />
                                    ) : (
                                        <Button
                                            variant="primary"
                                            onClick={() => createOrGetTerminalSession('control-plane')}
                                        >
                                            Connect to Control Plane
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Worker node terminal */}
                        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'worker-node' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                            {terminalSessions['worker-node'].id ? (
                                <Terminal
                                    terminalId={terminalSessions['worker-node'].id}
                                    onConnectionChange={(connected) => handleConnectionChange('worker-node', connected)}
                                />
                            ) : (
                                <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                                    {terminalSessions['worker-node'].isLoading ? (
                                        <LoadingState message="Creating terminal session..." size="md" />
                                    ) : terminalSessions['worker-node'].error ? (
                                        <ErrorState
                                            message="Failed to create terminal"
                                            details={terminalSessions['worker-node'].error}
                                            onRetry={() => createOrGetTerminalSession('worker-node')}
                                        />
                                    ) : (
                                        <Button
                                            variant="primary"
                                            onClick={() => createOrGetTerminalSession('worker-node')}
                                        >
                                            Connect to Worker Node
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default React.memo(TerminalContainer);