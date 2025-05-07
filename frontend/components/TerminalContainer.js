import React, { useState, useEffect, useRef } from 'react';
import Terminal from './Terminal';
import api from '../lib/api';

const TerminalContainer = ({ sessionId }) => {
    const [activeTab, setActiveTab] = useState('control-plane');
    const [terminals, setTerminals] = useState({
        'control-plane': { connected: false, id: null, isCreating: false, error: null },
        'worker-node': { connected: false, id: null, isCreating: false, error: null }
    });
    const [ready, setReady] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [statusMessage, setStatusMessage] = useState('Checking session status...');

    // Check session status on initial load
    useEffect(() => {
        const checkSessionStatus = async () => {
            if (!sessionId) return;

            try {
                setInitializing(true);
                const session = await api.sessions.get(sessionId);

                // Check if session is running
                if (session.status === 'running') {
                    setReady(true);
                    setStatusMessage('Session is ready');
                    // Create control plane terminal automatically
                    createTerminalSession('control-plane');
                } else if (session.status === 'provisioning' || session.status === 'pending') {
                    setStatusMessage(`Environment is being prepared (${session.status}). This may take 5-10 minutes...`);
                    // Poll every 15 seconds
                    setTimeout(checkSessionStatus, 15000);
                } else {
                    setStatusMessage(`Session error: ${session.statusMessage || session.status}`);
                }
            } catch (error) {
                console.error('Failed to check session status:', error);
                setStatusMessage('Error checking session status. Please refresh the page.');
            } finally {
                setInitializing(false);
            }
        };

        checkSessionStatus();
    }, [sessionId]);

    // Create a terminal session for a specific target
    const createTerminalSession = async (target) => {
        if (terminals[target].id || terminals[target].isCreating) return;

        try {
            // Update state to show creation in progress
            setTerminals(prev => ({
                ...prev,
                [target]: { ...prev[target], isCreating: true, error: null }
            }));

            console.log(`Creating terminal for ${target}...`);
            const result = await api.terminals.create(sessionId, target);
            console.log(`Terminal created for ${target}:`, result);

            // Update state with new terminal ID
            setTerminals(prev => ({
                ...prev,
                [target]: {
                    id: result.terminalId,
                    connected: true,
                    isCreating: false,
                    error: null
                }
            }));
        } catch (error) {
            console.error(`Failed to create ${target} terminal:`, error);
            // Update state with error
            setTerminals(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    isCreating: false,
                    error: error.message || 'Failed to create terminal'
                }
            }));
        }
    };

    // Create terminal for second tab when clicked
    const handleTabChange = (target) => {
        setActiveTab(target);

        // Create terminal for this tab if it doesn't exist
        if (ready && !terminals[target].id && !terminals[target].isCreating) {
            createTerminalSession(target);
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="bg-gray-800 px-4 py-2 text-white flex">
                <button
                    onClick={() => handleTabChange('control-plane')}
                    disabled={!ready}
                    className={`px-3 py-1 rounded ${activeTab === 'control-plane' ? 'bg-gray-700' : 'hover:bg-gray-700'} ${!ready ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Control Plane
                </button>
                <button
                    onClick={() => handleTabChange('worker-node')}
                    disabled={!ready}
                    className={`px-3 py-1 rounded ml-2 ${activeTab === 'worker-node' ? 'bg-gray-700' : 'hover:bg-gray-700'} ${!ready ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    Worker Node
                </button>
            </div>

            <div className="flex-1 overflow-hidden">
                {!ready ? (
                    <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                        <div className="animate-pulse mb-4">
                            <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                        </div>
                        <p className="text-center">{statusMessage}</p>
                        <p className="text-center text-sm mt-2 text-gray-400">VMs typically take about 5 minutes to initialize.</p>
                    </div>
                ) : terminals[activeTab].id ? (
                    <Terminal
                        sessionId={sessionId}
                        terminalId={terminals[activeTab].id}
                        target={activeTab}
                    />
                ) : (
                    <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                        {terminals[activeTab].isCreating ? (
                            <div className="animate-pulse">
                                <span>Creating terminal...</span>
                            </div>
                        ) : terminals[activeTab].error ? (
                            <div className="text-red-400">
                                <p>Error: {terminals[activeTab].error}</p>
                                <button
                                    onClick={() => createTerminalSession(activeTab)}
                                    className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => createTerminalSession(activeTab)}
                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                            >
                                Connect to Terminal
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TerminalContainer;