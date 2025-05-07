// frontend/components/TerminalCore.js - Fix terminal rendering

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import { createTerminalConnection } from '../lib/api';
import 'xterm/css/xterm.css';

const TerminalCore = ({ sessionId, terminalId, target }) => {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const socket = useRef(null);
  const [connected, setConnected] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Set up terminal and WebSocket connection
  useEffect(() => {
    // Make sure the DOM element is available
    if (!terminalRef.current) return;

    // Initialize terminal
    const initTerminal = () => {
      // Skip if already initialized
      if (terminal.current) return;

      console.log('Initializing terminal...');

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
      const searchAddon = new SearchAddon();
      const webLinksAddon = new WebLinksAddon();

      // Load addons
      terminal.current.loadAddon(fitAddon.current);
      terminal.current.loadAddon(searchAddon);
      terminal.current.loadAddon(webLinksAddon);

      // Use a small timeout to ensure the DOM element is fully ready
      setTimeout(() => {
        try {
          // Open terminal
          terminal.current.open(terminalRef.current);
          console.log('Terminal opened successfully');

          // Fit terminal to container after a small delay
          setTimeout(() => {
            if (fitAddon.current) {
              try {
                fitAddon.current.fit();
                console.log('Terminal fit successful');
              } catch (error) {
                console.error('Terminal fit error:', error);
              }
            }
          }, 100);

          // Connect WebSocket after terminal is ready
          connectWebSocket();
        } catch (error) {
          console.error('Terminal open error:', error);
        }
      }, 50);
    };

    initTerminal();

    // Handle resize
    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
          // Send terminal size
          sendTerminalSize();
        } catch (error) {
          console.error('Resize error:', error);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
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
  }, [terminalId, sessionId]);

  // Connect to WebSocket with improved error handling
  // Add connection status tracking
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Update the connectWebSocket function
  const connectWebSocket = () => {
    if (!terminal.current || isReconnecting) return;

    setIsReconnecting(true);

    // Close existing connection
    if (socket.current) {
      socket.current.close();
    }

    // Show connecting message
    terminal.current.writeln('Connecting to terminal...');

    try {
      console.log(`Creating WebSocket connection to terminal: ${terminalId}`);
      socket.current = createTerminalConnection(terminalId);

      // WebSocket open handler
      socket.current.onopen = () => {
        console.log(`WebSocket connected for terminal ${terminalId}`);
        setConnected(true);
        setIsReconnecting(false);
        terminal.current.writeln('\r\nConnection established!');

        // Send initial terminal size
        setTimeout(sendTerminalSize, 100);
      };

      // Update onclose to handle reconnection attempts better
      socket.current.onclose = (event) => {
        console.log(`WebSocket closed for terminal ${terminalId}`, event);
        setConnected(false);
        setIsReconnecting(false);
        terminal.current.writeln('\r\nConnection closed.');
      };

      // Update onerror to handle errors better
      socket.current.onerror = (error) => {
        console.error(`WebSocket error for terminal ${terminalId}:`, error);
        setConnected(false);
        setIsReconnecting(false);
        terminal.current.writeln('\r\nConnection error. Check console for details.');
      };

      // ... rest of the function
    } catch (error) {
      setIsReconnecting(false);
      console.error('Error connecting to WebSocket:', error);
      terminal.current.writeln(`\r\nFailed to connect: ${error.message}`);
    }
  };

  // Send terminal size to server
  const sendTerminalSize = () => {
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
  };

  // Handle search in terminal
  const handleSearch = () => {
    if (!terminal.current || !searchTerm) return;

    try {
      terminal.current.findNext(searchTerm);
    } catch (error) {
      console.error('Search error:', error);
    }
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
        <div
          ref={terminalRef}
          className="absolute inset-0"
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
            className={`px-2 py-1 text-xs ${connected ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white rounded`}
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