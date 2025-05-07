// frontend/components/TerminalCore.js - Fixed terminal initialization

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { createTerminalConnection } from '../lib/api';
import 'xterm/css/xterm.css';

const TerminalCore = ({ sessionId, terminalId, target, onDisconnect }) => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const socket = useRef(null);
  const searchAddon = useRef(null);
  const [connected, setConnected] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Set up terminal and WebSocket connection
  useEffect(() => {
    // Make sure DOM is ready
    if (!terminalRef.current) return;

    // Skip if already initialized
    if (terminal.current) return;

    // Initialize terminal with a slight delay to ensure DOM is ready
    const initializeTerminal = () => {
      try {
        // Create terminal
        terminal.current = new Terminal({
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 14,
          rows: 24,
          theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5',
          },
          scrollback: 1000,
          cursorBlink: true,
        });

        // Create and register addons
        fitAddon.current = new FitAddon();
        searchAddon.current = new SearchAddon();
        const webLinksAddon = new WebLinksAddon();

        terminal.current.loadAddon(fitAddon.current);
        terminal.current.loadAddon(searchAddon.current);
        terminal.current.loadAddon(webLinksAddon);

        // Open terminal - wrap in try/catch to catch any initialization errors
        try {
          if (terminalRef.current) {
            terminal.current.open(terminalRef.current);
            console.log("Terminal opened successfully");

            // Fit terminal to container
            setTimeout(() => {
              if (fitAddon.current) {
                try {
                  fitAddon.current.fit();
                  console.log("Terminal fit successful");
                } catch (fitError) {
                  console.error("Error fitting terminal:", fitError);
                }
              }
            }, 100);

            // Connect WebSocket after terminal is initialized
            connectWebSocket();
          } else {
            console.error("Terminal DOM element not available");
          }
        } catch (openError) {
          console.error("Error opening terminal:", openError);
        }
      } catch (initError) {
        console.error("Terminal initialization error:", initError);
      }
    };

    // Delay terminal initialization slightly to ensure DOM is ready
    setTimeout(initializeTerminal, 100);

    // Set up resize handler
    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
          // Send terminal size to WebSocket
          sendTerminalSize();
        } catch (error) {
          console.error("Resize error:", error);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);

      if (socket.current) {
        socket.current.close();
      }

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    };
  }, [sessionId, terminalId, terminalRef.current]); // Add terminalRef.current as dependency

  // Connect WebSocket
  const connectWebSocket = () => {
    // Close existing connection if any
    if (socket.current) {
      socket.current.close();
    }

    // Display connecting message
    if (terminal.current) {
      terminal.current.writeln('Connecting to terminal...');
    }

    // Create WebSocket connection
    try {
      socket.current = createTerminalConnection(terminalId);

      // WebSocket event handlers
      socket.current.onopen = () => {
        setConnected(true);
        if (terminal.current) {
          terminal.current.writeln('Connected!');
        }

        // Send terminal size
        sendTerminalSize();
      };

      socket.current.onclose = () => {
        setConnected(false);
        if (terminal.current) {
          terminal.current.writeln('\r\nConnection closed.');
        }

        if (onDisconnect) {
          onDisconnect();
        }
      };

      socket.current.onerror = (error) => {
        setConnected(false);
        console.error("WebSocket error:", error);
        if (terminal.current) {
          terminal.current.writeln(`\r\nConnection error: ${error.message || 'Unknown error'}`);
        }

        if (onDisconnect) {
          onDisconnect();
        }
      };

      socket.current.onmessage = (event) => {
        if (!terminal.current) return;

        if (event.data instanceof ArrayBuffer) {
          // Binary data
          const uint8Array = new Uint8Array(event.data);
          terminal.current.write(uint8Array);
        } else {
          // Text data
          terminal.current.write(event.data);
        }
      };

      // Listen for data from terminal
      if (terminal.current) {
        terminal.current.onData((data) => {
          if (socket.current && socket.current.readyState === WebSocket.OPEN) {
            socket.current.send(data);
          }
        });
      }
    } catch (error) {
      console.error("Error connecting WebSocket:", error);
      if (terminal.current) {
        terminal.current.writeln(`\r\nFailed to create WebSocket: ${error.message || 'Unknown error'}`);
      }
    }
  };

  // Send terminal size to WebSocket
  const sendTerminalSize = () => {
    if (!fitAddon.current || !socket.current || socket.current.readyState !== WebSocket.OPEN || !terminal.current) {
      return;
    }

    try {
      const dims = fitAddon.current.proposeDimensions();
      if (!dims || !dims.cols || !dims.rows) {
        return;
      }

      // Binary message format: [type, cols_high, cols_low, rows_high, rows_low]
      const message = new Uint8Array(5);
      message[0] = 1; // Resize message type
      message[1] = dims.cols >> 8;
      message[2] = dims.cols & 0xff;
      message[3] = dims.rows >> 8;
      message[4] = dims.rows & 0xff;

      socket.current.send(message);
    } catch (error) {
      console.error("Error sending terminal size:", error);
    }
  };

  // Handle search
  const handleSearch = () => {
    if (!searchAddon.current || !searchTerm || !terminal.current) return;

    searchAddon.current.findNext(searchTerm);
  };

  return (
    <div className="h-full w-full flex flex-col">
      {/* Search bar */}
      {searchVisible && (
        <div className="bg-gray-800 p-2 flex items-center">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            className="flex-1 px-3 py-1 text-sm text-white bg-gray-700 border border-gray-600 rounded-l focus:outline-none focus:ring-1 focus:ring-blue-500"
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

      {/* Terminal */}
      <div className="flex-1 relative">
        <div
          className="absolute inset-0"
          ref={terminalRef}
          style={{ width: '100%', height: '100%' }}
        />
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
            onClick={() => {
              if (terminal.current) {
                terminal.current.clear();
              }
            }}
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
            className={`px-2 py-1 text-xs ${connected
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-red-600 hover:bg-red-700'
              } text-white rounded`}
            title={connected ? 'Connected' : 'Reconnect'}
          >
            {connected ? 'Connected' : 'Reconnect'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TerminalCore;