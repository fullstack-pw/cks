// frontend/components/TerminalContainer.js - Fixed component

import React, { useState, useEffect } from 'react';
import Terminal from './Terminal';
import { useSession } from '../contexts/SessionContext';

const TerminalContainer = ({ sessionId }) => {
    const { session, createTerminal } = useSession(); // Move useSession to the component body
    const [activeTab, setActiveTab] = useState('control-plane');
    const [terminals, setTerminals] = useState({
        'control-plane': { connected: false, id: null },
        'worker-node': { connected: false, id: null }
    });
    const [terminalSize, setTerminalSize] = useState({ width: '100%', height: '100%' });

    // Create terminal sessions on initial load
    useEffect(() => {
        if (!session) return;

        const createTerminalSessions = async () => {
            // Only create terminals if they don't exist yet
            if (!terminals['control-plane'].id) {
                await createTerminalSession('control-plane');
            }
        };

        createTerminalSessions();
    }, [session, terminals, createTerminal]); // Add dependencies

    // Function to create a terminal session
    const createTerminalSession = async (target) => {
        try {
            // Use createTerminal from the useSession hook at component level
            const result = await createTerminal(sessionId, target);

            setTerminals(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    id: result.terminalId,
                    connected: true
                }
            }));

            return result.terminalId;
        } catch (error) {
            console.error('Failed to create terminal session:', error);
            setTerminals(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    connected: false,
                    error: error.message
                }
            }));
        }
    };

    // Rest of the component remains the same
    // ...
};

export default TerminalContainer;