// frontend/components/TerminalContainer.js - Updated implementation

import React, { useState, useEffect, useCallback } from 'react';
import Terminal from './Terminal';
import api from '../lib/api';

/**
 * Container component for terminals that manages tabs and terminal sessions
 * for control plane and worker nodes.
 * 
 * @param {Object} props
 * @param {string} props.sessionId - The ID of the user session
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

    // Poll for session status changes
    useEffect(() => {
        if (!sessionId) return;

        const checkSessionStatus = async () => {
            try {
                setSessionStatus(prev => ({ ...prev, isLoading: true, error: null }));

                const session = await api.sessions.get(sessionId);

                if (session.status === 'running') {
                    setSessionStatus({
                        isReady: true,
                        isLoading: false,
                        message: 'Session is ready',
                        error: null
                    });

                    // Create control plane terminal automatically
                    createTerminalSession('control-plane');
                } else if (session.status === 'provisioning' || session.status === 'pending') {
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: `Environment is being prepared (${session.status}). This may take 5-10 minutes...`,
                        error: null
                    });

                    // Poll every 15 seconds
                    const timeoutId = setTimeout(checkSessionStatus, 15000);
                    return () => clearTimeout(timeoutId);
                } else if (session.status === 'failed') {
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: 'Failed to prepare environment',
                        error: session.statusMessage || 'Unknown error'
                    });
                } else {
                    setSessionStatus({
                        isReady: false,
                        isLoading: false,
                        message: `Session status: ${session.status}`,
                        error: null
                    });
                }
            } catch (error) {
                console.error('Failed to check session status:', error);
                setSessionStatus({
                    isReady: false,
                    isLoading: false,
                    message: 'Unable to check session status',
                    error: error.message || 'Unknown error'
                });
            }
        };

        checkSessionStatus();
    }, [sessionId]);

    // Create a terminal session
    const createTerminalSession = useCallback(async (target) => {
        // Skip if already loading or if the terminal already exists
        if (terminalSessions[target].isLoading || terminalSessions[target].id) return;

        try {
            // Update loading state
            setTerminalSessions(prev => ({
                ...prev,
                [target]: { ...prev[target], isLoading: true, error: null }
            }));

            console.log(`Creating terminal for ${target}...`);
            const result = await api.terminals.create(sessionId, target);

            setTerminalSessions(prev => ({
                ...prev,
                [target]: {
                    id: result.terminalId,
                    isLoading: false,
                    error: null,
                    connected: false
                }
            }));
        } catch (error) {
            console.error(`Failed to create ${target} terminal:`, error);

            setTerminalSessions(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    isLoading: false,
                    error: error.message || `Failed to create terminal for ${target}`
                }
            }));
        }
    }, [sessionId, terminalSessions]);

    // Handle terminal connection status change
    const handleConnectionChange = useCallback((target, isConnected) => {
        setTerminalSessions(prev => ({
            ...prev,
            [target]: { ...prev[target], connected: isConnected }
        }));
    }, []);

    // Handle tab change
    const handleTabChange = useCallback((target) => {
        setActiveTab(target);

        // Create terminal session if it doesn't exist
        if (sessionStatus.isReady && !terminalSessions[target].id && !terminalSessions[target].isLoading) {
            createTerminalSession(target);
        }
    }, [sessionStatus.isReady, terminalSessions, createTerminalSession]);

    return (
        <div className="h-full flex flex-col">
            {/* Terminal tabs */}
            <div className="bg-gray-800 px-4 py-2 text-white flex">
                <button
                    onClick={() => handleTabChange('control-plane')}
                    disabled={!sessionStatus.isReady}
                    className={`px-3 py-1 rounded flex items-center ${activeTab === 'control-plane' ? 'bg-gray-700' : 'hover:bg-gray-700'
                        } ${!sessionStatus.isReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Control Plane
                    {terminalSessions['control-plane'].connected && (
                        <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full"></span>
                    )}
                </button>

                <button
                    onClick={() => handleTabChange('worker-node')}
                    disabled={!sessionStatus.isReady}
                    className={`px-3 py-1 rounded ml-2 flex items-center ${activeTab === 'worker-node' ? 'bg-gray-700' : 'hover:bg-gray-700'
                        } ${!sessionStatus.isReady ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Worker Node
                    {terminalSessions['worker-node'].connected && (
                        <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full"></span>
                    )}
                </button>
            </div>

            {/* Terminal content area */}
            <div className="flex-1 overflow-hidden relative">
                {/* Session not ready state */}
                {!sessionStatus.isReady && (
                    <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                        {sessionStatus.isLoading && (
                            <div className="animate-pulse mb-4">
                                <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            </div>
                        )}

                        <p className="text-center mb-2">{sessionStatus.message}</p>

                        {sessionStatus.error && (
                            <div className="mt-4 bg-red-800 bg-opacity-50 p-3 rounded text-white max-w-md text-center">
                                <p className="font-medium">Error</p>
                                <p className="text-sm">{sessionStatus.error}</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-3 bg-red-700 hover:bg-red-600 text-white px-4 py-1 rounded text-sm"
                                >
                                    Reload
                                </button>
                            </div>
                        )}

                        {!sessionStatus.error && (
                            <p className="text-center text-sm mt-2 text-gray-400">
                                VMs typically take about 5 minutes to initialize.
                            </p>
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
                                        <div className="flex flex-col items-center">
                                            <div className="animate-spin h-8 w-8 border-2 border-white rounded-full border-t-transparent mb-3"></div>
                                            <span>Creating terminal session...</span>
                                        </div>
                                    ) : terminalSessions['control-plane'].error ? (
                                        <div className="text-center">
                                            <p className="text-red-400 mb-3">Error: {terminalSessions['control-plane'].error}</p>
                                            <button
                                                onClick={() => createTerminalSession('control-plane')}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => createTerminalSession('control-plane')}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                        >
                                            Connect to Control Plane
                                        </button>
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
                                        <div className="flex flex-col items-center">
                                            <div className="animate-spin h-8 w-8 border-2 border-white rounded-full border-t-transparent mb-3"></div>
                                            <span>Creating terminal session...</span>
                                        </div>
                                    ) : terminalSessions['worker-node'].error ? (
                                        <div className="text-center">
                                            <p className="text-red-400 mb-3">Error: {terminalSessions['worker-node'].error}</p>
                                            <button
                                                onClick={() => createTerminalSession('worker-node')}
                                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => createTerminalSession('worker-node')}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                        >
                                            Connect to Worker Node
                                        </button>
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

export default TerminalContainer;