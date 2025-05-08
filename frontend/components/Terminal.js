// frontend/components/Terminal.js - Consolidated implementation

import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import 'xterm/css/xterm.css';

// Dynamically import xterm with no SSR
const TerminalComponent = dynamic(
    () => {
        // Import dependencies only on client side
        return Promise.all([
            import('xterm'),
            import('xterm-addon-fit'),
            import('xterm-addon-web-links'),
            import('xterm-addon-search')
        ]).then(([xtermModule, fitAddonModule, webLinksAddonModule, searchAddonModule]) => {
            const Terminal = xtermModule.Terminal;
            const FitAddon = fitAddonModule.FitAddon;
            const WebLinksAddon = webLinksAddonModule.WebLinksAddon;
            const SearchAddon = searchAddonModule.SearchAddon;

            // Return the actual component that uses these modules
            return ({ terminalId, onConnectionChange }) => {
                const terminalRef = useRef(null);
                const terminal = useRef(null);
                const fitAddon = useRef(null);
                const socket = useRef(null);
                const searchAddon = useRef(null);
                const reconnectTimeout = useRef(null);
                const reconnectAttempts = useRef(0);
                const [connected, setConnected] = useState(false);
                const [searchVisible, setSearchVisible] = useState(false);
                const [searchTerm, setSearchTerm] = useState('');

                // Initialize terminal
                useEffect(() => {
                    if (!terminalRef.current || !terminalId) return;

                    // Create terminal instance
                    terminal.current = new Terminal({
                        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                        fontSize: 14,
                        rows: 24,
                        cursorBlink: true,
                        theme: {
                            background: '#1e1e1e',
                            foreground: '#d4d4d4'
                        }
                    });

                    // Create addons
                    fitAddon.current = new FitAddon();
                    searchAddon.current = new SearchAddon();
                    const webLinksAddon = new WebLinksAddon();

                    // Load addons
                    terminal.current.loadAddon(fitAddon.current);
                    terminal.current.loadAddon(searchAddon.current);
                    terminal.current.loadAddon(webLinksAddon);

                    // Open terminal
                    terminal.current.open(terminalRef.current);

                    // Initial fit after terminal is open
                    setTimeout(() => {
                        if (fitAddon.current) {
                            try {
                                fitAddon.current.fit();
                                console.log('Terminal fitted successfully');
                            } catch (error) {
                                console.error('Terminal fit error:', error);
                            }
                        }
                        connectWebSocket();
                    }, 100);

                    // Cleanup
                    return () => {
                        disconnectWebSocket();
                        if (terminal.current) {
                            terminal.current.dispose();
                            terminal.current = null;
                        }
                        if (reconnectTimeout.current) {
                            clearTimeout(reconnectTimeout.current);
                        }
                    };
                }, [terminalId]);

                // Connect to WebSocket
                const connectWebSocket = useCallback(() => {
                    if (!terminalId || !terminal.current || socket.current?.readyState === WebSocket.CONNECTING) {
                        return;
                    }

                    // Close existing connection
                    disconnectWebSocket();

                    // Show connecting message
                    terminal.current.writeln('\r\nConnecting to terminal...');

                    try {
                        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                        const host = window.location.host;
                        const wsPath = `/api/v1/terminals/${terminalId}/attach`;
                        const wsUrl = `${protocol}//${host}${wsPath}`;

                        console.log(`Creating WebSocket connection to: ${wsUrl}`);
                        socket.current = new WebSocket(wsUrl);

                        // WebSocket event handlers
                        socket.current.onopen = () => {
                            console.log(`WebSocket connected for terminal ${terminalId}`);
                            setConnected(true);
                            reconnectAttempts.current = 0;
                            if (onConnectionChange) onConnectionChange(true);
                            terminal.current.writeln('\r\nConnection established!');

                            // Send initial terminal size
                            sendTerminalSize();
                        };

                        socket.current.onclose = (event) => {
                            console.log(`WebSocket closed for terminal ${terminalId}`, event);
                            setConnected(false);
                            if (onConnectionChange) onConnectionChange(false);
                            terminal.current.writeln('\r\nConnection closed. Attempting to reconnect...');

                            // Reconnect with exponential backoff
                            if (!reconnectTimeout.current) {
                                reconnectAttempts.current++;
                                const delay = calculateReconnectDelay();
                                reconnectTimeout.current = setTimeout(() => {
                                    reconnectTimeout.current = null;
                                    connectWebSocket();
                                }, delay);
                            }
                        };

                        socket.current.onerror = (error) => {
                            console.error(`WebSocket error for terminal ${terminalId}:`, error);
                            terminal.current.writeln('\r\nConnection error. Will attempt to reconnect...');
                        };

                        socket.current.onmessage = (event) => {
                            // Handle binary data
                            if (event.data instanceof Blob) {
                                const reader = new FileReader();
                                reader.onload = () => {
                                    terminal.current.write(new Uint8Array(reader.result));
                                };
                                reader.readAsArrayBuffer(event.data);
                            } else {
                                terminal.current.write(event.data);
                            }
                        };

                        // Set up terminal input
                        terminal.current.onData(data => {
                            if (socket.current && socket.current.readyState === WebSocket.OPEN) {
                                socket.current.send(data);
                            }
                        });
                    } catch (error) {
                        console.error('Error creating WebSocket connection:', error);
                        terminal.current.writeln(`\r\nFailed to connect: ${error.message}`);
                    }
                }, [terminalId, onConnectionChange]);

                // Disconnect WebSocket
                const disconnectWebSocket = useCallback(() => {
                    if (socket.current) {
                        socket.current.onclose = null; // Prevent auto-reconnect on intentional close
                        socket.current.close();
                        socket.current = null;
                    }
                }, []);

                // Calculate reconnect delay with exponential backoff
                const calculateReconnectDelay = useCallback(() => {
                    const baseDelay = 1000; // 1 second
                    const maxDelay = 30000; // 30 seconds
                    const delay = Math.min(baseDelay * Math.pow(1.5, reconnectAttempts.current), maxDelay);

                    // Add jitter to prevent thundering herd problem
                    return delay + (Math.random() * 1000);
                }, []);

                // Send terminal size to server
                const sendTerminalSize = useCallback(() => {
                    if (!fitAddon.current || !socket.current || socket.current.readyState !== WebSocket.OPEN) {
                        return;
                    }

                    try {
                        const dims = fitAddon.current.proposeDimensions();
                        if (!dims || !dims.cols || !dims.rows) {
                            return;
                        }

                        // Create binary message for resize
                        const sizeMessage = new Uint8Array(5);
                        sizeMessage[0] = 1; // Resize message type
                        sizeMessage[1] = dims.cols >> 8;
                        sizeMessage[2] = dims.cols & 0xff;
                        sizeMessage[3] = dims.rows >> 8;
                        sizeMessage[4] = dims.rows & 0xff;

                        socket.current.send(sizeMessage);
                        console.log(`Sent terminal resize: ${dims.cols}x${dims.rows}`);
                    } catch (error) {
                        console.error('Error sending terminal size:', error);
                    }
                }, []);

                // Handle resize
                useEffect(() => {
                    const handleResize = () => {
                        if (fitAddon.current && terminal.current) {
                            try {
                                fitAddon.current.fit();
                                sendTerminalSize();
                            } catch (error) {
                                console.error('Resize error:', error);
                            }
                        }
                    };

                    window.addEventListener('resize', handleResize);
                    return () => window.removeEventListener('resize', handleResize);
                }, [sendTerminalSize]);

                // Handle search in terminal
                const handleSearch = useCallback(() => {
                    if (!terminal.current || !searchAddon.current || !searchTerm) return;

                    try {
                        searchAddon.current.findNext(searchTerm);
                    } catch (error) {
                        console.error('Search error:', error);
                    }
                }, [searchTerm]);

                return (
                    <div className="h-full w-full flex flex-col">
                        {/* Connection indicator */}
                        <div className={`absolute top-2 right-2 z-10 flex items-center ${connected ? 'text-green-500' : 'text-red-500'} text-xs font-medium bg-gray-900 bg-opacity-75 px-2 py-1 rounded`}>
                            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            {connected ? 'Connected' : 'Disconnected'}
                        </div>

                        {/* Search bar */}
                        {searchVisible && (
                            <div className="bg-gray-800 p-2 flex items-center">
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search..."
                                    className="flex-1 px-3 py-1 text-sm text-white bg-gray-700 border border-gray-600 rounded-l"
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                />
                                <button
                                    onClick={handleSearch}
                                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-r hover:bg-blue-700"
                                >
                                    Find
                                </button>
                                <button
                                    onClick={() => setSearchVisible(false)}
                                    className="ml-2 px-2 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
                                >
                                    Close
                                </button>
                            </div>
                        )}

                        {/* Terminal container */}
                        <div className="flex-1 relative">
                            <div ref={terminalRef} className="absolute inset-0" />
                        </div>

                        {/* Terminal toolbar */}
                        <div className="bg-gray-800 p-2 flex justify-between items-center">
                            <div>
                                <button
                                    onClick={() => setSearchVisible(!searchVisible)}
                                    className="px-2 py-1 text-xs bg-gray-700 text-white rounded hover:bg-gray-600"
                                    title="Search"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => terminal.current && terminal.current.clear()}
                                    className="ml-2 px-2 py-1 text-xs bg-gray-700 text-white rounded hover:bg-gray-600"
                                    title="Clear"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                            <div>
                                <button
                                    onClick={connectWebSocket}
                                    disabled={connected}
                                    className={`px-2 py-1 text-xs ${connected ? 'bg-green-600' : 'bg-red-600 hover:bg-red-700'} text-white rounded ${connected ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title={connected ? 'Connected' : 'Reconnect'}
                                >
                                    {connected ? 'Connected' : 'Reconnect'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            };
        });
    },
    {
        ssr: false, // This prevents the component from being rendered on the server
        loading: () => (
            <div className="flex justify-center items-center h-full bg-gray-800 text-white">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white mb-2"></div>
                    <span>Loading terminal...</span>
                </div>
            </div>
        )
    }
);

/**
 * Terminal component that handles xterm.js integration and WebSocket connection
 * to Kubernetes pods for interactive shell access.
 * 
 * @param {Object} props
 * @param {string} props.terminalId - The ID of the terminal session
 * @param {Function} props.onConnectionChange - Callback for terminal connection status changes
 */
const Terminal = ({ terminalId, onConnectionChange }) => {
    const [isConnected, setIsConnected] = useState(false);

    // Handle connection status changes
    const handleConnectionChange = (connected) => {
        setIsConnected(connected);
        if (onConnectionChange) {
            onConnectionChange(connected);
        }
    };

    return (
        <div className="h-full w-full flex flex-col relative">
            <TerminalComponent
                terminalId={terminalId}
                onConnectionChange={handleConnectionChange}
            />
        </div>
    );
};

export default Terminal;