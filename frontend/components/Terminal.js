// frontend/components/Terminal.js - Terminal component with xterm.js integration

import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { WebglAddon } from 'xterm-addon-webgl';
import 'xterm/css/xterm.css';

const TerminalComponent = ({ sessionId, target, onDisconnect }) => {
    const terminalRef = useRef(null);
    const websocketRef = useRef(null);
    const terminalInstanceRef = useRef(null);
    const fitAddonRef = useRef(null);

    // Initialize terminal
    useEffect(() => {
        // Skip if already initialized
        if (terminalInstanceRef.current) return;

        // Create terminal instance
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
            },
            scrollback: 1000,
        });

        // Create addons
        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();
        const webLinksAddon = new WebLinksAddon();

        // Load addons
        terminal.loadAddon(fitAddon);
        terminal.loadAddon(searchAddon);
        terminal.loadAddon(webLinksAddon);

        // Open terminal
        terminal.open(terminalRef.current);

        // Try to use WebGL
        try {
            const webglAddon = new WebglAddon();
            terminal.loadAddon(webglAddon);
        } catch (e) {
            console.warn('WebGL not available for terminal', e);
        }

        // Fit terminal to container
        fitAddon.fit();

        // Save references
        terminalInstanceRef.current = terminal;
        fitAddonRef.current = fitAddon;

        // Connect to websocket
        connectWebSocket();

        // Handle window resize
        const handleResize = () => {
            if (fitAddonRef.current) {
                fitAddonRef.current.fit();
                sendTerminalSize();
            }
        };

        window.addEventListener('resize', handleResize);

        // Cleanup function
        return () => {
            // Close WebSocket
            if (websocketRef.current) {
                websocketRef.current.close();
            }

            // Dispose terminal
            if (terminalInstanceRef.current) {
                terminalInstanceRef.current.dispose();
            }

            // Remove event listener
            window.removeEventListener('resize', handleResize);
        };
    }, [sessionId, target]);

    // Connect to WebSocket
    const connectWebSocket = async () => {
        try {
            // Create terminal session
            const response = await fetch(`/api/v1/sessions/${sessionId}/terminals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ target }),
            });

            if (!response.ok) {
                throw new Error('Failed to create terminal session');
            }

            const data = await response.json();
            const terminalId = data.terminalId;

            // Connect to WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/terminals/${terminalId}/attach`);

            // Handle WebSocket events
            ws.onopen = () => {
                terminalInstanceRef.current.writeln('Connected to terminal session');
                sendTerminalSize();
            };

            ws.onclose = () => {
                terminalInstanceRef.current.writeln('\r\nConnection closed');
                if (onDisconnect) {
                    onDisconnect();
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                terminalInstanceRef.current.writeln('\r\nConnection error');
            };

            ws.onmessage = (event) => {
                // Handle incoming data
                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    // Binary data - append to terminal
                    const uint8Array = new Uint8Array(data);
                    terminalInstanceRef.current.write(uint8Array);
                } else {
                    // Text data - append to terminal
                    terminalInstanceRef.current.write(data);
                }
            };

            // Save WebSocket reference
            websocketRef.current = ws;

            // Handle terminal input
            terminalInstanceRef.current.onData((data) => {
                if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
                    websocketRef.current.send(data);
                }
            });
        } catch (error) {
            console.error('Failed to connect to terminal:', error);
            terminalInstanceRef.current.writeln(`Error: ${error.message}`);
        }
    };

    // Send terminal size to server
    const sendTerminalSize = () => {
        if (!fitAddonRef.current || !websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) {
            return;
        }

        const dims = fitAddonRef.current.proposeDimensions();
        if (!dims || !dims.cols || !dims.rows) {
            return;
        }

        // Send resize message
        const resizeMessage = new Uint8Array(5);
        resizeMessage[0] = 1; // Resize message type
        resizeMessage[1] = dims.cols >> 8;
        resizeMessage[2] = dims.cols & 0xff;
        resizeMessage[3] = dims.rows >> 8;
        resizeMessage[4] = dims.rows & 0xff;
        websocketRef.current.send(resizeMessage);

        // Also send via API for initial setup
        fetch(`/api/v1/terminals/${terminalId}/resize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                cols: dims.cols,
                rows: dims.rows,
            }),
        }).catch((error) => {
            console.error('Failed to resize terminal:', error);
        });
    };

    return (
        <div className="h-full w-full flex flex-col">
            <div className="flex-1 min-h-0" ref={terminalRef} />
        </div>
    );
};

export default TerminalComponent;