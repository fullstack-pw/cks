// frontend/components/Terminal.js - Enhanced version
import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import '@xterm/xterm/css/xterm.css';
import { Button, StatusIndicator } from './common';

// Dynamically import xterm with no SSR
const TerminalComponent = dynamic(
    () => {
        return Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
            import('@xterm/addon-web-links'),
            import('@xterm/addon-search')
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
                const eventListeners = useRef([]); // Track all event listeners
                const isComponentMounted = useRef(true); // Track component mount state


                const [connected, setConnected] = useState(false);
                const [searchVisible, setSearchVisible] = useState(false);
                const [searchTerm, setSearchTerm] = useState('');
                const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
                const [totalSearchResults, setTotalSearchResults] = useState(0);

                // Update the connectWebSocket function (around line 50)
                const connectWebSocket = useCallback(() => {
                    if (!isComponentMounted.current) return;
                    if (!terminalId || !terminal.current) return;
                    if (socket.current?.readyState === WebSocket.CONNECTING) return;

                    // Disconnect existing connection first
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
                            terminal.current.clear();
                            terminal.current.writeln('Connected to terminal!');
                            terminal.current.writeln('');

                            // Send initial terminal size
                            sendTerminalSize();
                        };

                        socket.current.onclose = (event) => {
                            if (!isComponentMounted.current) return;

                            console.log(`WebSocket closed for terminal ${terminalId}`, event);
                            setConnected(false);
                            if (onConnectionChange) onConnectionChange(false);

                            // Retry connection if not intentionally closed
                            if (isComponentMounted.current && event.code !== 1000) {
                                terminal.current.writeln('\r\nConnection closed. Attempting to reconnect...');
                                scheduleReconnect();
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
                        scheduleReconnect();
                    }
                }, [terminalId, onConnectionChange]);

                // Schedule reconnection with proper cleanup
                const scheduleReconnect = useCallback(() => {
                    if (!isComponentMounted.current) return;
                    if (reconnectTimeout.current) return;

                    reconnectAttempts.current++;
                    const delay = calculateReconnectDelay();

                    reconnectTimeout.current = setTimeout(() => {
                        reconnectTimeout.current = null;
                        if (isComponentMounted.current) {
                            connectWebSocket();
                        }
                    }, delay);
                }, [connectWebSocket]);

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
                    const maxDelay = 120000; // 30 seconds
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

                // Handle search functionality
                const performSearch = useCallback((searchForward = true) => {
                    if (!terminal.current || !searchAddon.current || !searchTerm) return;

                    try {
                        if (searchForward) {
                            searchAddon.current.findNext(searchTerm, {
                                incremental: false,
                                decorations: {
                                    matchBackground: '#444',
                                    matchOverviewRuler: '#888',
                                    activeMatchBackground: '#f90',
                                    activeMatchColorOverviewRuler: '#f90'
                                }
                            });
                        } else {
                            searchAddon.current.findPrevious(searchTerm, {
                                incremental: false,
                                decorations: {
                                    matchBackground: '#444',
                                    matchOverviewRuler: '#888',
                                    activeMatchBackground: '#f90',
                                    activeMatchColorOverviewRuler: '#f90'
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Search error:', error);
                    }
                }, [searchTerm]);

                // Handle search input change
                const handleSearchInputChange = useCallback((value) => {
                    setSearchTerm(value);
                    if (value) {
                        performSearch();
                    }
                }, [performSearch]);

                // Clear terminal
                const clearTerminal = useCallback(() => {
                    if (terminal.current) {
                        terminal.current.clear();
                        terminal.current.scrollToTop();
                    }
                }, []);

                // Cleanup function to remove all resources
                const cleanup = useCallback(() => {
                    console.log('Starting terminal cleanup');

                    // Clear reconnect timeout
                    if (reconnectTimeout.current) {
                        clearTimeout(reconnectTimeout.current);
                        reconnectTimeout.current = null;
                    }

                    // Close WebSocket
                    if (socket.current) {
                        socket.current.onclose = null; // Prevent reconnection
                        socket.current.onerror = null;
                        socket.current.onmessage = null;
                        socket.current.onopen = null;

                        if (socket.current.readyState === WebSocket.OPEN) {
                            socket.current.close();
                        }
                        socket.current = null;
                    }

                    // Remove all event listeners
                    eventListeners.current.forEach(({ target, event, handler }) => {
                        target.removeEventListener(event, handler);
                    });
                    eventListeners.current = [];

                    // Dispose terminal and addons
                    if (searchAddon.current) {
                        searchAddon.current.dispose();
                        searchAddon.current = null;
                    }

                    if (fitAddon.current) {
                        fitAddon.current.dispose();
                        fitAddon.current = null;
                    }

                    if (terminal.current) {
                        terminal.current.dispose();
                        terminal.current = null;
                    }

                    console.log('Terminal cleanup complete');
                }, []);

                // Add event listener with tracking
                const addEventListenerTracked = useCallback((target, event, handler) => {
                    target.addEventListener(event, handler);
                    eventListeners.current.push({ target, event, handler });
                }, []);

                // Close search
                const closeSearch = useCallback(() => {
                    setSearchVisible(false);
                    setSearchTerm('');
                    if (searchAddon.current) {
                        searchAddon.current.clearDecorations();
                    }
                    if (terminal.current) {
                        terminal.current.focus();
                    }
                }, []);

                // Initialize terminal
                useEffect(() => {
                    isComponentMounted.current = true;

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

                    // Handle search results
                    searchAddon.current.onDidChangeResults(results => {
                        setCurrentSearchIndex(results ? results.resultIndex : 0);
                        setTotalSearchResults(results ? results.resultCount : 0);
                    });

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
                        isComponentMounted.current = false;
                        cleanup();
                    };
                }, [terminalId, cleanup]);

                // Handle resize with tracked event listener
                useEffect(() => {
                    const handleResize = () => {
                        if (!isComponentMounted.current) return;
                        if (fitAddon.current && terminal.current) {
                            try {
                                fitAddon.current.fit();
                                sendTerminalSize();
                            } catch (error) {
                                console.error('Resize error:', error);
                            }
                        }
                    };

                    addEventListenerTracked(window, 'resize', handleResize);

                    return () => {
                        // Cleanup happens in main useEffect
                    };
                }, [sendTerminalSize, addEventListenerTracked]);

                // Handle keyboard shortcuts
                useEffect(() => {
                    const handleKeyDown = (e) => {
                        if (!isComponentMounted.current) return;
                        // Ctrl+F or Cmd+F for search
                        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                            e.preventDefault();
                            setSearchVisible(true);

                            // Focus search input after state update
                            setTimeout(() => {
                                const searchInput = document.getElementById('terminal-search-input');
                                if (searchInput) searchInput.focus();
                            }, 0);
                        }

                        // Escape to close search
                        if (e.key === 'Escape' && searchVisible) {
                            closeSearch();
                        }
                    };
                    addEventListenerTracked(window, 'keydown', handleKeyDown);

                    return () => {
                        // Cleanup happens in main useEffect
                    };
                }, [searchVisible, closeSearch, addEventListenerTracked]);

                return (
                    <div className="h-full w-full flex flex-col">
                        {/* Connection indicator */}
                        <div className="absolute top-2 right-2 z-10 flex items-center bg-gray-900 bg-opacity-75 px-2 py-1 rounded">
                            <StatusIndicator
                                status={connected ? 'connected' : 'disconnected'}
                                label={connected ? 'Connected' : 'Disconnected'}
                                size="sm"
                            />
                        </div>

                        {/* Search bar */}
                        {searchVisible && (
                            <div className="bg-gray-800 p-2 flex items-center">
                                <input
                                    id="terminal-search-input"
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => handleSearchInputChange(e.target.value)}
                                    placeholder="Search..."
                                    className="flex-1 px-3 py-1 text-sm text-white bg-gray-700 border border-gray-600 rounded-l"
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter') {
                                            performSearch();
                                        }
                                    }}
                                />
                                <div className="flex items-center bg-gray-700 px-2 text-xs text-gray-300">
                                    {totalSearchResults > 0 ? (
                                        <span>{currentSearchIndex + 1}/{totalSearchResults}</span>
                                    ) : (
                                        <span>0/0</span>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => performSearch(false)}
                                    className="text-white hover:bg-gray-600"
                                    title="Previous match"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                                    </svg>
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => performSearch(true)}
                                    className="text-white hover:bg-gray-600"
                                    title="Next match"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                                    </svg>
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={closeSearch}
                                    className="ml-1"
                                >
                                    Close
                                </Button>
                            </div>
                        )}

                        {/* Terminal container */}
                        <div className="flex-1 relative">
                            <div ref={terminalRef} className="absolute inset-0" />
                        </div>

                        {/* Terminal toolbar */}
                        <div className="bg-gray-800 p-2 flex justify-between items-center">
                            <div className="flex space-x-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSearchVisible(true)}
                                    title="Search (Ctrl+F)"
                                    className="text-gray-300 hover:text-white hover:bg-gray-700"
                                    aria-label="Search terminal"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearTerminal}
                                    title="Clear terminal"
                                    className="text-gray-300 hover:text-white hover:bg-gray-700"
                                    aria-label="Clear terminal"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </Button>
                            </div>

                            <div className="flex items-center space-x-2">
                                <Button
                                    variant={connected ? 'ghost' : 'primary'}
                                    size="sm"
                                    onClick={connectWebSocket}
                                    disabled={connected}
                                    className={connected ? 'text-green-400' : ''}
                                >
                                    {connected ? 'Connected' : 'Reconnect'}
                                </Button>
                            </div>
                        </div>
                    </div>
                );
            };
        });
    },
    {
        ssr: false,
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

const Terminal = ({ terminalId, onConnectionChange }) => {
    return (
        <div className="h-full w-full flex flex-col relative">
            <TerminalComponent
                terminalId={terminalId}
                onConnectionChange={onConnectionChange}
            />
        </div>
    );
};

export default Terminal;